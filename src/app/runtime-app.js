import { validatePlayerName, updateNameValidation, initNameUI } from '../lobby/lobby-helpers';
import { setupInput } from '../game/input';
import { initAudio, playBombDropSound, playExplosionSound } from '../game/audio/sound-manager';
import { createRuntimeEditor } from './runtime-editor.js';
import { createRuntimePowerups } from './runtime-powerups.js';
import {
  applyAuthoritativeMap as applyAuthoritativeMapImpl,
  applyPickupEffect as applyPickupEffectImpl,
  applySnapshot as applySnapshotImpl,
  getAllPlayers as getAllPlayersImpl,
  getHealthPercent as getHealthPercentImpl,
  handleResize as handleResizeImpl,
  loop as loopImpl,
  updateEditorView as updateEditorViewImpl,
  updateHpBar as updateHpBarImpl,
  updateWorldView as updateWorldViewImpl,
} from './runtime-gameplay.js';
import { resetMatch as resetMatchImpl, updateMatchTimerDisplay as updateMatchTimerDisplayImpl } from './runtime-match.js';
import {
  getActiveParticipantIds as getActiveParticipantIdsImpl,
  getSpawnPoint as getSpawnPointImpl,
  isHost as isHostImpl,
  isPeerActive as isPeerActiveImpl,
  refreshHostRole as refreshHostRoleImpl,
  sendInputPacket as sendInputPacketImpl,
  sendMapPacket as sendMapPacketImpl,
  sendSnapshotPacket as sendSnapshotPacketImpl,
  setupRoom as setupRoomImpl,
  setupUi as setupUiImpl,
  syncActiveRoster as syncActiveRosterImpl,
  updatePauseHostLabel as updatePauseHostLabelImpl,
  updatePeerCount as updatePeerCountImpl,
} from './runtime-session.js';
import {
  buildRuntimeContext,
  clock,
  editorHud,
  gameState,
  keys,
  localPlayer,
  lobbyRef,
  lobbyUI,
  newMatchBtn,
  playHud,
  playerLives,
  readyButton,
  sceneRoot,
  selfId,
  sessionState,
  setLobbyRef,
  statusLabel,
  toggleEditButton,
  togglePlayButton,
  viewPosition,
  world,
} from './runtime-context.js';

export { gameState, lobbyRef, lobbyUI, readyButton, setLobbyRef, statusLabel };

let runtimeEditor = null;
let runtimePowerups = null;

function getRuntimeContext() {
  return buildRuntimeContext({
    runtimeEditor,
    runtimePowerups,
    callbacks: {
      applyAuthoritativeMap,
      applySnapshot,
      getActiveParticipantIds,
      getAllPlayers,
      getHealthPercent,
      getSpawnPoint,
      isHost,
      isPeerActive,
      loop,
      refreshHostRole,
      resetMatch,
      sendInputPacket,
      sendMapPacket,
      sendSnapshotPacket,
      syncActiveRoster,
      updateHpBar,
      updateMatchTimerDisplay,
      updatePauseHostLabel,
      updatePeerCount,
      updateWorldView,
      updateEditorView,
    },
  });
}

function setupUi() {
  setupUiImpl(getRuntimeContext());
}

function setupRoom() {
  setupRoomImpl(getRuntimeContext());
}

function updatePeerCount() {
  updatePeerCountImpl(getRuntimeContext());
}

function sendInputPacket(force = false) {
  sendInputPacketImpl(getRuntimeContext(), force);
}

function sendSnapshotPacket(targetPeers) {
  sendSnapshotPacketImpl(getRuntimeContext(), targetPeers);
}

function sendMapPacket(targetPeers) {
  sendMapPacketImpl(getRuntimeContext(), targetPeers);
}

function updatePauseHostLabel() {
  updatePauseHostLabelImpl(getRuntimeContext());
}

function refreshHostRole(forcedHostId) {
  refreshHostRoleImpl(getRuntimeContext(), forcedHostId);
}

function isHost() {
  return isHostImpl(getRuntimeContext());
}

export function getActiveParticipantIds() {
  return getActiveParticipantIdsImpl(getRuntimeContext());
}

function isPeerActive(peerId) {
  return isPeerActiveImpl(getRuntimeContext(), peerId);
}

function getSpawnPoint(peerId) {
  return getSpawnPointImpl(getRuntimeContext(), peerId);
}

function syncActiveRoster() {
  syncActiveRosterImpl(getRuntimeContext());
}

function resetMatch() {
  resetMatchImpl(getRuntimeContext());
}

function updateMatchTimerDisplay() {
  updateMatchTimerDisplayImpl(getRuntimeContext());
}

function handleResize() {
  handleResizeImpl(getRuntimeContext());
}

function updateHpBar() {
  updateHpBarImpl(getRuntimeContext());
}

function loop() {
  loopImpl(getRuntimeContext());
}

function applyAuthoritativeMap(nextMap) {
  applyAuthoritativeMapImpl(getRuntimeContext(), nextMap);
}

function updateWorldView(delta) {
  updateWorldViewImpl(getRuntimeContext(), delta);
}

function updateEditorView(delta) {
  updateEditorViewImpl(getRuntimeContext(), delta);
}

function getAllPlayers() {
  return getAllPlayersImpl(getRuntimeContext());
}

function applySnapshot(playerStates) {
  applySnapshotImpl(getRuntimeContext(), playerStates);
}

function applyPickupEffect(type, player) {
  applyPickupEffectImpl(getRuntimeContext(), type, player);
}

function getHealthPercent(peerId) {
  return getHealthPercentImpl(getRuntimeContext(), peerId);
}

if (readyButton) {
  readyButton.addEventListener('click', () => {
    if (!sessionState.lobby) {
      return;
    }

    const name = sessionState.lobby.state.players.get(selfId)?.name ?? '';
    if (!validatePlayerName(name).valid) {
      statusLabel.textContent = 'Enter valid name first';
      return;
    }

    sessionState.lobby.handleLocalReady(true);
  });
}

if (newMatchBtn) {
  newMatchBtn.addEventListener('click', () => {
    if (!isHost()) {
      statusLabel.textContent = 'Only the host can reset the match.';
      return;
    }

    resetMatch();
    sendSnapshotPacket();
  });
}

window.addEventListener('keydown', (event) => {
  if (event.key === '1') gameState.phase = 'lobby';
  if (event.key === '2') gameState.phase = 'playing';
  if (event.key === '3') gameState.phase = 'endgame';
  if ((event.key === 'R' || event.key === 'r') && event.shiftKey && isHost()) {
    resetMatch();
    sendSnapshotPacket();
  }
});

runtimePowerups = createRuntimePowerups({
  world,
  isHost,
  localPlayer,
  selfId,
  getHostId: () => sessionState.hostId,
  getSendInput: () => sessionState.sendInput,
  playerLives,
  applyPickupEffect,
  sendSnapshotPacket,
  sendMapPacket,
  playBombDropSound,
  playExplosionSound,
});

runtimeEditor = createRuntimeEditor({
  isHost,
  statusLabel,
  playHud,
  editorHud,
  toggleEditButton,
  togglePlayButton,
  gameState,
  world,
  localPlayer,
  setupInput,
  keys,
  sceneRoot,
  viewPosition,
  handleResize,
  clock,
  updateEditorView,
});

runtimeEditor.bindToggleButtons();

world.add(localPlayer.group);
setupInput(keys);
setupRoom();
setupUi();
initNameUI();
window.addEventListener('click', () => {
  initAudio();
}, { once: true });
window.addEventListener('resize', handleResize);
requestAnimationFrame(loop);

export function setLocalPlayerName(name) {
  if (!sessionState.lobby) {
    return;
  }

  sessionState.lobby.handleLocalName(name);
  updatePauseHostLabel();
  updateNameValidation(name);
}
