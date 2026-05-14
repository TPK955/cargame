import '../style.css';
import '../scene-actor-layer.css';
import { selfId } from '@trystero-p2p/nostr';
import { createLobbyUI } from '../ui/lobby-ui';
import { createInputState } from '../game/input';
import { getActiveMap, getMapSpawn, mapCellToWorld } from '../game/map-data';
import { createPlayer, colorFromId } from '../game/players';
import { LifeSystem } from '../game/life.js';
import { Vec2 } from '../game/math';
import { createWorld } from '../game/scene';
import { initPauseMenu } from '../game/pause.js';
import { ensureHpBarFill, ensureScoreDisplay, updateScoreDisplay as renderScoreDisplay } from './runtime-hud.js';

export const playHud = document.getElementById('play-hud');
export const editorHud = document.getElementById('editor-hud');
export const roomLabel = playHud.querySelector('#room-label');
export const peerCountLabel = playHud.querySelector('#peer-count');
export const statusLabel = playHud.querySelector('#status');
export const copyLinkButton = playHud.querySelector('#copy-link');
export const newRoomButton = playHud.querySelector('#new-room');
export const pauseRoomLabel = document.getElementById('pause-room-label');
export const pauseHostLabel = document.getElementById('pause-host-label');
export const pauseCopyLinkButton = document.getElementById('pause-copy-link-btn');
export const pauseNewRoomButton = document.getElementById('pause-new-room-btn');
export const lobbyUI = createLobbyUI(playHud);
export const readyButton = playHud.querySelector('#ready-btn');
export const toggleEditButton = playHud.querySelector('#toggle-edit');
export const togglePlayButton = playHud.querySelector('#toggle-play');
export const matchTimerDisplay = document.getElementById('match-timer');
export const globalMatchTimer = document.getElementById('global-match-timer');
export const newMatchBtn = document.getElementById('new-match-btn');
export const abilityCooldownIndicator = document.getElementById('ability-cooldown-indicator');
export const abilityCooldownIcon = document.getElementById('ability-cooldown-icon');
export const heldAbilityUiElements = {
  abilitySlotLeft: document.getElementById('ability-slot-left'),
  abilitySlotLeftIcon: document.getElementById('ability-slot-left-icon'),
  abilitySlotLeftBadge: document.getElementById('ability-slot-left-badge'),
  abilitySlotRight: document.getElementById('ability-slot-right'),
  abilitySlotRightIcon: document.getElementById('ability-slot-right-icon'),
  abilitySlotRightBadge: document.getElementById('ability-slot-right-badge'),
};
export const hpBarFill = ensureHpBarFill();

export let lobbyRef = null;

export function setLobbyRef(lobby) {
  lobbyRef = lobby;
}

export const gameState = {
  phase: 'lobby',
  endgameResults: null,
};

export const runtimeConstants = {
  EDIT_CAMERA_SPEED: 30,
  INITIAL_LIFE: 15,
  LIFE_TICK_DAMAGE: 0.5,
  LIFE_TICK_INTERVAL: 0.5,
};

export const runtimeTimers = {
  matchTime: 0,
  lifeTickAccumulator: 0,
  simulationAccumulator: 0,
  snapshotAccumulator: 0,
  inputAccumulator: 0,
  lastSentInputSignature: '',
};

export const sessionState = {
  room: null,
  sendInput: null,
  receiveInput: null,
  sendSnapshot: null,
  receiveSnapshot: null,
  sendMap: null,
  receiveMap: null,
  sendLobby: null,
  receiveLobby: null,
  lobby: null,
  roomId: '',
  hostId: selfId,
};

initPauseMenu();

export const sceneRoot = document.querySelector('#scene');
export const { world, clock } = createWorld(sceneRoot);
const initialMap = getActiveMap();
const spawnPoint = mapCellToWorld(getMapSpawn(initialMap, 0).x, getMapSpawn(initialMap, 0).y);
export const keys = createInputState();
export const remotePlayers = new Map();
export const playerLives = {};
export const participantIds = new Set([selfId]);
export const viewPosition = new Vec2(spawnPoint.x, spawnPoint.y);
export const localPlayer = createPlayer(selfId, true, colorFromId(selfId), spawnPoint);

playerLives[selfId] = new LifeSystem(runtimeConstants.INITIAL_LIFE);

const scoreDisplay = ensureScoreDisplay();
if (localPlayer.score === undefined) {
  localPlayer.score = 0;
}

export function updateScoreDisplay() {
  renderScoreDisplay(scoreDisplay, localPlayer.score ?? 0);
}

export function ensureRemotePlayerWithLife(peerId, spawnPosition) {
  let player = remotePlayers.get(peerId);
  if (!player) {
    player = createPlayer(peerId, false, colorFromId(peerId), spawnPosition);
    remotePlayers.set(peerId, player);
    if (!playerLives[peerId]) {
      playerLives[peerId] = new LifeSystem(runtimeConstants.INITIAL_LIFE);
    }
  }

  if (playerLives[peerId]?.isAlive() && !player.group.parentNode) {
    world.add(player.group);
  }

  if (!playerLives[peerId]?.isAlive() && player.group.parentNode) {
    world.remove(player.group);
  }

  return player;
}

export function buildRuntimeContext({ runtimeEditor, runtimePowerups, callbacks }) {
  return {
    clock,
    constants: runtimeConstants,
    dom: {
      abilityCooldownIcon,
      abilityCooldownIndicator,
      copyLinkButton,
      editorHud,
      globalMatchTimer,
      heldAbilityUiElements,
      hpBarFill,
      matchTimerDisplay,
      newRoomButton,
      pauseCopyLinkButton,
      pauseHostLabel,
      pauseNewRoomButton,
      pauseRoomLabel,
      peerCountLabel,
      playHud,
      readyButton,
      roomLabel,
      statusLabel,
    },
    ensureRemotePlayerWithLife,
    gameState,
    keys,
    localPlayer,
    lobbyUI,
    participantIds,
    playerLives,
    remotePlayers,
    runtimeEditor,
    runtimePowerups,
    selfId,
    session: sessionState,
    setLobbyRef,
    timers: runtimeTimers,
    updateScoreDisplay,
    viewPosition,
    world,
    callbacks,
  };
}

export { selfId };
