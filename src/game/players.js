import { createInputState } from './input';
import { createAbilityState } from './abilities';
import { resetHeldAbilities } from './powerups/effects';
import { Vec2 } from './math';

const WORLD_SCALE = 18;

export function createPlayer(id, isLocal, color, spawnPosition) {
  const group = document.createElement('div');
  group.className = `car${isLocal ? ' car--local' : ''}`;
  group.style.setProperty('--car-color', color);

  const bumper = document.createElement('div');
  bumper.className = 'car__bumper';
  group.append(bumper);

  const body = document.createElement('div');
  body.className = 'car__body';
  group.append(body);

  const nose = document.createElement('div');
  nose.className = 'car__nose';
  group.append(nose);

  const seat = document.createElement('div');
  seat.className = 'car__seat';
  group.append(seat);

  const tailLights = document.createElement('div');
  tailLights.className = 'car__tail-lights';
  group.append(tailLights);

  const player = {
    id,
    isLocal,
    group,
    velocity: new Vec2(),
    impactVelocity: new Vec2(),
    position: new Vec2(spawnPosition.x, spawnPosition.y),
    previousPosition: new Vec2(spawnPosition.x, spawnPosition.y),
    collisionMotion: new Vec2(),
    heading: 0,
    speedRamp: 0,
    targetPosition: new Vec2(spawnPosition.x, spawnPosition.y),
    targetVelocity: new Vec2(),
    targetHeading: 0,
    input: createInputState(),
    abilities: createAbilityState(),
    abilityInputState: {
      speedBoostHeld: false,
      ability1Held: false,
      ability2Held: false,
    },
    heldAbilities: [],
    shield: { activeUntil: 0 },
    ghost: { activeUntil: 0 },
    stone: { activeUntil: 0 },
    pendingBombDrop: null,
    hasSnapshot: isLocal,
    lastSeenAt: performance.now(),
  };

  resetHeldAbilities(player);
  return player;
}

export function ensureRemotePlayer(remotePlayers, world, peerId, spawnPosition = createSpawnPosition(remotePlayers.size + 1)) {
  let player = remotePlayers.get(peerId);

  if (!player) {
    player = createPlayer(peerId, false, colorFromId(peerId), spawnPosition);
    remotePlayers.set(peerId, player);
    world.add(player.group);
  }

  return player;
}

export function createSpawnPosition(index) {
  const angle = index * 0.8;
  return { x: Math.cos(angle) * 10, y: Math.sin(angle) * 10 };
}

export function syncPlayerTransform(player, now = performance.now() / 1000) {
  const x = player.position.x * WORLD_SCALE;
  const y = player.position.y * WORLD_SCALE;
  player.group.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${player.heading + Math.PI}rad)`;
  player.group.classList.toggle('car--shielded', now < (player.shield?.activeUntil ?? 0));
  player.group.classList.toggle('car--ghosted', now < (player.ghost?.activeUntil ?? 0));
  player.group.classList.toggle('car--stone', now < (player.stone?.activeUntil ?? 0));
}

export function colorFromId(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(index);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 78% 55%)`;
}