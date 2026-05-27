// List and implement power-up effects here
// Each power-up should be a named export function

import {
  BASE_SPEED_SCALE,
  BOOSTED_SPEED_SCALE,
  GHOST_DURATION_SECONDS,
  SHIELD_CHARGES_ON_PICKUP,
  SHIELD_DURATION_SECONDS,
  SPEED_BOOST_COOLDOWN_SECONDS,
  SPEED_BOOST_DURATION_SECONDS,
  SPEED_BOOST_MAX_SPEED_SCALE,
  SPEED_BOOST_RAMP_UP_SECONDS,
  STONE_DURATION_SECONDS,
} from '../config';
import { MAP_CELL_SIZE, MAP_WORLD_SIZE } from '../map-data';
import { clamp, lerp } from '../math';

const SPEED_BOOST_ABILITY_ID = 'speedBoost';
const SHIELD_KNOCKBACK_MULTIPLIER = 2.5;
const MAX_HELD_ABILITY_SLOTS = 2;
export const BOMB_FUSE_SECONDS = 2;
export const BOMB_EXPLOSION_DURATION_SECONDS = 0.7;
export const BOMB_KNOCKBACK_CELLS = 2;
const BOMB_DROP_OFFSET = 2.35;
const BOMB_PUSH_STRENGTH = 28;
const BOMB_SMOKE_MARKUP = '<div class="bomb-explosion__smoke"><span class="bomb-explosion__puff"></span><span class="bomb-explosion__puff"></span><span class="bomb-explosion__puff"></span><span class="bomb-explosion__puff"></span><span class="bomb-explosion__puff"></span><span class="bomb-explosion__puff"></span></div><div class="bomb-explosion__core"></div><div class="bomb-explosion__ring bomb-explosion__ring--outer"></div><div class="bomb-explosion__ring bomb-explosion__ring--inner"></div>';

function createEmptyHeldAbilities() {
  return Array.from({ length: MAX_HELD_ABILITY_SLOTS }, () => null);
}

function normalizeHeldAbilityEntry(entry) {
  if (!entry || typeof entry.type !== 'string') {
    return null;
  }

  const charges = Math.max(0, Number(entry.charges) || 0);
  if (charges <= 0) {
    return null;
  }

  return {
    type: entry.type,
    charges,
    heldSince: Number(entry.heldSince) || 0,
  };
}

function normalizeHeldAbilities(entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(normalizeHeldAbilityEntry)
    .filter(Boolean)
    .slice(0, MAX_HELD_ABILITY_SLOTS);

  while (normalized.length < MAX_HELD_ABILITY_SLOTS) {
    normalized.push(null);
  }

  return normalized;
}

function ensureHeldAbilities(player) {
  if (!Array.isArray(player.heldAbilities)) {
    player.heldAbilities = createEmptyHeldAbilities();
  }

  player.heldAbilities = normalizeHeldAbilities(player.heldAbilities);
  return player.heldAbilities;
}

function commitHeldAbilities(player, entries) {
  player.heldAbilities = normalizeHeldAbilities(entries);
  return player.heldAbilities;
}

function ensureShieldState(player) {
  if (!player.shield) {
    player.shield = { activeUntil: 0 };
  }

  return player.shield;
}

function ensureGhostState(player) {
  if (!player.ghost) {
    player.ghost = { activeUntil: 0 };
  }

  return player.ghost;
}

function ensureStoneState(player) {
  if (!player.stone) {
    player.stone = { activeUntil: 0 };
  }

  return player.stone;
}

function getBaseMovementSpeedScale(player) {
  return lerp(BASE_SPEED_SCALE, BOOSTED_SPEED_SCALE, clamp(player.speedRamp ?? 0, 0, 1));
}

/**
 * Activates the speed boost ability for a player.
 * Called on the rising edge of the Space key.
 */
export function speedBoost(player, now) {
  const abilityState = player.abilities?.[SPEED_BOOST_ABILITY_ID];
  if (!abilityState || now < abilityState.cooldownUntil) {
    return false;
  }

  abilityState.activatedAt = now;
  abilityState.activeUntil = now + SPEED_BOOST_DURATION_SECONDS;
  abilityState.cooldownUntil = now + SPEED_BOOST_COOLDOWN_SECONDS;
  abilityState.data = {
    startScale: getBaseMovementSpeedScale(player),
  };

  return true;
}

export function resetHeldAbilities(player) {
  player.heldAbilities = createEmptyHeldAbilities();
}

export function serializeHeldAbilities(player) {
  return ensureHeldAbilities(player).map((entry) => (entry ? { ...entry } : null));
}

export function applyHeldAbilitiesSnapshot(player, snapshot) {
  player.heldAbilities = normalizeHeldAbilities(snapshot);
}

function pickupHeldAbility(player, type, now = performance.now() / 1000) {
  const heldAbilities = [...ensureHeldAbilities(player)];
  const existingIndex = heldAbilities.findIndex((entry) => entry?.type === type);

  if (existingIndex !== -1) {
    heldAbilities[existingIndex] = {
      ...heldAbilities[existingIndex],
      charges: heldAbilities[existingIndex].charges + 1,
    };
    commitHeldAbilities(player, heldAbilities);
    return true;
  }

  const emptyIndex = heldAbilities.findIndex((entry) => !entry);
  if (emptyIndex !== -1) {
    heldAbilities[emptyIndex] = { type, charges: 1, heldSince: now };
    commitHeldAbilities(player, heldAbilities);
    return true;
  }

  let replaceIndex = 0;
  for (let index = 1; index < heldAbilities.length; index += 1) {
    if ((heldAbilities[index]?.heldSince ?? 0) < (heldAbilities[replaceIndex]?.heldSince ?? 0)) {
      replaceIndex = index;
    }
  }

  heldAbilities[replaceIndex] = { type, charges: 1, heldSince: now };
  commitHeldAbilities(player, heldAbilities);
  return true;
}

/**
 * Returns the effective speed scale for the current frame.
 * Returns baseSpeedScale unchanged when the ability is not active.
 */
export function getSpeedBoostScale(player, baseSpeedScale, now) {
  const state = player.abilities?.[SPEED_BOOST_ABILITY_ID];

  if (!state || now >= state.activeUntil) {
    return baseSpeedScale;
  }

  const rampProgress = SPEED_BOOST_RAMP_UP_SECONDS > 0
    ? clamp((now - state.activatedAt) / SPEED_BOOST_RAMP_UP_SECONDS, 0, 1)
    : 1;
  const startScale = Number.isFinite(state.data?.startScale)
    ? state.data.startScale
    : baseSpeedScale;

  return Math.max(baseSpeedScale, lerp(startScale, SPEED_BOOST_MAX_SPEED_SCALE, rampProgress));
}

export function shield(player) {
  const pickupCount = Math.max(1, SHIELD_CHARGES_ON_PICKUP);
  for (let count = 0; count < pickupCount; count += 1) {
    pickupHeldAbility(player, 'shield');
  }
}

export function activateShield(player, now) {
  const shieldState = ensureShieldState(player);
  shieldState.activeUntil = now + SHIELD_DURATION_SECONDS;
  return true;
}

export function isShieldActive(player, now) {
  return now < (player.shield?.activeUntil ?? 0);
}

export function activateGhost(player, now) {
  const ghostState = ensureGhostState(player);
  ghostState.activeUntil = now + GHOST_DURATION_SECONDS;
  return true;
}

export function isGhostActive(player, now) {
  return now < (player.ghost?.activeUntil ?? 0);
}

export function stone(player) {
  return pickupHeldAbility(player, 'stone');
}

export function activateStone(player, now) {
  const stoneState = ensureStoneState(player);
  stoneState.activeUntil = now + STONE_DURATION_SECONDS;
  player.velocity?.set(0, 0);
  player.impactVelocity?.set(0, 0);
  return true;
}

export function isStoneActive(player, now) {
  return now < (player.stone?.activeUntil ?? 0);
}

export function getShieldKnockbackScale(targetShielded, sourceShielded) {
  if (targetShielded) {
    return 0;
  }

  return sourceShielded ? SHIELD_KNOCKBACK_MULTIPLIER : 1;
}

export function rocket(player) {
  return pickupHeldAbility(player, 'rocket');
}

export function ghost(player) {
  return pickupHeldAbility(player, 'ghost');
}

export function bomb(player) {
  return pickupHeldAbility(player, 'bomb');
}

export function icebomb(player) {
  return pickupHeldAbility(player, 'icebomb');
}

export function activateBomb(player, now, bombType = 'bomb') {
  const backwardX = -Math.sin(player.heading);
  const backwardY = Math.cos(player.heading);

  player.pendingBombDrop = {
    x: player.position.x + backwardX * BOMB_DROP_OFFSET,
    y: player.position.y + backwardY * BOMB_DROP_OFFSET,
    bombType,
    placedAt: now,
    detonateAt: now + BOMB_FUSE_SECONDS,
  };

  return true;
}

export function activateIceBomb(player, now) {
  return activateBomb(player, now, 'icebomb');
}

export function consumePendingBombDrop(player, now = performance.now() / 1000) {
  if (!player.pendingBombDrop) {
    return null;
  }

  const pending = player.pendingBombDrop;
  player.pendingBombDrop = null;

  return {
    id: `${player.id}-${Math.round(now * 1000)}-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: player.id,
    type: pending.bombType === 'icebomb' ? 'icebomb' : 'bomb',
    x: pending.x,
    y: pending.y,
    placedAt: pending.placedAt,
    detonateAt: pending.detonateAt,
    explodeAt: 0,
    removeAt: pending.detonateAt + BOMB_EXPLOSION_DURATION_SECONDS,
  };
}

export function collectPendingBombDrops(players, now = performance.now() / 1000) {
  const droppedBombs = [];

  for (const player of players) {
    const droppedBomb = consumePendingBombDrop(player, now);
    if (droppedBomb) {
      droppedBombs.push(droppedBomb);
    }
  }

  return droppedBombs;
}

export function detonateBomb(bomb, players, map, now = performance.now() / 1000) {
  const centerCellX = Math.floor((bomb.x + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const centerCellY = Math.floor((bomb.y + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const nextMap = bomb.type === 'icebomb'
    ? freezeBombTiles(map, bomb)
    : destroyBombTiles(map, bomb);

  for (const player of players) {
    if (isShieldActive(player, now)) {
      continue;
    }

    const playerCellX = Math.floor((player.position.x + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
    const playerCellY = Math.floor((player.position.y + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
    const cellDeltaX = Math.abs(playerCellX - centerCellX);
    const cellDeltaY = Math.abs(playerCellY - centerCellY);
    const cellDistance = Math.max(cellDeltaX, cellDeltaY);

    // Apply blast to the full knockback zone around the bomb.
    if (cellDistance > BOMB_KNOCKBACK_CELLS) {
      continue;
    }

    const dx = player.position.x - bomb.x;
    const dy = player.position.y - bomb.y;
    const distance = Math.hypot(dx, dy);

    const safeDistance = Math.max(distance, 0.001);
    const pushStrength = BOMB_PUSH_STRENGTH * SHIELD_KNOCKBACK_MULTIPLIER;
    player.impactVelocity.x += (dx / safeDistance) * pushStrength;
    player.impactVelocity.y += (dy / safeDistance) * pushStrength;
  }

  return {
    map: nextMap,
    explodedBomb: {
      ...bomb,
      explodeAt: now,
      removeAt: now + BOMB_EXPLOSION_DURATION_SECONDS,
    },
  };
}

export function updateBombsState(bombs, players, map, now = performance.now() / 1000) {
  let nextMap = map;
  let mapChanged = false;
  let stateChanged = false;
  const nextBombs = [];

  for (const bomb of bombs) {
    if (bomb.explodeAt) {
      if (now < bomb.removeAt) {
        nextBombs.push(bomb);
      } else {
        stateChanged = true;
      }
      continue;
    }

    if (now < bomb.detonateAt) {
      nextBombs.push(bomb);
      continue;
    }

    const result = detonateBomb(bomb, players, nextMap, now);
    nextMap = result.map;
    mapChanged = true;
    stateChanged = true;
    nextBombs.push(result.explodedBomb);
  }

  return {
    bombs: nextBombs,
    map: nextMap,
    mapChanged,
    stateChanged,
  };
}

export function getBombVisualState(bomb, now = performance.now() / 1000) {
  if (bomb.explodeAt) {
    const knockbackDiameterCells = BOMB_KNOCKBACK_CELLS * 2 + 1;
    return {
      kind: 'explosion',
      elapsed: Math.max(0, now - bomb.explodeAt),
      diameterCells: knockbackDiameterCells,
      innerZoneScale: (knockbackDiameterCells - 2) / knockbackDiameterCells,
    };
  }

  const timeLeft = Math.max(0.02, bomb.detonateAt - now);
  const progress = 1 - Math.min(1, timeLeft / BOMB_FUSE_SECONDS);

  return {
    kind: 'bomb',
    flickerSpeed: Math.max(0.05, 0.42 - progress * 0.35),
    warningOpacity: 0.3 + progress * 0.7,
    bodyFlickerStrength: 1.05 + progress * 0.85,
    bodyFlashOpacity: 0.14 + progress * 0.62,
  };
}

export function reconcileSyncedBombVisualTiming(previousBombs, incomingBombs, now = performance.now() / 1000) {
  const prevById = new Map((Array.isArray(previousBombs) ? previousBombs : []).map((bomb) => [bomb.id, bomb]));

  return (Array.isArray(incomingBombs) ? incomingBombs : []).map((bomb) => {
    if (!bomb?.explodeAt) {
      return bomb;
    }

    const previous = prevById.get(bomb.id);
    if (previous?.explodeAt) {
      return {
        ...bomb,
        explodeAt: previous.explodeAt,
        removeAt: previous.removeAt,
      };
    }

    return {
      ...bomb,
      explodeAt: now,
      removeAt: now + BOMB_EXPLOSION_DURATION_SECONDS,
    };
  });
}

export function renderBombEffects({
  world,
  bombs,
  syncedBombs,
  isHostView,
  renderedBombEls,
  worldScale,
  now = performance.now() / 1000,
}) {
  for (const el of renderedBombEls) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  const nextRenderedBombEls = [];
  const list = isHostView ? bombs : syncedBombs;
  if (!Array.isArray(list)) return nextRenderedBombEls;

  for (const bomb of list) {
    const left = `calc(50% + ${bomb.x * worldScale}px)`;
    const top = `calc(50% + ${bomb.y * worldScale}px)`;
    const visual = getBombVisualState(bomb, now);
    const bombType = bomb.type === 'icebomb' ? 'icebomb' : 'bomb';

    if (visual.kind === 'explosion') {
      const explosion = document.createElement('div');
      explosion.className = `bomb-explosion bomb-explosion--${bombType}`;
      explosion.style.left = left;
      explosion.style.top = top;
      explosion.style.width = `${MAP_CELL_SIZE * worldScale * visual.diameterCells}px`;
      explosion.style.height = `${MAP_CELL_SIZE * worldScale * visual.diameterCells}px`;
      explosion.style.setProperty('--bomb-inner-zone-scale', `${visual.innerZoneScale}`);
      explosion.style.animationDelay = `-${Math.min(BOMB_EXPLOSION_DURATION_SECONDS, visual.elapsed)}s`;
      explosion.innerHTML = BOMB_SMOKE_MARKUP;
      world.add(explosion);
      nextRenderedBombEls.push(explosion);
      continue;
    }

    const bombSize = MAP_CELL_SIZE * worldScale * 0.42;
    const bombEl = document.createElement('div');
  bombEl.className = `bomb-entity bomb-entity--${bombType}`;
    bombEl.style.left = left;
    bombEl.style.top = top;
    bombEl.style.width = `${bombSize}px`;
    bombEl.style.height = `${bombSize}px`;
    bombEl.style.setProperty('--bomb-flicker-speed', `${visual.flickerSpeed}s`);
    bombEl.style.setProperty('--bomb-warning-opacity', `${visual.warningOpacity}`);
    bombEl.style.setProperty('--bomb-body-flicker-strength', `${visual.bodyFlickerStrength}`);
    bombEl.style.setProperty('--bomb-body-flash-opacity', `${visual.bodyFlashOpacity}`);
    world.add(bombEl);
    nextRenderedBombEls.push(bombEl);
  }

  return nextRenderedBombEls;
}

function destroyBombTiles(map, bomb) {
  const centerCellX = Math.floor((bomb.x + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const centerCellY = Math.floor((bomb.y + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const destroyed = new Set();

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      destroyed.add(`${centerCellX + offsetX},${centerCellY + offsetY}`);
    }
  }

  return {
    ...map,
    floors: map.floors.filter((tile) => !destroyed.has(`${tile.x},${tile.y}`)),
    ice: (map.ice ?? []).filter((tile) => !destroyed.has(`${tile.x},${tile.y}`)),
    walls: map.walls.filter((tile) => !destroyed.has(`${tile.x},${tile.y}`)),
  };
}

function freezeBombTiles(map, bomb) {
  const centerCellX = Math.floor((bomb.x + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const centerCellY = Math.floor((bomb.y + MAP_WORLD_SIZE / 2) / MAP_CELL_SIZE);
  const frozen = new Set();

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      frozen.add(`${centerCellX + offsetX},${centerCellY + offsetY}`);
    }
  }

  const nextFloors = [...map.floors];
  const floorKeys = new Set(nextFloors.map((tile) => `${tile.x},${tile.y}`));
  const nextIce = [...(map.ice ?? [])];
  const iceKeys = new Set(nextIce.map((tile) => `${tile.x},${tile.y}`));

  for (const key of frozen) {
    const [xText, yText] = key.split(',');
    const x = Number(xText);
    const y = Number(yText);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    if (!floorKeys.has(key)) {
      nextFloors.push({ x, y });
      floorKeys.add(key);
    }

    if (!iceKeys.has(key)) {
      nextIce.push({ x, y });
      iceKeys.add(key);
    }
  }

  return {
    ...map,
    floors: nextFloors,
    ice: nextIce,
    walls: map.walls.filter((tile) => !frozen.has(`${tile.x},${tile.y}`)),
  };
}

export function activateHeldAbilitySlot(player, slotIndex, now = performance.now() / 1000) {
  const heldAbilities = [...ensureHeldAbilities(player)];
  const entry = heldAbilities[slotIndex];
  if (!entry) {
    return false;
  }

  let activated = false;
  if (entry.type === 'shield') {
    activated = activateShield(player, now);
  } else if (entry.type === 'ghost') {
    activated = activateGhost(player, now);
  } else if (entry.type === 'icebomb') {
    activated = activateIceBomb(player, now);
  } else if (entry.type === 'bomb') {
    activated = activateBomb(player, now);
  } else if (entry.type === 'stone') {
    activated = activateStone(player, now);
  }

  if (!activated) {
    return false;
  }

  const nextCharges = entry.charges - 1;
  heldAbilities[slotIndex] = nextCharges > 0
    ? { ...entry, charges: nextCharges }
    : null;
  commitHeldAbilities(player, heldAbilities);
  return true;
}

export function applyPowerupEffect(type, player, now = performance.now() / 1000) {
  if (type === 'shield') return shield(player, now);
  if (type === 'rocket') return icebomb(player, now);
  if (type === 'icebomb') return icebomb(player, now);
  if (type === 'ghost') return ghost(player, now);
  if (type === 'bomb') return bomb(player, now);
  if (type === 'stone') return stone(player, now);
  return false;
}
