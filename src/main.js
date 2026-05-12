// Imports
import './style.css';
import './scene-actor-layer.css';
import { joinRoom, selfId } from '@trystero-p2p/nostr';
import {
  ABILITY_DEFINITIONS,
  ABILITY_IDS,
  applyPlayerAbilitiesSnapshot,
  resetPlayerAbilities,
  serializePlayerAbilities,
  updatePlayerAbilityInput,
} from './game/abilities';
import { syncCooldownIndicator } from './game/cooldowns';
import {
  applyHeldAbilitiesSnapshot,
  applyPowerupEffect,
  collectPendingBombDrops,
  reconcileSyncedBombVisualTiming,
  renderBombEffects,
  resetHeldAbilities,
  serializeHeldAbilities,
  updateBombsState,
} from './game/powerups/effects';
import {
  INPUT_SEND_INTERVAL_MS,
  LOCAL_RECONCILE_RATE,
  MAX_PLAYERS,
  PUBLIC_ORIGIN,
  RELAY_URLS,
  REMOTE_INTERPOLATION_RATE,
  REMOTE_TIMEOUT_MS,
  ROOM_APP_ID,
  SIMULATION_STEP,
  SNAPSHOT_POSITION_SNAP_DISTANCE,
  SNAPSHOT_SEND_INTERVAL_MS,
  SNAPSHOT_VELOCITY_SNAP_DELTA,
  TURN_CREDENTIAL,
  TURN_URLS,
  TURN_USERNAME
} from './game/config';
import { createInputState, normalizeInput, readCurrentInputState, serializeInput, setupInput } from './game/input';
import { MAP_WORLD_SIZE, MAP_CELL_SIZE, WORLD_SCALE, getActiveMap, getActiveMapSlot, getMapSlot, getMapSpawn, mapCellToWorld, setSessionMap } from './game/map-data';
import { ensureRemotePlayer, colorFromId, createPlayer, syncPlayerTransform } from './game/players';
import { LifeSystem, isOnFloorOrWall } from './game/life.js';
import { createMapEditor } from './game/map-editor';
import { Vec2 } from './game/math';
import { resolveArenaCollision, resolveMapWallCollisions, resolvePlayerCollision, simulateMovement } from './game/physics';
import { createWorld } from './game/scene';
import { initAudio, updateEngineSound, playCollectSound, playCollisionSound, playDamageSound, playDespawnSound, playSpeedBoostSound, playBombDropSound, playExplosionSound, startShieldSound, stopShieldSound, startGhostSound, stopGhostSound } from './game/audio/sound-manager';
import { isLocalOrPrivateHost, lerpAngle, shortId } from './game/utils';
import { buildEndgameResults, shouldEndMatch } from './game/win/win-logic';
import { createLobbyController } from './lobby/lobby-controller';
import { createLobbyUI } from './ui/lobby-ui';
import { submitName, validatePlayerName, updateNameValidation, initNameUI } from './lobby/lobby-helpers';
import { renderUI } from './ui/state-renderer.js';

// --- Power-up pickup logic ---
// Simple circle collision for pickup
function isPlayerOnPowerup(player, powerup) {
  const playerPos = player.position;
  const powerupPos = mapCellToWorld(powerup.x, powerup.y);
  const dx = playerPos.x - powerupPos.x;
  const dy = playerPos.y - powerupPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Pickup radius: half cell size
  return dist < MAP_CELL_SIZE * 0.5;
}

// Client: send pickup request to host
function tryPickupPowerup() {
  if (isHost()) return; // Host handles in simulation
  const list = window.syncedPowerups;
  if (!Array.isArray(list)) return;
  for (const p of list) {
    if (isPlayerOnPowerup(localPlayer, p)) {
      // Send pickup request to host
      if (sendInput) sendInput({ pickup: { x: p.x, y: p.y, type: p.type } }, hostId);
      break;
    }
  }
}
// --- Power-up rendering ---
import '../src/powerup.css';
let renderedPowerupEls = [];
let renderedBombEls = [];
let bombs = [];

function renderPowerups() {
  // Remove old DOM elements
  for (const el of renderedPowerupEls) {
    if (el.parentNode) el.parentNode.removeChild(el);
  }
  renderedPowerupEls = [];

  // Get current powerup state
  const list = isHost() ? powerups : window.syncedPowerups;
  if (!Array.isArray(list)) return;
  for (const p of list) {
    const size = MAP_CELL_SIZE * 0.7 * WORLD_SCALE;
    const el = document.createElement('div');
    el.className = 'powerup-item';
    el.style.position = 'absolute';
    const worldPos = mapCellToWorld(p.x, p.y);
    el.style.left = `calc(50% + ${worldPos.x * WORLD_SCALE - size / 2}px)`;
    el.style.top = `calc(50% + ${worldPos.y * WORLD_SCALE - size / 2}px)`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.background = '#ff0';
    el.style.borderRadius = '50%';
    el.style.zIndex = 10;
    el.dataset.type = p.type;
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
// --- Host-authoritative power-up state ---
import { POWERUP_NAMES } from './game/powerups/list.js';

// Host-only: authoritative list of active power-ups
let powerups = [];
let powerupTimers = [];
let powerupSpawnAccumulator = 0;
const POWERUP_SPAWN_INTERVAL = 7; // seconds
const POWERUP_DESPAWN_TIME = 20; // seconds
const MAX_POWERUPS = 2;

function getRandomAvailableFloorTile() {
  const map = getActiveMap();
  const floorTiles = Array.isArray(map.floors) ? map.floors : [];
  if (floorTiles.length === 0) return null;
  const wallTiles = new Set((Array.isArray(map.walls) ? map.walls : []).map((tile) => `${tile.x},${tile.y}`));
  // Exclude tiles already occupied by a powerup
  const occupied = new Set(powerups.map(p => `${p.x},${p.y}`));
  const availableTiles = floorTiles.filter((tile) => {
    const key = `${tile.x},${tile.y}`;
    return !occupied.has(key) && !wallTiles.has(key);
  });
  if (availableTiles.length === 0) return null;
  const idx = Math.floor(Math.random() * availableTiles.length);
  return availableTiles[idx];
}

function hostSpawnPowerup() {
  if (powerups.length >= MAX_POWERUPS) return;
  const tile = getRandomAvailableFloorTile();
  if (!tile) return;
  const type = POWERUP_NAMES[Math.floor(Math.random() * POWERUP_NAMES.length)];
  const powerup = { x: tile.x, y: tile.y, type, spawnedAt: performance.now() / 1000 };
  powerups.push(powerup);
  // Schedule despawn
  const timer = setTimeout(() => {
    hostDespawnPowerup(powerup);
  }, POWERUP_DESPAWN_TIME * 1000);
  powerupTimers.push({ powerup, timer });
}

function hostDespawnPowerup(powerup) {
  powerups = powerups.filter(p => p !== powerup);
  const t = powerupTimers.find(t => t.powerup === powerup);
  if (t) clearTimeout(t.timer);
  powerupTimers = powerupTimers.filter(t => t.powerup !== powerup);
}

function hostResetPowerups() {
  powerups = [];
  bombs = [];
  window.syncedBombs = [];
  powerupTimers.forEach(t => clearTimeout(t.timer));
  powerupTimers = [];
  powerupSpawnAccumulator = 0;
}

// DOM/UI References
const playHud = document.getElementById('play-hud');
const editorHud = document.getElementById('editor-hud');
const eyebrowLabel = playHud.querySelector('.eyebrow');
const titleLabel = playHud.querySelector('h1');
const roomLabel = playHud.querySelector('#room-label');
const peerCountLabel = playHud.querySelector('#peer-count');
export const statusLabel = playHud.querySelector('#status');
const copyLinkButton = playHud.querySelector('#copy-link');
const newRoomButton = playHud.querySelector('#new-room');
const hintLabel = playHud.querySelector('.hint');
const actions = playHud.querySelector('.hud__actions');
export const lobbyUI = createLobbyUI(playHud);
export const readyButton = playHud?.querySelector('#ready-btn');
const toggleEditButton = playHud.querySelector('#toggle-edit');
const togglePlayButton = playHud.querySelector('#toggle-play');

// Ready button event listener
if (readyButton) {
readyButton?.addEventListener('click', () => {
  if (!lobby) return;

  const name = lobby.state.players.get(selfId)?.name ?? '';

  if (!validatePlayerName(name).valid) {
    statusLabel.textContent = 'Enter valid name first';
    return;
  }

  lobby.handleLocalReady(true);
});
}

import { initPauseMenu, setPaused, getPaused, getLastUnpausedTime, setLastUnpausedTime, setupPauseNetworking } from './game/pause.js';
let matchTime = 0;
const matchTimerDisplay = document.getElementById('match-timer');
const globalMatchTimer = document.getElementById('global-match-timer');
const newMatchBtn = document.getElementById('new-match-btn');
const abilityCooldownIndicator = document.getElementById('ability-cooldown-indicator');
const abilityCooldownIcon = document.getElementById('ability-cooldown-icon');
const abilitySlotLeft = document.getElementById('ability-slot-left');
const abilitySlotLeftIcon = document.getElementById('ability-slot-left-icon');
const abilitySlotLeftBadge = document.getElementById('ability-slot-left-badge');
const abilitySlotRight = document.getElementById('ability-slot-right');
const abilitySlotRightIcon = document.getElementById('ability-slot-right-icon');
const abilitySlotRightBadge = document.getElementById('ability-slot-right-badge');

// Lobby list container
const lobbyList = document.getElementById('lobby-list');
export let lobbyRef = null;

export function setLobbyRef(lobby) {
  lobbyRef = lobby;
}

// Game state
export const gameState = {
  phase: 'lobby', // 'lobby' | 'playing' | 'editing' | 'paused' | 'endgame'
  endgameResults: null,
};



if (newMatchBtn) {
  newMatchBtn.addEventListener('click', () => {
    if (isHost()) {
      resetMatch();
      // After resetting, broadcast new state to all peers
      sendSnapshotPacket();
    } else {
      statusLabel.textContent = 'Only the host can reset the match.';
    }
  });
}

function resetMatch() {
    if (isHost()) hostResetPowerups();
  // Only host should execute this
  if (!isHost()) return;

  const savedMap = getMapSlot(getActiveMapSlot());
  applyAuthoritativeMap(savedMap);
  sendMapPacket();

  // Reset life, score, timer, and respawn all players at spawn
  matchTime = 0;
  gameState.endgameResults = null;
  setLastUnpausedTime(performance.now());
  // Local player
  playerLives[selfId].reset(INITIAL_LIFE);
  localPlayer.score = 0;
  localPlayer.velocity.set(0, 0);
  localPlayer.impactVelocity.set(0, 0);
  resetPlayerAbilities(localPlayer);
  localPlayer.abilityInputState.speedBoostHeld = false;
  localPlayer.abilityInputState.ability1Held = false;
  localPlayer.abilityInputState.ability2Held = false;
  resetHeldAbilities(localPlayer);
  localPlayer.shield = { activeUntil: 0 };
  localPlayer.ghost = { activeUntil: 0 };
  localPlayer.pendingBombDrop = null;
  const spawn = getSpawnPoint(selfId);
  localPlayer.position.set(spawn.x, spawn.y);
  localPlayer.previousPosition.copy(localPlayer.position);
  localPlayer.targetPosition.copy(localPlayer.position);
  viewPosition.copy(localPlayer.position);
  world.setViewPosition(viewPosition.x, viewPosition.y);
  if (!localPlayer.group.parentNode) world.add(localPlayer.group);
  // Remote players
  for (const [peerId, player] of remotePlayers.entries()) {
    if (playerLives[peerId]) playerLives[peerId].reset(INITIAL_LIFE);
    player.score = 0;
    player.velocity.set(0, 0);
    player.impactVelocity.set(0, 0);
    resetPlayerAbilities(player);
    player.abilityInputState.speedBoostHeld = false;
    player.abilityInputState.ability1Held = false;
    player.abilityInputState.ability2Held = false;
    resetHeldAbilities(player);
    player.shield = { activeUntil: 0 };
    player.ghost = { activeUntil: 0 };
    player.pendingBombDrop = null;
    const spawn = getSpawnPoint(peerId);
    player.position.set(spawn.x, spawn.y);
    player.previousPosition.copy(player.position);
    player.targetPosition.copy(player.position);
    if (!player.group.parentNode) world.add(player.group);
  }
  updateHpBar();
  updateScoreDisplay();
  updateMatchTimerDisplay();

  // reset ready state after match start
  if (lobby) {
    for (const id of getActiveParticipantIds()) {
      const player = lobby.state.players.get(id);
      lobby.state.players.set(id, {name: player?.name ?? '', ready: false, });
    }
  }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateMatchTimerDisplay() {
  matchTimerDisplay.textContent = formatTime(matchTime);
  if (globalMatchTimer) globalMatchTimer.textContent = formatTime(matchTime);
}



// Initialize pause menu logic BEFORE networking
initPauseMenu();



const sceneRoot = document.querySelector('#scene');

// Create HP bar as a direct child of body for maximum overlay visibility
let hpBarContainer = document.getElementById('hp-bar-container');
let hpBarFill = null;
if (!hpBarContainer) {
  hpBarContainer = document.createElement('div');
  hpBarContainer.id = 'hp-bar-container';
  hpBarContainer.innerHTML = `
    <div id="hp-bar-bg">
      <div id="hp-bar-fill"></div>
    </div>
  `;
  document.body.appendChild(hpBarContainer);
}
hpBarFill = hpBarContainer.querySelector('#hp-bar-fill');

const { world, clock } = createWorld(sceneRoot);
const initialMap = getActiveMap();
const spawnPoint = mapCellToWorld(getMapSpawn(initialMap, 0).x, getMapSpawn(initialMap, 0).y);

const keys = createInputState();

const remotePlayers = new Map();

// Life system for all players
const playerLives = {};
const LIFE_TICK_INTERVAL = 0.5; // seconds
const LIFE_TICK_DAMAGE = 0.5;
const INITIAL_LIFE = 15;
let lifeTickAccumulator = 0;
const participantIds = new Set([selfId]);
let room = null;
let sendInput = null;
let sendSnapshot = null;
let receiveInput = null;
let receiveSnapshot = null;
let sendMap = null;
let receiveMap = null;
let sendLobby = null;
let receiveLobby = null;
let lobby = null;
let roomId = '';
let hostId = selfId;
let simulationAccumulator = 0;
let snapshotAccumulator = 0;
let inputAccumulator = 0;
let lastSentInputSignature = '';
const EDIT_CAMERA_SPEED = 30;
const viewPosition = new Vec2(spawnPoint.x, spawnPoint.y);


const localPlayer = createPlayer(selfId, true, colorFromId(selfId), spawnPoint);
playerLives[selfId] = new LifeSystem(INITIAL_LIFE);

// Score display element (must be after localPlayer is defined)
let scoreDisplay = document.getElementById('score-display');
if (!scoreDisplay) {
  scoreDisplay = document.createElement('div');
  scoreDisplay.id = 'score-display';
  document.body.appendChild(scoreDisplay);
}
if (localPlayer.score === undefined) localPlayer.score = 0;
function updateScoreDisplay() {
  scoreDisplay.textContent = `Score: ${localPlayer.score ?? 0}`;
}

function ensureRemotePlayerWithLife(remotePlayers, world, peerId, spawnPosition) {
  let player = remotePlayers.get(peerId);
  if (!player) {
    player = createPlayer(peerId, false, colorFromId(peerId), spawnPosition);
    remotePlayers.set(peerId, player);
    if (!playerLives[peerId]) playerLives[peerId] = new LifeSystem(INITIAL_LIFE);
  }
  // Always re-add car if alive and not present
  if (playerLives[peerId]?.isAlive() && !player.group.parentNode) {
    world.add(player.group);
  }
  // Always remove car if not alive and present
  if (!playerLives[peerId]?.isAlive() && player.group.parentNode) {
    world.remove(player.group);
  }
  return player;
}


let isEditMode = false;
let mapEditorInstance = null;



function enterEditMode() {
  // Only host can enter edit mode
  if (!isHost()) {
    statusLabel.textContent = 'Only the host can use the map editor.';
    return;
  }
  isEditMode = true;
  playHud.style.display = 'none';
  editorHud.style.display = '';
  // Show edit toggle
  toggleEditButton.style.display = 'none';
  togglePlayButton.style.display = '';
  // Start editor, pass editorHud as the UI container
  mapEditorInstance = startMapEditor(editorHud);
}


function exitEditMode() {
  isEditMode = false;
  playHud.style.display = '';
  editorHud.style.display = 'none';
  // Show edit toggle
  toggleEditButton.style.display = '';
  togglePlayButton.style.display = 'none';
  // Destroy editor UI if present
  if (mapEditorInstance && typeof mapEditorInstance.destroy === 'function') {
    mapEditorInstance.destroy();
    mapEditorInstance = null;
  }
  // Resume play controls and loop
  world.add(localPlayer.group);
  setupInput(keys);
  // requestAnimationFrame(loop);
}

function safeGetPlayer(id) {
  return lobby?.state.players.get(id) ?? {
    name: '',
    ready: false,
  };
}

if (toggleEditButton) {
  toggleEditButton.addEventListener('click', () => {
    if (!isEditMode) {
      gameState.phase = 'editing';
      enterEditMode();
    }
  });
}

togglePlayButton.addEventListener('click', () => {
  if (isEditMode) {
    gameState.phase = 'playing';
    exitEditMode();
  }
});


// Start in play mode
world.add(localPlayer.group);
setupInput(keys);
setupRoom();
setupUi();
initNameUI();
window.addEventListener('click', () => {  //audio context requires user interaction to start on some browsers
  initAudio();
}, { once: true });
window.addEventListener('resize', handleResize);
requestAnimationFrame(loop);



function startMapEditor(editorHudContainer) {
  // Clear previous editor HUD
  editorHudContainer.innerHTML = '';
  // Create a new HUD card for the editor
  const editorCard = document.createElement('div');
  editorCard.className = 'hud__card';
  editorHudContainer.appendChild(editorCard);
  // Create UI references for the editor
  const ui = {
    eyebrow: document.createElement('p'),
    title: document.createElement('h1'),
    roomLabel: document.createElement('p'),
    peerCountLabel: document.createElement('p'),
    statusLabel: document.createElement('p'),
    copyLinkButton: document.createElement('button'),
    newRoomButton: document.createElement('button'),
    hintLabel: document.createElement('p'),
    actions: document.createElement('div'),
  };
  ui.eyebrow.className = 'eyebrow';
  ui.roomLabel.id = 'room-label';
  ui.peerCountLabel.id = 'peer-count';
  ui.statusLabel.id = 'status';
  ui.copyLinkButton.id = 'copy-link';
  ui.newRoomButton.id = 'new-room';
  ui.hintLabel.className = 'hint';
  ui.actions.className = 'hud__actions';
  // Add Play Game button to editor HUD
  const playButton = document.createElement('button');
  playButton.id = 'editor-toggle-play';
  playButton.textContent = 'Play Game';
  playButton.style.marginRight = '0.5rem';
  playButton.onclick = () => {
    if (typeof exitEditMode === 'function') exitEditMode();
  };
  ui.actions.appendChild(playButton);
  editorCard.appendChild(ui.eyebrow);
  editorCard.appendChild(ui.title);
  editorCard.appendChild(ui.roomLabel);
  editorCard.appendChild(ui.actions);
  editorCard.appendChild(ui.hintLabel);
  editorCard.appendChild(ui.peerCountLabel);
  editorCard.appendChild(ui.statusLabel);
  editorCard.appendChild(ui.copyLinkButton);
  editorCard.appendChild(ui.newRoomButton);
  // Remove player group from world if present
  if (localPlayer.group.parentNode) {
    world.remove(localPlayer.group);
  }
  // Start editor
  const editor = createMapEditor(sceneRoot, world, ui);
  setupInput(keys);
  viewPosition.set(0, 0);
  world.setViewPosition(viewPosition.x, viewPosition.y);
  window.addEventListener('resize', handleResize);
  requestAnimationFrame(mapEditorLoop);
  return editor;
}


function mapEditorLoop() {
  if (!isEditMode) return;
  const delta = Math.min(clock.getDelta(), 0.05);
  updateEditorView(delta);
  world.render();
  requestAnimationFrame(mapEditorLoop);
}

export function setLocalPlayerName(name) {
  if (!lobby) return;

  const existing = lobby.state.players.get(selfId);
  
  lobby.handleLocalName(name);

  updateNameValidation(name);
}

function setupUi() {

  submitName();

  copyLinkButton.addEventListener('click', async () => {
    const shareLink = buildShareUrl();

    try {
      await navigator.clipboard.writeText(shareLink);
      statusLabel.textContent = `Join link copied: ${shareLink}`;
    } catch {
      statusLabel.textContent = `Clipboard access failed. Share this URL manually: ${shareLink}`;
    }
  });

  function attachNewRoomButtonHandler() {
    const btn = playHud.querySelector('#new-room');
    if (btn) {
      btn.onclick = () => {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('room', createRoomId());
        window.location.href = nextUrl.toString();
      };
    }
  }
  attachNewRoomButtonHandler();

}

function setupRoom() {
  console.log('sendLobby:', sendLobby);

  if (lobby) {
    lobby.state.players.set(selfId, { ready: false });
  }

  roomId = ensureRoomId();
  roomLabel.textContent = `Room: ${roomId}`;

  if (!canUseMultiplayer()) {
    statusLabel.textContent = `Multiplayer requires HTTPS or localhost. Open ${buildSecureRoomUrl()} instead.`;
    return;
  }

  room = joinRoom(buildRoomConfig(), roomId);
  [sendInput, receiveInput] = room.makeAction('input');
  [sendSnapshot, receiveSnapshot] = room.makeAction('snapshot');
  [sendMap, receiveMap] = room.makeAction('map');
  [sendLobby, receiveLobby] = room.makeAction('lobby');

  lobby = createLobbyController({
    selfId,
    isHost,
    getActiveParticipantIds,
    sendLobby,
    onStartGame: () => {
      // Show status
      if (isHost()) {
        statusLabel.textContent = 'Game started! \n You are the host.';
      } else {
        statusLabel.textContent = `Game started!`;
      }

      // Update lobby UI with final player statuses before starting game
      if (lobby) {
        lobbyUI.render(lobby, selfId, getActiveParticipantIds, shortId);
      }

      // Set phase and unpause
      gameState.phase = 'playing';
      setPaused(false); // Unpause if paused

      matchTime = 0;
      setLastUnpausedTime(performance.now());
      resetMatch();

      // Ensure main game loop is running
      requestAnimationFrame(loop);
    },

    lobbyRef: lobby,

  });

  // add self with empty name initially
  lobby.state.players.set(selfId, {name: lobby.state.players.get(selfId)?.name || '', ready: false, });
  setLobbyRef(lobby); // Ensure lobbyRef is set immediately
  gameState.phase = 'lobby';

  refreshHostRole();
  updatePeerCount();

  room.onPeerJoin((peerId) => {
    participantIds.add(peerId);
    syncActiveRoster();

    if (isPeerActive(peerId)) {
      ensureRemotePlayerWithLife(remotePlayers, world, peerId, getSpawnPoint(peerId));
    }

    refreshHostRole();
    updatePeerCount();

    if (isHost() && isPeerActive(peerId)) {
      sendMapPacket(peerId);
      sendSnapshotPacket(peerId);
    } else if (!isHost() && isPeerActive(selfId)) {
      sendInputPacket(true);
    }

    // Sync lobby state to new peer
    if (isHost() && lobby) {
      lobby.state.players.set(peerId, { ready: false });

      const players = getActiveParticipantIds().map(id => ({
        id,
        ready: lobby.state.players.get(id)?.ready ?? false,
      }));

      sendLobby({
        type: 'state',
        phase: lobby.state.phase,
        players,
      }, peerId);
    }

  });

  room.onPeerLeave((peerId) => {
    participantIds.delete(peerId);
    const player = remotePlayers.get(peerId);
    if (player) {
      world.remove(player.group);
      remotePlayers.delete(peerId);
    }
    syncActiveRoster();
    refreshHostRole();
    updatePeerCount();

    if (isHost()) {
      sendSnapshotPacket();
    }
  });

  receiveInput((payload, peerId) => {
    if (!isHost() || !isPeerActive(peerId)) {
      return;
    }

    const player = ensureRemotePlayerWithLife(remotePlayers, world, peerId, getSpawnPoint(peerId));
    // Power-up pickup request
    if (payload && payload.pickup) {
      // Validate pickup
      const idx = powerups.findIndex(p => p.x === payload.pickup.x && p.y === payload.pickup.y && p.type === payload.pickup.type);
      if (idx !== -1) {
        // Remove powerup
        const [removed] = powerups.splice(idx, 1);
        applyPickupEffect(removed.type, player);
        // Remove timer
        const t = powerupTimers.find(t => t.powerup === removed);
        if (t) clearTimeout(t.timer);
        powerupTimers = powerupTimers.filter(t => t.powerup !== removed);
        // Sync state
        sendSnapshotPacket();
      }
    }
    player.input = normalizeInput(payload);
    player.lastSeenAt = performance.now();
  });

  receiveSnapshot((payload, peerId) => {

    if (!payload || !Array.isArray(payload.players)) {
      return;
    }

    if (payload.phase) {
      lobby.state.phase = payload.phase;
      gameState.phase = payload.phase;
    }

    if ('endgameResults' in payload) {
      gameState.endgameResults = payload.endgameResults ?? null;
    }

    participantIds.add(peerId);
    refreshHostRole(payload.hostId ?? peerId);

    // All clients except host sync matchTime from host
    if (typeof payload.matchTime === 'number' && !isHost()) {
      matchTime = payload.matchTime;
      updateMatchTimerDisplay();
    }

    // All clients apply the full snapshot (players and powerups)
    applySnapshot(payload);
  });

  receiveMap((payload, peerId) => {
    if (!payload?.map) {
      return;
    }

    participantIds.add(peerId);
    refreshHostRole(payload.hostId ?? peerId);

    if (peerId !== hostId) {
      return;
    }

    applyAuthoritativeMap(payload.map);
  });

  receiveLobby((payload, peerId) => {
    if (!lobby) return;
    if (!payload || typeof payload !== 'object') return;
    lobby.handleMessage(payload, peerId);
  });


  playHud.style.display = 'block';
  // Pause menu UI is managed by pause.js

  // Ensure pause networking is set up for all peers after room and player are ready
  setupPauseNetworking(room, localPlayer);

}

function ensureRoomId() {
  const url = new URL(window.location.href);
  let nextRoomId = url.searchParams.get('room');

  if (!nextRoomId) {
    nextRoomId = createRoomId();
    url.searchParams.set('room', nextRoomId);
    window.history.replaceState({}, '', url);
  }

  return nextRoomId;
}

function createRoomId() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

function buildRoomConfig() {
  const config = {
    appId: ROOM_APP_ID,
  };

  if (RELAY_URLS.length > 0) {
    config.relayUrls = RELAY_URLS;
  }

  const turnServer = buildTurnServer();
  if (turnServer) {
    config.turnConfig = [turnServer];
  }

  return config;
}

function buildShareUrl() {
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('room', roomId || ensureRoomId());

  const shareOrigin = getShareOrigin();
  if (!shareOrigin) {
    return currentUrl.toString();
  }

  const shareUrl = new URL(shareOrigin);
  shareUrl.search = currentUrl.search;
  shareUrl.hash = currentUrl.hash;
  return shareUrl.toString();
}

function describeShareability() {
  const shareOrigin = getShareOrigin();

  if (shareOrigin && !isLocalOrPrivateHost(window.location.hostname)) {
    return `Public join link ready from ${shareOrigin}.`;
  }

  if (isLocalOrPrivateHost(window.location.hostname)) {
    return 'Running on a local or private host. Deploy to public HTTPS for off-network invite links.';
  }

  return 'Waiting for peers...';
}

function getShareOrigin() {
  if (PUBLIC_ORIGIN) {
    return PUBLIC_ORIGIN;
  }

  if (window.location.protocol === 'https:' && !isLocalOrPrivateHost(window.location.hostname)) {
    return window.location.origin;
  }

  return '';
}

function buildTurnServer() {
  if (TURN_URLS.length === 0) {
    return null;
  }

  return {
    urls: TURN_URLS,
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  };
}

function updatePeerCount() {
  const totalPlayers = getActiveParticipantIds().length;
  peerCountLabel.textContent = `${totalPlayers}/${MAX_PLAYERS} player${totalPlayers === 1 ? '' : 's'} active`;
}

function sendInputPacket(force = false) {
  if (isHost() || !sendInput || hostId === selfId || !isPeerActive(selfId)) {
    return;
  }

  const input = readCurrentInputState(keys);
  const signature = serializeInput(input);

  if (!force && signature === lastSentInputSignature && inputAccumulator < INPUT_SEND_INTERVAL_MS) {
    return;
  }

  inputAccumulator = 0;
  lastSentInputSignature = signature;
  sendInput(input, hostId);
}

function sendSnapshotPacket(targetPeers) {
  if (!isHost() || !sendSnapshot) {
    return;
  }

  const snapshotNow = performance.now() / 1000;
  sendSnapshot({
    hostId: selfId,
    phase: lobby?.state.phase ?? 'playing',
    endgameResults: gameState.endgameResults,
    matchTime,
    players: getAllPlayers().map((player) => ({
      id: player.id,
      x: player.position.x,
      z: player.position.y,
      heading: player.heading,
      vx: player.velocity.x,
      vz: player.velocity.y,
      ready: lobby?.state.players.get(player.id)?.ready ?? false,
      score: player.score ?? 0,
      alive: playerLives[player.id]?.isAlive?.() ?? true,
      abilities: serializePlayerAbilities(player),
      heldAbilities: serializeHeldAbilities(player),
      shield: { activeUntil: player.shield?.activeUntil ?? 0 },
      ghost: { remainingSeconds: Math.max(0, (player.ghost?.activeUntil ?? 0) - snapshotNow) },
      collected: player.collected ?? false,
      collided: player.collided ?? false,
      bombDropped: player.bombDropped ?? false
    })),
    powerups,
    bombs,
  }, targetPeers);

  // Clear transient event flags after broadcasting them once
  for (const player of getAllPlayers()) {
    player.collected = false;
    player.collided = false;
    player.bombDropped = false;
  }
}

function sendMapPacket(targetPeers) {
  if (!isHost() || !sendMap) {
    return;
  }

  sendMap({
    hostId: selfId,
    map: getActiveMap(),
  }, targetPeers);
}

function handleResize() {
  world.setSize(window.innerWidth, window.innerHeight);
}



function updateHpBar() {
  if (!hpBarFill || !playerLives[selfId]) return;
  const hp = playerLives[selfId].getLife ? playerLives[selfId].getLife() : playerLives[selfId].life;
  const maxHp = playerLives[selfId].maxLife || 15;
  const percent = Math.max(0, Math.min(1, hp / maxHp));
  // Reverse: fill from left, empty to right
  hpBarFill.style.width = (percent * 100) + '%';
}

function updateUIVisibility() {
  const isLobby = gameState.phase === 'lobby';
  const nameInputGroup = document.querySelector('.name-input-group');
  const player = lobby?.state.players.get(selfId);

  /*
  if (validatePlayerName(player?.name).valid) {
  readyButton.style.display = gameState.phase === 'lobby' && hasValidName ? 'block' : 'none';
  }*/

  if (nameInputGroup) {
    nameInputGroup.style.display = isLobby ? 'block' : 'none';
  }
  
  // Ready button visibility is handled by name validation
  // But hide it completely when not in lobby
  if (!isLobby) {
    readyButton.style.display = 'none';
  }
  
}

window.addEventListener('keydown', (e) => {
  if (e.key === '1') gameState.phase = 'lobby';
  if (e.key === '2') gameState.phase = 'playing';
  if (e.key === '3') gameState.phase = 'endgame';
});

function loop() {

  try {
  
  const handleNewMatch = () => {
    if (isHost()) {
      resetMatch();
      sendSnapshotPacket();
    }
  };

  renderUI(gameState, { lobby, playHud, selfId, shortId, getActiveParticipantIds, lobbyUI, hostId, handleNewMatch });
  if (typeof attachNewRoomButtonHandler === 'function') attachNewRoomButtonHandler();

  // LOBBY GATING
  if (gameState.phase !== 'playing') {
    world.render();
    requestAnimationFrame(loop);
    return;
  }
  updateScoreDisplay();
  updateMatchTimerDisplay();
  if (globalMatchTimer) globalMatchTimer.textContent = formatTime(matchTime);
  const delta = Math.min(clock.getDelta(), 0.05);

  if (!getPaused()) {
    // Timer only runs when not paused
    if (isHost()) {
      matchTime += (performance.now() - getLastUnpausedTime()) / 1000;
    }
    setLastUnpausedTime(performance.now());

    // Host loop
    if (isHost()) {
      localPlayer.input = readCurrentInputState(keys);
      simulationAccumulator += delta;

      while (simulationAccumulator >= SIMULATION_STEP) {
        simulateAuthoritativeStep(SIMULATION_STEP);
        simulationAccumulator -= SIMULATION_STEP;
      }

      snapshotAccumulator += delta * 1000;
      if (snapshotAccumulator >= SNAPSHOT_SEND_INTERVAL_MS) {
        snapshotAccumulator = 0;
        sendSnapshotPacket();
      }

      syncPlayerTransform(localPlayer);
      for (const remote of remotePlayers.values()) {
        syncPlayerTransform(remote);
      }
    } else {
      inputAccumulator += delta * 1000;
      updatePredictedLocalPlayer(delta);
      updateRemotePlayers(delta);

      sendInputPacket();
    }

    // Life system tick: damage if outside floor/wall every 0.5s
    lifeTickAccumulator += delta;
    if (lifeTickAccumulator >= LIFE_TICK_INTERVAL) {
      lifeTickAccumulator = 0;
      const map = getActiveMap();
      // Local player
      if (playerLives[selfId].isAlive() && !isOnFloorOrWall(localPlayer, { ...map, MAP_WORLD_SIZE, MAP_CELL_SIZE })) {
        playerLives[selfId].loseLife(LIFE_TICK_DAMAGE);
        playDamageSound();
        if (!playerLives[selfId].isAlive()) {
          playDespawnSound();
          // Despawn car
          if (localPlayer.group.parentNode) world.remove(localPlayer.group);
          // Award 1 point to all alive remote players
          for (const [peerId, remoteLife] of Object.entries(playerLives)) {
            if (peerId !== selfId && remoteLife.isAlive() && remotePlayers.has(peerId) && remotePlayers.get(peerId).score !== undefined) {
              remotePlayers.get(peerId).score += 1;
            }
          }
        }
      }
      // Remote players
      for (const [peerId, player] of remotePlayers.entries()) {
        if (playerLives[peerId].isAlive() && !isOnFloorOrWall(player, { ...map, MAP_WORLD_SIZE, MAP_CELL_SIZE })) {
          playerLives[peerId].loseLife(LIFE_TICK_DAMAGE);
          playDamageSound();
          if (!playerLives[peerId].isAlive()) {
            playDespawnSound();
            // Despawn car
            if (player.group.parentNode) world.remove(player.group);
            // Award 1 point to all alive players except eliminated
            if (localPlayer && playerLives[selfId].isAlive() && localPlayer.score !== undefined) {
              localPlayer.score += 1;
            }
            for (const [otherPeerId, otherPlayer] of remotePlayers.entries()) {
              if (otherPeerId !== peerId && playerLives[otherPeerId].isAlive() && otherPlayer.score !== undefined) {
                otherPlayer.score += 1;
              }
            }
          }
        }
      }

      maybeFinishMatch();
    }
  } else {
    // If paused, just update the lastUnpausedTime so timer resumes smoothly
    setLastUnpausedTime(performance.now());
  }

  updateHpBar();
  syncCooldownIndicator(
    abilityCooldownIndicator,
    abilityCooldownIcon,
    ABILITY_DEFINITIONS[ABILITY_IDS.SPEED_BOOST],
    localPlayer.abilities?.[ABILITY_IDS.SPEED_BOOST],
    performance.now() / 1000
  );
  updateHeldAbilitySlots();

  const nowSeconds = performance.now() / 1000;

  const shieldActive = (localPlayer.shield?.activeUntil || 0) > nowSeconds;
  const ghostActive = (localPlayer.ghost?.activeUntil || 0) > nowSeconds;

  if (shieldActive) {
    startShieldSound();
  } else {
    stopShieldSound();
  }

  if (ghostActive) {
    startGhostSound();
  } else {
    stopGhostSound();
  }

  // Camera logic: follow car in play mode, free move in edit mode or if eliminated
  if (isEditMode || !playerLives[selfId]?.isAlive()) {
    updateEditorView(delta);
  } else {
    updateWorldView(delta);
  }

  renderPowerups();
  renderBombs();
  tryPickupPowerup();
  world.render();

  // Engine sound update
  const t = localPlayer.speedRamp || 0;

  const boostActive =
    localPlayer.abilities?.speedBoost?.activeUntil > (performance.now() / 1000);

  if (playerLives[selfId]?.isAlive()) {
    updateEngineSound(
      t,
      boostActive ? 1 : 0
    );
  } else {
    localPlayer.speedRamp = 0;
    updateEngineSound(0, 0);
  }

  requestAnimationFrame(loop);

  } catch (err) {
  console.error('LOOP ERROR:', err);
}

function maybeFinishMatch() {
  if (!isHost() || gameState.phase !== 'playing') {
    return;
  }

  const activeParticipantIds = getActiveParticipantIds();
  if (!shouldEndMatch(playerLives, activeParticipantIds)) {
    return;
  }

  gameState.endgameResults = buildEndgameResults({
    playerLives,
    participantIds: activeParticipantIds,
    getPlayerById: (id) => {
      if (id === selfId) return localPlayer;
      return remotePlayers.get(id) ?? null;
    },
    getDisplayName: (id) => lobby?.state?.players?.get(id)?.name?.trim() || shortId(id),
  });

  gameState.phase = 'endgame';
  if (lobby) {
    lobby.state.phase = 'endgame';
  }

  sendSnapshotPacket();
}

function setAbilitySlot(slot, iconEl, badgeEl, heldAbility) {
  if (!slot || !iconEl || !badgeEl) {
    return;
  }

  if (heldAbility && heldAbility.charges > 0) {
    slot.dataset.empty = 'false';
    if (heldAbility.type === 'shield') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2L4 5v6c0 5.6 3.8 9.9 8 11 4.2-1.1 8-5.4 8-11V5l-8-3zm0 2.2l6 2.2V11c0 4.4-2.8 8.1-6 9.2-3.2-1.1-6-4.8-6-9.2V6.4l6-2.2z"/></svg>';
      slot.dataset.ability = 'shield';
    } else if (heldAbility.type === 'ghost') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3c-4.1 0-7 3-7 7.2V21l3-2.1L12 21l4-2.1 3 2.1V10.2C19 6 16.1 3 12 3zm3.8 12.2c-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3 1.3.6 1.3 1.3-.6 1.3-1.3 1.3zm-7.6 0c-.7 0-1.3-.6-1.3-1.3s.6-1.3 1.3-1.3 1.3.6 1.3 1.3-.6 1.3-1.3 1.3zm1 2.5c.8-.9 1.7-1.3 2.8-1.3s2 .4 2.8 1.3l.7-.6c-.9-1.2-2.1-1.8-3.5-1.8s-2.6.6-3.5 1.8l.7.6z"/></svg>';
      slot.dataset.ability = 'ghost';
    } else if (heldAbility.type === 'icebomb') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="13.5" r="6.5" fill="currentColor"/><path d="M10.5 6.8 13 4.3l2.7 2.7-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 3.2v2.2M17.4 4.3h2.2M17.9 3.7l1.2 1.2M17.9 4.9l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M6.8 11.2h7.6M6.8 13.6h7.6M6.8 16h7.6" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="0.9" stroke-linecap="round"/></svg>';
      slot.dataset.ability = 'icebomb';
    } else if (heldAbility.type === 'bomb') {
      iconEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="13.5" r="6.5" fill="currentColor"/><path d="M10.5 6.8 13 4.3l2.7 2.7-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.9 3.5h1.2M17.5 2.9v1.2M16.2 2.2l.8.8M16.2 4.8l.8-.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8.6" cy="11.4" r="1.2" fill="rgba(255,255,255,0.35)"/></svg>';
      slot.dataset.ability = 'bomb';
    } else {
      iconEl.textContent = '?';
      slot.dataset.ability = heldAbility.type;
    }
    if (heldAbility.charges > 1) {
      badgeEl.textContent = String(heldAbility.charges);
      badgeEl.style.display = 'inline-flex';
    } else {
      badgeEl.textContent = '';
      badgeEl.style.display = 'none';
    }
    return;
  }

  slot.dataset.empty = 'true';
  slot.dataset.ability = 'none';
  iconEl.textContent = '';
  iconEl.innerHTML = '';
  badgeEl.textContent = '';
  badgeEl.style.display = 'none';
}

function updateHeldAbilitySlots() {
  const heldAbilities = Array.isArray(localPlayer?.heldAbilities) ? localPlayer.heldAbilities : [];
  setAbilitySlot(abilitySlotLeft, abilitySlotLeftIcon, abilitySlotLeftBadge, heldAbilities[0] ?? null);
  setAbilitySlot(abilitySlotRight, abilitySlotRightIcon, abilitySlotRightBadge, heldAbilities[1] ?? null);
}
}

function updateLocalPlayerAbilityInput(player, input, now) {
  const speedBoostHeld = Boolean(input?.speedBoost);
  const boostJustPressed = speedBoostHeld && !player.abilityInputState?.speedBoostHeld;
  updatePlayerAbilityInput(player, input, now);
  if (boostJustPressed) {
    playSpeedBoostSound();
  }
}

function updatePredictedLocalPlayer(delta) {
  const input = readCurrentInputState(keys);
  const now = performance.now() / 1000;
  updateLocalPlayerAbilityInput(localPlayer, input, now);
  simulateMovement(localPlayer, input, delta, now);
  resolveArenaCollision(localPlayer);
  resolveMapWallCollisions(localPlayer);
  reconcileLocalPlayer(delta);
  syncPlayerTransform(localPlayer);
}

function updateRemotePlayers(delta) {
  const now = performance.now();

  for (const [peerId, player] of remotePlayers.entries()) {
    if (now - player.lastSeenAt > REMOTE_TIMEOUT_MS) {
      world.remove(player.group);
      remotePlayers.delete(peerId);
      updatePeerCount();
      continue;
    }

    player.position.lerp(player.targetPosition, Math.min(1, delta * REMOTE_INTERPOLATION_RATE));
    player.velocity.lerp(player.targetVelocity, Math.min(1, delta * 6));
    player.heading = lerpAngle(player.heading, player.targetHeading, Math.min(1, delta * 10));
    syncPlayerTransform(player);
  }
}

function applyAuthoritativeMap(nextMap) {
  const appliedMap = setSessionMap(nextMap);
  world.setMap(appliedMap);
  syncActiveRoster();

  if (!isHost()) {
    const localSpawn = getSpawnPoint(selfId);
    localPlayer.position.set(localSpawn.x, localSpawn.y);
    localPlayer.previousPosition.copy(localPlayer.position);
    localPlayer.targetPosition.copy(localPlayer.position);
    viewPosition.copy(localPlayer.position);
    world.setViewPosition(viewPosition.x, viewPosition.y);
  }
}

function reconcileLocalPlayer(delta) {
  if (!localPlayer.hasSnapshot) {
    return;
  }

  localPlayer.position.lerp(localPlayer.targetPosition, Math.min(1, delta * LOCAL_RECONCILE_RATE));
  localPlayer.velocity.lerp(localPlayer.targetVelocity, Math.min(1, delta * 6));
  localPlayer.heading = lerpAngle(
    localPlayer.heading,
    localPlayer.targetHeading,
    Math.min(1, delta * LOCAL_RECONCILE_RATE)
  );
}

function updateWorldView(delta) {
  viewPosition.lerp(localPlayer.position, Math.min(1, delta * 5.5));
  world.setViewPosition(viewPosition.x, viewPosition.y);
}

function updateEditorView(delta) {
  const viewStep = EDIT_CAMERA_SPEED * delta;

  if (keys.forward) {
    viewPosition.y -= viewStep;
  }

  if (keys.backward) {
    viewPosition.y += viewStep;
  }

  if (keys.left) {
    viewPosition.x -= viewStep;
  }

  if (keys.right) {
    viewPosition.x += viewStep;
  }

  world.setViewPosition(viewPosition.x, viewPosition.y);
}

function getAllPlayers() {
  const players = [];
  if (isPeerActive(selfId)) {
    players.push(localPlayer);
  }

  return [...players, ...remotePlayers.values()];
}

function simulateAuthoritativeStep(delta) {
    // Host: spawn powerups on timer
    if (isHost()) {
      powerupSpawnAccumulator += delta;
      if (powerupSpawnAccumulator >= POWERUP_SPAWN_INTERVAL) {
        powerupSpawnAccumulator = 0;
        hostSpawnPowerup();
      }
    }
  // Only include alive players for movement and collision
  const players = getAllPlayers().filter(p => {
    if (p.id === selfId) return playerLives[selfId]?.isAlive();
    return playerLives[p.id]?.isAlive();
  });

  for (const player of players) {
    const input = player.isLocal
      ? readCurrentInputState(keys)
      : (player.input ?? { forward: false, backward: false, left: false, right: false, strafeLeft: false, strafeRight: false });
    const now = performance.now() / 1000;
    if (player.isLocal) {
      updateLocalPlayerAbilityInput(player, input, now);
    } else {
      updatePlayerAbilityInput(player, input, now);
    }
    simulateMovement(player, input, delta, now);
    
    // Check for collisions with arena and walls
    const prevPosX = player.position.x;
    const prevPosY = player.position.y;
    resolveArenaCollision(player);
    resolveMapWallCollisions(player);
    const arenaOrWallCollided = prevPosX !== player.position.x || prevPosY !== player.position.y;
    if (arenaOrWallCollided && !player.collided) {
      playCollisionSound();
      player.collided = true;
    }
  }

  // Only resolve collisions between alive players
  for (let index = 0; index < players.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < players.length; otherIndex += 1) {
      const prevPos1X = players[index].position.x;
      const prevPos1Y = players[index].position.y;
      const prevPos2X = players[otherIndex].position.x;
      const prevPos2Y = players[otherIndex].position.y;
      
      resolvePlayerCollision(players[index], players[otherIndex]);
      
      // Check if this collision event moved either player (indicates contact)
      const didCollide1 = prevPos1X !== players[index].position.x || prevPos1Y !== players[index].position.y;
      const didCollide2 = prevPos2X !== players[otherIndex].position.x || prevPos2Y !== players[otherIndex].position.y;
      if ((didCollide1 || didCollide2) && (!players[index].collided || !players[otherIndex].collided)) {
        playCollisionSound();
        players[index].collided = true;
        players[otherIndex].collided = true;
      }
    }
  }

  const now = performance.now() / 1000;
  const droppedBombs = collectPendingBombDrops(players, now);
  if (droppedBombs.length > 0) {
    bombs.push(...droppedBombs);
    playBombDropSound();
  }

  const bombUpdate = updateBombsState(bombs, players, getActiveMap(), now);

  // Play explosion sound when a bomb transitions into its exploded state
  for (const nextBomb of bombUpdate.bombs) {
    if (nextBomb.explodeAt) {
      const previousBomb = bombs.find((b) => b.id === nextBomb.id);
      if (!previousBomb?.explodeAt) {
        playExplosionSound();
      }
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

  // Host: check if local player picks up any power-up
  if (isHost() && playerLives[selfId]?.isAlive()) {
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      if (isPlayerOnPowerup(localPlayer, p)) {
        // Remove powerup
        const [removed] = powerups.splice(i, 1);
        applyPickupEffect(removed.type, localPlayer);
        // Remove timer
        const t = powerupTimers.find(t => t.powerup === removed);
        if (t) clearTimeout(t.timer);
        powerupTimers = powerupTimers.filter(t => t.powerup !== removed);
        // Sync state
        sendSnapshotPacket();
      }
    }
  }
}

function applySnapshot(playerStates) {
  const now = performance.now();

  // Accepts either (players) or ({ players, powerups, bombs })
  let playerList = playerStates;
  let powerupList = undefined;
  let bombList = undefined;
  if (Array.isArray(playerStates)) {
    playerList = playerStates;
  } else if (playerStates && typeof playerStates === 'object') {
    playerList = playerStates.players;
    powerupList = playerStates.powerups;
    bombList = playerStates.bombs;
  }

  // Store powerup state for rendering (client only)
  if (!isHost() && Array.isArray(powerupList)) {
    window.syncedPowerups = powerupList;
  }
  if (!isHost() && Array.isArray(bombList)) {
    const previousSyncedBombs = window.syncedBombs ?? [];
    window.syncedBombs = reconcileSyncedBombVisualTiming(
      window.syncedBombs,
      bombList,
      performance.now() / 1000
    );
    for (const bomb of window.syncedBombs) {
      if (!bomb.explodeAt) continue;
      const prevBomb = previousSyncedBombs.find((prev) => prev.id === bomb.id && prev.explodeAt);
      if (!prevBomb) {
        playExplosionSound();
      }
    }
  }

  for (const playerState of playerList) {
    if (playerState.id === selfId) {
      if (!isHost()) {
        localPlayer.targetPosition.set(playerState.x, playerState.z);
        localPlayer.targetVelocity.set(playerState.vx, playerState.vz);
        localPlayer.targetHeading = playerState.heading;
        applyPlayerAbilitiesSnapshot(localPlayer, playerState.abilities)        
        applyHeldAbilitiesSnapshot(localPlayer, playerState.heldAbilities);

        if (playerState.collected) {
          playCollectSound();
        }

        if (playerState.collided) {
          playCollisionSound();
        }

        if (playerState.bombDropped) {
          playBombDropSound();
        }

        if (playerState.shield) {
          if (!localPlayer.shield) localPlayer.shield = { activeUntil: 0 };
          localPlayer.shield.activeUntil = playerState.shield.activeUntil;
        }
        if (playerState.ghost) {
          if (!localPlayer.ghost) localPlayer.ghost = { activeUntil: 0 };
          localPlayer.ghost.activeUntil = playerState.ghost.remainingSeconds > 0
            ? performance.now() / 1000 + playerState.ghost.remainingSeconds
            : 0;
        }
        localPlayer.pendingBombDrop = null;
        localPlayer.hasSnapshot = true;
        localPlayer.lastSeenAt = now;
      }

      continue;
    }

    const player = ensureRemotePlayerWithLife(
      remotePlayers,
      world,
      playerState.id,
      { x: playerState.x, y: playerState.z }
    );

    // FORCE spawn sync from host
    if (!player.hasSpawned) {
      player.position.set(playerState.x, playerState.z);
      player.targetPosition.copy(player.position);
      player.hasSpawned = true;
    }

    if (!player) return; // this causes more problems

    const positionError = player.position.distanceTo(new Vec2(playerState.x, playerState.z));
    const velocityError = player.velocity.distanceTo(new Vec2(playerState.vx, playerState.vz));
    const shouldSnapToSnapshot = positionError >= SNAPSHOT_POSITION_SNAP_DISTANCE
      || velocityError >= SNAPSHOT_VELOCITY_SNAP_DELTA;

    player.targetPosition.set(playerState.x, playerState.z);
    player.targetVelocity.set(playerState.vx, playerState.vz);
    player.targetHeading = playerState.heading;
    applyPlayerAbilitiesSnapshot(player, playerState.abilities);
    applyHeldAbilitiesSnapshot(player, playerState.heldAbilities);
    if (playerState.shield) {
      if (!player.shield) player.shield = { activeUntil: 0 };
      player.shield.activeUntil = playerState.shield.activeUntil;
    }
    if (playerState.ghost) {
      if (!player.ghost) player.ghost = { activeUntil: 0 };
      player.ghost.activeUntil = playerState.ghost.remainingSeconds > 0
        ? performance.now() / 1000 + playerState.ghost.remainingSeconds
        : 0;
    }
    player.pendingBombDrop = null;
    player.lastSeenAt = now;

    if (shouldSnapToSnapshot) {
      player.position.copy(player.targetPosition);
      player.velocity.copy(player.targetVelocity);
      player.heading = player.targetHeading;
    }

    if (isHost()) {
      player.position.set(playerState.x, playerState.z);
      player.velocity.set(playerState.vx, playerState.vz);
      player.heading = playerState.heading;
    }
  }
}

function applyPickupEffect(type, player) {
  applyPowerupEffect(type, player);

  player.collected = true;

  if (player.isLocal) {
    playCollectSound();
  }
}

// Only update hostId from host packets or on join/leave
function refreshHostRole(forcedHostId) {
  if (typeof forcedHostId === 'string') {
    hostId = forcedHostId;
  } else if (participantIds.size > 0) {
    // Only recalculate on join/leave
    hostId = [...participantIds].sort()[0] ?? selfId;
  }

  if (!isPeerActive(selfId)) {
    statusLabel.textContent = `Room full. Only ${MAX_PLAYERS} players can be active.`;
  } else if (isHost()) {
    statusLabel.textContent = 'You are the authoritative host.';
  } else {
    statusLabel.textContent = `Authoritative host: ${shortId(hostId)}`;
  }
}

function isHost() {
  return hostId === selfId;
}

export function getActiveParticipantIds() {
  return [...participantIds].slice(0, MAX_PLAYERS);
}

function isPeerActive(peerId) {
  return getActiveParticipantIds().includes(peerId);
}

function getSpawnPoint(peerId) {
  const spawnIndex = Math.max(0, getActiveParticipantIds().indexOf(peerId));
  const spawnCell = getMapSpawn(getActiveMap(), spawnIndex);
  return mapCellToWorld(spawnCell.x, spawnCell.y);
}

function canUseMultiplayer() {
  return window.isSecureContext && typeof RTCPeerConnection !== 'undefined' && Boolean(globalThis.crypto?.subtle);
}

function buildSecureRoomUrl() {
  const secureUrl = new URL(window.location.href);
  secureUrl.protocol = 'https:';
  secureUrl.searchParams.set('room', roomId || ensureRoomId());
  return secureUrl.toString();
}

function syncActiveRoster() {
  for (const [peerId, player] of remotePlayers.entries()) {
    if (!isPeerActive(peerId)) {
      world.remove(player.group);
      remotePlayers.delete(peerId);
    }
  }

  if (!isPeerActive(selfId) && localPlayer.group.parentNode) {
    world.remove(localPlayer.group);
  } else if (isPeerActive(selfId) && !localPlayer.group.parentNode) {
    const spawnPoint = getSpawnPoint(selfId);
    localPlayer.position.set(spawnPoint.x, spawnPoint.y);
    localPlayer.previousPosition.copy(localPlayer.position);
    localPlayer.targetPosition.copy(localPlayer.position);
    viewPosition.copy(localPlayer.position);
    world.setViewPosition(viewPosition.x, viewPosition.y);
    world.add(localPlayer.group);
  }
}