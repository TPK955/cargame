// src/lobby/lobby-controller.js

import { createLobbyState, setPlayerReady, setPlayerName, setPlayers, allPlayersReady,} from './lobby-state';
import { statusLabel, gameState, lobbyUI } from '../main.js';
import { updateNameValidation, validatePlayerName } from './lobby-helpers.js';
import { renderUI } from '../ui/state-renderer.js';
import { shortId } from '../game/utils.js';

const nameFeedback = document.getElementById('name-feedback');
const playHud = document.getElementById('play-hud');

let lobby = null;

export function createLobbyController({
  selfId,
  isHost,
  getActiveParticipantIds,
  sendLobby,
  onStartGame = (_payload) => {
    gameState.phase = 'playing';
  },
  onStateChange = () => {
    renderUI(gameState, {
      lobby,
      playHud,
      selfId,
      shortId,
      getActiveParticipantIds
    });
  },
}) {
  const state = createLobbyState(selfId);

  function shuffleIds(ids) {
    const nextIds = [...ids];

    for (let index = nextIds.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [nextIds[index], nextIds[swapIndex]] = [nextIds[swapIndex], nextIds[index]];
    }

    return nextIds;
  }

  function ordersMatch(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((id, index) => id === right[index]);
  }

  function normalizeSpawnMode(mode) {
    return mode === 'random' ? 'random' : 'ordered';
  }

  function setSpawnState(mode, spawnOrder = state.spawnOrder) {
    state.spawnMode = normalizeSpawnMode(mode);
    state.spawnOrder = Array.isArray(spawnOrder) ? [...spawnOrder] : [];
  }

  function buildLobbyRenderOptions() {
    return {
      isHost: isHost(),
      onToggleSpawnMode: isHost() ? handleLocalSpawnMode : null,
    };
  }

  function handleLocalReady(ready) {
    if (isHost()) {
      setPlayerReady(state, selfId, ready);
      lobbyUI.render({ state }, selfId, getActiveParticipantIds, shortId, buildLobbyRenderOptions());
      broadcastState();
      onStateChange?.();
      // Host updates ready state; UI will decide when Play can be used
    } else {
      sendLobby({ type: 'ready', ready });
    }
  }

  function handleLocalName(name) {
    console.log('Setting local name to:', name);

    const validation = validatePlayerName(name);

    if (!validation.valid) {
      console.warn(validation.message);
      return;
    }
    
    setPlayerName(state, selfId, name);
    lobbyUI.render({ state }, selfId, getActiveParticipantIds, shortId, buildLobbyRenderOptions());
    onStateChange?.();

    if (isHost()) {
      broadcastState();
    } else {
      sendLobby({ type: 'name', name });
    }
  }

  function handleLocalSpawnMode(nextMode) {
    if (!isHost()) {
      return;
    }

    setSpawnState(nextMode, []);
    onStateChange?.();
    broadcastState();
  }

  function assignSpawnOrder() {
    const activeIds = getActiveParticipantIds();

    let spawnOrder = [...activeIds];

    if (state.spawnMode === 'random') {
      const orderedIds = [...activeIds];
      const previousOrder = Array.isArray(state.spawnOrder) ? [...state.spawnOrder] : [];

      spawnOrder = shuffleIds(activeIds);

      if (activeIds.length > 1) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const matchesOrdered = ordersMatch(spawnOrder, orderedIds);
          const matchesPrevious = previousOrder.length > 0 && ordersMatch(spawnOrder, previousOrder);

          if (!matchesOrdered && !matchesPrevious) {
            break;
          }

          spawnOrder = shuffleIds(activeIds);
        }

        if (ordersMatch(spawnOrder, orderedIds) || (previousOrder.length > 0 && ordersMatch(spawnOrder, previousOrder))) {
          spawnOrder = [...activeIds.slice(1), activeIds[0]];
        }
      }
    }

    setSpawnState(state.spawnMode, spawnOrder);
    return [...state.spawnOrder];
  }

  function handleMessage(payload, peerId) {
    if (!payload) return;

    if (payload.type === 'ready') {
      if (!isHost()) return;

      setPlayerReady(state, peerId, payload.ready);
      onStateChange?.();
      broadcastState();
      // Do not auto-start here; host will manually start via Play button
    }

    if (payload.type === 'name') {
      //if (!isHost()) return;

      const name = payload.name?.trim().toLowerCase();

      // Check duplicates
      const normalized = payload.name?.trim().toLowerCase();

      const alreadyTaken = Array.from(state.players.values())
        .map(p => p.name?.trim().toLowerCase())
        .filter(Boolean) // remove empty names
        .includes(normalized);

      if (alreadyTaken) {
        // Reject silently OR notify
        sendLobby({
          type: 'name-rejected',
          reason: 'Name already taken'
        }, peerId);
        return;
      }

      statusLabel.style.color = 'none';
      setPlayerName(state, peerId, payload.name.trim());
      onStateChange?.();
      broadcastState();
    }

    if (payload.type === 'state') {
      setPlayers(state, payload.players);

      state.phase = payload.phase ?? state.phase;
      setSpawnState(payload.spawnMode, payload.spawnOrder);

      onStateChange?.();

      if (payload.phase === 'playing') {
        state.phase = 'playing';
        onStartGame(payload);
      }
    }

    if (payload.type === 'start') {
      setSpawnState(payload.spawnMode, payload.spawnOrder);
      state.phase = 'playing';
      onStartGame(payload);
    }

    if (payload.type === 'name-rejected') {
        nameFeedback.textContent = "Name already taken";
        nameFeedback.className = 'name-feedback error';
    }

  }

  function broadcastState() {
    if (!isHost()) return;

    if (typeof sendLobby !== 'function') {
      console.warn('sendLobby not ready');
      return;
    }

    const players = getActiveParticipantIds().map(id => ({
      id,
      name: state.players.get(id)?.name || '',
      ready: state.players.get(id)?.ready ?? false,
    }));

    sendLobby({
      type: 'state',
      hostId: selfId,
      phase: state.phase,
      spawnMode: state.spawnMode,
      spawnOrder: state.spawnOrder,
      players,
    });
  }

  function maybeStart() {
    // Deprecated: host used to auto-start when everyone was ready.
    // We now require the host to manually start the match via the Play button.
    // Keep function for backward compatibility but do not auto-start.
    return;
  }

  return {
    state,
    assignSpawnOrder,
    handleLocalReady,
    handleLocalName,
    handleLocalSpawnMode,
    handleMessage,
  };
}
