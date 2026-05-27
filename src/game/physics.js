import {
  CAR_COLLISION_DISTANCE_MULTIPLIER,
  BUMPER_ZONE_RESTITUTION,
  BUMPER_ZONE_TRANSFER,
  CAR_RADIUS,
  COLLISION_POSITION_PERCENT,
  COLLISION_POSITION_SLOP,
  IMPACT_VELOCITY_DECAY,
  PLAYER_MASS,
  WALL_BOUNCE,
  BASE_SPEED_SCALE,
  BOOSTED_SPEED_SCALE,
  SPEED_RAMP_TIME_SECONDS,
  STONE_COLLISION_PUSH_MULTIPLIER,
} from './config';
import {
  getShieldKnockbackScale,
  getSpeedBoostScale,
  isGhostActive,
  isShieldActive,
  isStoneActive,
} from './powerups/effects';
import { clamp, lerp, Vec2 } from './math';
import {
  MAP_CELL_SIZE,
  MAP_WORLD_SIZE,
  getActiveMap,
  mapWallToWorldRect,
} from './map-data';

const inversePlayerMass = 1 / PLAYER_MASS;
const wallContactThreshold = 0.18;
const wallTouchPush = 5.5;
const wallPenetrationPush = 18;
const ICE_TURN_RATE_SCALE = 0.42;
const ICE_SPEED_RAMP_DECAY_SCALE = 0.35;

export function simulateMovement(player, input, delta, now = performance.now() / 1000) {
  if (isStoneActive(player, now)) {
    player.previousPosition.copy(player.position);
    player.speedRamp = 0;
    player.velocity.set(0, 0);
    player.impactVelocity.set(0, 0);
    player.collisionMotion.set(0, 0);
    return;
  }

  const activeMap = getActiveMap();
  const onIce = isPlayerOnIceTile(player, activeMap);
  const traction = onIce ? 0.975 : 0.82;
  const lateralGrip = onIce ? 0.95 : 4.8;
  const strafeGrip = onIce ? 0.3 : 1.2;
  const impactVelocityDecay = onIce ? 0.45 : IMPACT_VELOCITY_DECAY;
  player.previousPosition.copy(player.position);
  const throttlePressed = input.forward || input.backward;
  const rampDecayScale = onIce ? ICE_SPEED_RAMP_DECAY_SCALE : 1;
  player.speedRamp = throttlePressed
    ? Math.min(1, player.speedRamp + delta / SPEED_RAMP_TIME_SECONDS)
    : Math.max(0, player.speedRamp - (delta * rampDecayScale) / (SPEED_RAMP_TIME_SECONDS * 0.5));

  const baseSpeedScale = lerp(BASE_SPEED_SCALE, BOOSTED_SPEED_SCALE, player.speedRamp);
  const speedScale = getSpeedBoostScale(player, baseSpeedScale, now);
  const acceleration = (input.forward ? 22 : input.backward ? -15 : 0) * speedScale;
  const speed = player.velocity.length();
  const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  const strafeInput = (input.strafeRight ? 1 : 0) - (input.strafeLeft ? 1 : 0);
  const steerStrength = lerp(1.7, 2.8, Math.min(speed / 14, 1)) * (onIce ? ICE_TURN_RATE_SCALE : 1);

  player.heading -= steerInput * steerStrength * delta * (speed > 0.2 ? 1 : 0.45);

  const forward = new Vec2(Math.sin(player.heading), -Math.cos(player.heading));
  const right = new Vec2(-forward.y, forward.x);
  player.velocity.addScaledVector(forward, acceleration * delta);
  player.velocity.addScaledVector(right, strafeInput * 22 * speedScale * delta);

  player.velocity.dot(forward);
  const sideSpeed = player.velocity.dot(right);
  const lateral = right.clone().multiplyScalar(sideSpeed);
  const appliedLateralGrip = strafeInput === 0 ? lateralGrip : strafeGrip;

  player.velocity.addScaledVector(lateral, -Math.min(1, appliedLateralGrip * delta));
  player.velocity.multiplyScalar(1 - (1 - traction) * delta * 8);
  player.velocity.clampLength(0, 19 * speedScale);
  player.impactVelocity.multiplyScalar(Math.max(0, 1 - impactVelocityDecay * delta));

  const totalVelocity = player.velocity.clone().add(player.impactVelocity);
  player.position.addScaledVector(totalVelocity, delta);

  const safeDelta = Math.max(delta, 0.0001);
  player.collisionMotion
    .copy(player.position)
    .sub(player.previousPosition)
    .multiplyScalar(1 / safeDelta);
}

export function resolveArenaCollision() {
}

export function resolveMapWallCollisions(player) {
  if (isGhostActive(player, performance.now() / 1000)) {
    return;
  }

  const activeMap = getActiveMap();

  for (const wall of activeMap.walls) {
    resolveStaticRectCollision(player, mapWallToWorldRect(wall));
  }
}

export function resolvePlayerCollision(playerA, playerB, now = performance.now() / 1000) {
  if (isGhostActive(playerA, now) || isGhostActive(playerB, now)) {
    return;
  }

  const aShielded = isShieldActive(playerA, now);
  const bShielded = isShieldActive(playerB, now);
  const aStone = isStoneActive(playerA, now);
  const bStone = isStoneActive(playerB, now);

  const delta = playerA.position.clone().sub(playerB.position);
  const distance = delta.length();
  const minDistance = CAR_RADIUS * CAR_COLLISION_DISTANCE_MULTIPLIER;
  const penetration = minDistance - distance;

  if (penetration <= 0) {
    return;
  }

  const normal = distance > 0.0001
    ? delta.normalize()
    : getCollisionFallbackNormal(playerA, playerB);

  applyPositionCorrection(playerA, playerB, normal, penetration, aShielded, bShielded, aStone, bStone);

  if (aStone !== bStone) {
    const mover = aStone ? playerB : playerA;
    const pushDirection = aStone ? normal.clone().multiplyScalar(-1) : normal.clone();
    const moverMotion = getCollisionMotion(mover);
    const moverSpeed = moverMotion.length();
    const pushStrength = moverSpeed * STONE_COLLISION_PUSH_MULTIPLIER;

    if (pushStrength > 0.0001) {
      mover.impactVelocity.addScaledVector(pushDirection, pushStrength);
    }

    const inwardDrive = mover.velocity.dot(pushDirection);
    const inwardImpact = mover.impactVelocity.dot(pushDirection);
    if (inwardDrive < 0) {
      mover.velocity.addScaledVector(pushDirection, -inwardDrive);
    }
    if (inwardImpact < 0) {
      mover.impactVelocity.addScaledVector(pushDirection, -inwardImpact);
    }

    resolveArenaCollision(mover);
    return;
  }

  if (aStone && bStone) {
    return;
  }

  const motionA = getCollisionMotion(playerA);
  const motionB = getCollisionMotion(playerB);
  const relativeMotion = motionA.clone().sub(motionB);
  const separatingSpeed = relativeMotion.dot(normal);

  if (separatingSpeed >= -0.0001) {
    return;
  }

  const impulseMagnitude = -(1 + BUMPER_ZONE_RESTITUTION)
    * separatingSpeed
    * BUMPER_ZONE_TRANSFER
    / (inversePlayerMass + inversePlayerMass);
  const impulse = normal.clone().multiplyScalar(impulseMagnitude);

  playerA.impactVelocity.addScaledVector(impulse, inversePlayerMass * getShieldKnockbackScale(aShielded, bShielded));
  playerB.impactVelocity.addScaledVector(impulse, -inversePlayerMass * getShieldKnockbackScale(bShielded, aShielded));

  resolveArenaCollision(playerA);
  resolveArenaCollision(playerB);
}

function applyPositionCorrection(
  playerA,
  playerB,
  normal,
  penetration,
  aShielded = false,
  bShielded = false,
  aStone = false,
  bStone = false,
) {
  const correctionMagnitude = Math.max(penetration - COLLISION_POSITION_SLOP, 0) * COLLISION_POSITION_PERCENT;
  if (correctionMagnitude <= 0) {
    return;
  }

  const correction = normal.clone().multiplyScalar(correctionMagnitude);

  if (aStone && !bStone) {
    if (!bShielded) {
      playerB.position.addScaledVector(correction, -1);
    }
    return;
  }

  if (bStone && !aStone) {
    if (!aShielded) {
      playerA.position.addScaledVector(correction, 1);
    }
    return;
  }

  const splitCorrection = correction.multiplyScalar(0.5);
  if (!aShielded && !aStone) playerA.position.add(splitCorrection);
  if (!bShielded && !bStone) playerB.position.sub(splitCorrection);
}

function getCollisionFallbackNormal(playerA, playerB) {
  const relativeMotion = getCollisionMotion(playerA).clone().sub(getCollisionMotion(playerB));
  if (relativeMotion.lengthSq() > 0.0001) {
    return relativeMotion.normalize();
  }

  return getForwardVector(playerA.heading);
}

function getForwardVector(heading) {
  return new Vec2(Math.sin(heading), -Math.cos(heading)).normalize();
}

function getCollisionMotion(player) {
  if (player.collisionMotion.lengthSq() > 0.0001) {
    return player.collisionMotion;
  }

  return player.velocity.clone().add(player.impactVelocity);
}

function resolveStaticRectCollision(player, rect) {
  const expandedMinX = rect.minX - CAR_RADIUS;
  const expandedMaxX = rect.maxX + CAR_RADIUS;
  const expandedMinY = rect.minY - CAR_RADIUS;
  const expandedMaxY = rect.maxY + CAR_RADIUS;

  if (
    player.position.x < expandedMinX
    || player.position.x > expandedMaxX
    || player.position.y < expandedMinY
    || player.position.y > expandedMaxY
  ) {
    return;
  }

  const nearestX = clamp(player.position.x, rect.minX, rect.maxX);
  const nearestY = clamp(player.position.y, rect.minY, rect.maxY);
  const delta = player.position.clone().sub(new Vec2(nearestX, nearestY));
  let normal = delta;
  let distance = delta.length();

  if (distance <= 0.0001) {
    const distancesToFaces = [
      { value: Math.abs(player.position.x - rect.minX), normal: new Vec2(-1, 0) },
      { value: Math.abs(rect.maxX - player.position.x), normal: new Vec2(1, 0) },
      { value: Math.abs(player.position.y - rect.minY), normal: new Vec2(0, -1) },
      { value: Math.abs(rect.maxY - player.position.y), normal: new Vec2(0, 1) },
    ];
    distancesToFaces.sort((a, b) => a.value - b.value);
    normal = distancesToFaces[0].normal;
    distance = 0;
  } else {
    normal = normal.normalize();
  }

  const penetration = CAR_RADIUS - distance;
  if (penetration <= -wallContactThreshold) {
    return;
  }

  const touchAmount = clamp((penetration + wallContactThreshold) / wallContactThreshold, 0, 1);
  const clampedPenetration = Math.max(0, penetration);

  if (clampedPenetration > 0) {
    player.position.addScaledVector(normal, clampedPenetration);
  }

  const driveVelocityAlongWall = player.velocity.dot(normal);
  const impactVelocityAlongWall = player.impactVelocity.dot(normal);
  const totalVelocityAlongWall = driveVelocityAlongWall + impactVelocityAlongWall;

  if (driveVelocityAlongWall < 0) {
    player.velocity.addScaledVector(normal, -driveVelocityAlongWall);
  }

  if (impactVelocityAlongWall < 0) {
    player.impactVelocity.addScaledVector(normal, -impactVelocityAlongWall);
  }

  const inwardPush = touchAmount * wallTouchPush
    + clampedPenetration * wallPenetrationPush
    + Math.max(0, -totalVelocityAlongWall) * WALL_BOUNCE;

  player.impactVelocity.addScaledVector(normal, inwardPush);
}

function isPlayerOnIceTile(player, map) {
  const cellX = Math.floor((player.position.x + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const cellY = Math.floor((player.position.y + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  return (map.ice ?? []).some((tile) => tile.x === cellX && tile.y === cellY);
}