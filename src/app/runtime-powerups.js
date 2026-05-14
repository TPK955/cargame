import '../powerup.css';
import { MAP_CELL_SIZE, WORLD_SCALE, getActiveMap, mapCellToWorld, setSessionMap } from '../game/map-data';
import {
  collectPendingBombDrops,
  reconcileSyncedBombVisualTiming,
  renderBombEffects,
  updateBombsState,
} from '../game/powerups/effects';
import { POWERUP_NAMES } from '../game/powerups/list.js';

const POWERUP_SPAWN_INTERVAL = 7;
const POWERUP_DESPAWN_TIME = 20;
const MAX_POWERUPS = 2;

export function createRuntimePowerups(options) {
  const {
    world,
    isHost,
    localPlayer,
    selfId,
    getHostId,
    getSendInput,
    playerLives,
    applyPickupEffect,
    sendSnapshotPacket,
    sendMapPacket,
    playBombDropSound,
    playExplosionSound,
  } = options;

  let renderedPowerupEls = [];
  let renderedBombEls = [];
  let powerups = [];
  let powerupTimers = [];
  let powerupSpawnAccumulator = 0;
  let bombs = [];

  function getPowerups() {
    return powerups;
  }

  function getBombs() {
    return bombs;
  }

  function isPlayerOnPowerup(player, powerup) {
    const playerPos = player.position;
    const powerupPos = mapCellToWorld(powerup.x, powerup.y);
    const dx = playerPos.x - powerupPos.x;
    const dy = playerPos.y - powerupPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < MAP_CELL_SIZE * 0.5;
  }

  function tryPickupPowerup() {
    if (isHost()) return;

    const list = window.syncedPowerups;
    if (!Array.isArray(list)) return;

    for (const powerup of list) {
      if (isPlayerOnPowerup(localPlayer, powerup)) {
        const sendInput = getSendInput();
        if (sendInput) {
          sendInput({ pickup: { x: powerup.x, y: powerup.y, type: powerup.type } }, getHostId());
        }
        break;
      }
    }
  }

  function renderPowerups() {
    for (const el of renderedPowerupEls) {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    renderedPowerupEls = [];

    const list = isHost() ? powerups : window.syncedPowerups;
    if (!Array.isArray(list)) return;

    for (const powerup of list) {
      const size = MAP_CELL_SIZE * 0.7 * WORLD_SCALE;
      const el = document.createElement('div');
      const worldPos = mapCellToWorld(powerup.x, powerup.y);
      el.className = 'powerup-item';
      el.style.position = 'absolute';
      el.style.left = `calc(50% + ${worldPos.x * WORLD_SCALE - size / 2}px)`;
      el.style.top = `calc(50% + ${worldPos.y * WORLD_SCALE - size / 2}px)`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.background = '#ff0';
      el.style.borderRadius = '50%';
      el.style.zIndex = 10;
      el.dataset.type = powerup.type;
      world.add(el);
      renderedPowerupEls.push(el);
    }
  }

  function renderBombs(now = performance.now() / 1000) {
    renderedBombEls = renderBombEffects({
      world,
      bombs,
      syncedBombs: window.syncedBombs,
      isHostView: isHost(),
      renderedBombEls,
      worldScale: WORLD_SCALE,
      now,
    });
  }

  function getRandomAvailableFloorTile() {
    const map = getActiveMap();
    const floorTiles = Array.isArray(map.floors) ? map.floors : [];
    if (floorTiles.length === 0) return null;

    const wallTiles = new Set((Array.isArray(map.walls) ? map.walls : []).map((tile) => `${tile.x},${tile.y}`));
    const occupied = new Set(powerups.map((powerup) => `${powerup.x},${powerup.y}`));
    const availableTiles = floorTiles.filter((tile) => {
      const key = `${tile.x},${tile.y}`;
      return !occupied.has(key) && !wallTiles.has(key);
    });

    if (availableTiles.length === 0) return null;
    const idx = Math.floor(Math.random() * availableTiles.length);
    return availableTiles[idx];
  }

  function hostDespawnPowerup(powerup) {
    powerups = powerups.filter((candidate) => candidate !== powerup);
    const timerEntry = powerupTimers.find((entry) => entry.powerup === powerup);
    if (timerEntry) {
      clearTimeout(timerEntry.timer);
    }
    powerupTimers = powerupTimers.filter((entry) => entry.powerup !== powerup);
  }

  function hostSpawnPowerup() {
    if (powerups.length >= MAX_POWERUPS) return;

    const tile = getRandomAvailableFloorTile();
    if (!tile) return;

    const type = POWERUP_NAMES[Math.floor(Math.random() * POWERUP_NAMES.length)];
    const powerup = { x: tile.x, y: tile.y, type, spawnedAt: performance.now() / 1000 };
    powerups.push(powerup);

    const timer = setTimeout(() => {
      hostDespawnPowerup(powerup);
    }, POWERUP_DESPAWN_TIME * 1000);
    powerupTimers.push({ powerup, timer });
  }

  function hostResetPowerups() {
    powerups = [];
    bombs = [];
    window.syncedBombs = [];
    powerupTimers.forEach((entry) => clearTimeout(entry.timer));
    powerupTimers = [];
    powerupSpawnAccumulator = 0;
  }

  function handlePickupRequest(pickup, player) {
    if (!pickup) return false;

    const index = powerups.findIndex(
      (powerup) => powerup.x === pickup.x && powerup.y === pickup.y && powerup.type === pickup.type,
    );
    if (index === -1) return false;

    const [removed] = powerups.splice(index, 1);
    applyPickupEffect(removed.type, player);

    const timerEntry = powerupTimers.find((entry) => entry.powerup === removed);
    if (timerEntry) {
      clearTimeout(timerEntry.timer);
    }
    powerupTimers = powerupTimers.filter((entry) => entry.powerup !== removed);
    sendSnapshotPacket();
    return true;
  }

  function applySnapshotPowerups(powerupList, bombList) {
    if (!isHost() && Array.isArray(powerupList)) {
      window.syncedPowerups = powerupList;
    }

    if (!isHost() && Array.isArray(bombList)) {
      const previousSyncedBombs = window.syncedBombs ?? [];
      window.syncedBombs = reconcileSyncedBombVisualTiming(
        window.syncedBombs,
        bombList,
        performance.now() / 1000,
      );

      for (const bomb of window.syncedBombs) {
        if (!bomb.explodeAt) continue;
        const previousBomb = previousSyncedBombs.find((prev) => prev.id === bomb.id && prev.explodeAt);
        if (!previousBomb) {
          playExplosionSound();
        }
      }
    }
  }

  function simulateAuthoritativeStep(delta, players) {
    if (isHost()) {
      powerupSpawnAccumulator += delta;
      if (powerupSpawnAccumulator >= POWERUP_SPAWN_INTERVAL) {
        powerupSpawnAccumulator = 0;
        hostSpawnPowerup();
      }
    }

    const now = performance.now() / 1000;
    const droppedBombs = collectPendingBombDrops(players, now);
    if (droppedBombs.length > 0) {
      bombs.push(...droppedBombs);
      playBombDropSound();
    }

    const bombUpdate = updateBombsState(bombs, players, getActiveMap(), now);

    for (const nextBomb of bombUpdate.bombs) {
      if (!nextBomb.explodeAt) continue;
      const previousBomb = bombs.find((bomb) => bomb.id === nextBomb.id);
      if (!previousBomb?.explodeAt) {
        playExplosionSound();
      }
    }

    bombs = bombUpdate.bombs;

    if (bombUpdate.mapChanged) {
      const appliedMap = setSessionMap(bombUpdate.map);
      world.setMap(appliedMap);
      sendMapPacket();
    }

    if (droppedBombs.length > 0 || bombUpdate.stateChanged) {
      sendSnapshotPacket();
    }

    if (isHost() && playerLives[selfId]?.isAlive()) {
      for (let index = powerups.length - 1; index >= 0; index -= 1) {
        const powerup = powerups[index];
        if (!isPlayerOnPowerup(localPlayer, powerup)) continue;

        const [removed] = powerups.splice(index, 1);
        applyPickupEffect(removed.type, localPlayer);
        const timerEntry = powerupTimers.find((entry) => entry.powerup === removed);
        if (timerEntry) {
          clearTimeout(timerEntry.timer);
        }
        powerupTimers = powerupTimers.filter((entry) => entry.powerup !== removed);
        sendSnapshotPacket();
      }
    }
  }

  return {
    applySnapshotPowerups,
    getBombs,
    getPowerups,
    handlePickupRequest,
    hostResetPowerups,
    renderBombs,
    renderPowerups,
    simulateAuthoritativeStep,
    tryPickupPowerup,
  };
}
