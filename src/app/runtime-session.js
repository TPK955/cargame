import { joinRoom } from '@trystero-p2p/nostr';
import { serializePlayerAbilities } from '../game/abilities';
import { INPUT_SEND_INTERVAL_MS, MAX_PLAYERS } from '../game/config';
import { normalizeInput, readCurrentInputState, serializeInput } from '../game/input';
import { getActiveMap, getMapSpawn, mapCellToWorld } from '../game/map-data';
import { setupPauseNetworking, setPaused, setLastUnpausedTime } from '../game/pause.js';
import { serializeHeldAbilities } from '../game/powerups/effects';
import { shortId } from '../game/utils';
import { createLobbyController } from '../lobby/lobby-controller';
import { submitName } from '../lobby/lobby-helpers';
import { getPlayerLifeValue } from './runtime-life.js';
import {
  buildRoomConfig,
  buildSecureRoomUrl,
  buildShareUrl,
  canUseMultiplayer,
  createRoomId,
  ensureRoomId,
} from './runtime-room.js';

export function setupUi(context) {
  const { dom, session } = context;

  submitName();

  const handleCopyJoinLink = async () => {
    const shareLink = buildShareUrl(session.roomId);

    try {
      await navigator.clipboard.writeText(shareLink);
      dom.statusLabel.textContent = `Join link copied: ${shareLink}`;
    } catch {
      dom.statusLabel.textContent = `Clipboard access failed. Share this URL manually: ${shareLink}`;
    }
  };

  const handleNewRoom = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('room', createRoomId());
    window.location.href = nextUrl.toString();
  };

  if (dom.copyLinkButton) {
    dom.copyLinkButton.addEventListener('click', handleCopyJoinLink);
  }

  if (dom.pauseCopyLinkButton) {
    dom.pauseCopyLinkButton.addEventListener('click', handleCopyJoinLink);
  }

  if (dom.newRoomButton) {
    dom.newRoomButton.onclick = handleNewRoom;
  }

  if (dom.pauseNewRoomButton) {
    dom.pauseNewRoomButton.onclick = handleNewRoom;
  }
}

export function setupRoom(context) {
  const { callbacks, dom, gameState, localPlayer, participantIds, remotePlayers, runtimePowerups, selfId, session, timers, world } = context;

  if (session.lobby) {
    session.lobby.state.players.set(selfId, { ready: false });
  }

  session.roomId = ensureRoomId();
  dom.roomLabel.textContent = `Room: ${session.roomId}`;
  if (dom.pauseRoomLabel) {
    dom.pauseRoomLabel.textContent = `Room: ${session.roomId}`;
  }

  if (!canUseMultiplayer()) {
    dom.statusLabel.textContent = `Multiplayer requires HTTPS or localhost. Open ${buildSecureRoomUrl(session.roomId)} instead.`;
    return;
  }

  session.room = joinRoom(buildRoomConfig(), session.roomId);
  [session.sendInput, session.receiveInput] = session.room.makeAction('input');
  [session.sendSnapshot, session.receiveSnapshot] = session.room.makeAction('snapshot');
  [session.sendMap, session.receiveMap] = session.room.makeAction('map');
  [session.sendLobby, session.receiveLobby] = session.room.makeAction('lobby');

  session.lobby = createLobbyController({
    selfId,
    isHost: callbacks.isHost,
    getActiveParticipantIds: callbacks.getActiveParticipantIds,
    sendLobby: session.sendLobby,
    onStartGame: () => {
      dom.statusLabel.textContent = callbacks.isHost()
        ? 'Game started! \n You are the host.'
        : 'Game started!';

      if (session.lobby) {
        context.lobbyUI.render(session.lobby, selfId, callbacks.getActiveParticipantIds, shortId);
      }

      gameState.phase = 'playing';
      setPaused(false);
      timers.matchTime = 0;
      setLastUnpausedTime(performance.now());
      callbacks.resetMatch();
      requestAnimationFrame(callbacks.loop);
    },
  });

  session.lobby.state.players.set(selfId, {
    name: session.lobby.state.players.get(selfId)?.name || '',
    ready: false,
  });
  context.setLobbyRef(session.lobby);
  gameState.phase = 'lobby';

  callbacks.refreshHostRole();
  updatePeerCount(context);

  session.room.onPeerJoin((peerId) => {
    participantIds.add(peerId);
    callbacks.syncActiveRoster();

    if (callbacks.isPeerActive(peerId)) {
      context.ensureRemotePlayerWithLife(peerId, callbacks.getSpawnPoint(peerId));
    }

    callbacks.refreshHostRole();
    updatePeerCount(context);

    if (callbacks.isHost() && callbacks.isPeerActive(peerId)) {
      sendMapPacket(context, peerId);
      sendSnapshotPacket(context, peerId);
    } else if (!callbacks.isHost() && callbacks.isPeerActive(selfId)) {
      sendInputPacket(context, true);
    }

    if (callbacks.isHost() && session.lobby) {
      session.lobby.state.players.set(peerId, { ready: false });

      const players = callbacks.getActiveParticipantIds().map((id) => ({
        id,
        ready: session.lobby.state.players.get(id)?.ready ?? false,
      }));

      session.sendLobby({
        type: 'state',
        phase: session.lobby.state.phase,
        players,
      }, peerId);
    }
  });

  session.room.onPeerLeave((peerId) => {
    participantIds.delete(peerId);
    const player = remotePlayers.get(peerId);
    if (player) {
      world.remove(player.group);
      remotePlayers.delete(peerId);
    }
    callbacks.syncActiveRoster();
    callbacks.refreshHostRole();
    updatePeerCount(context);

    if (callbacks.isHost()) {
      sendSnapshotPacket(context);
    }
  });

  session.receiveInput((payload, peerId) => {
    if (!callbacks.isHost() || !callbacks.isPeerActive(peerId)) {
      return;
    }

    const player = context.ensureRemotePlayerWithLife(peerId, callbacks.getSpawnPoint(peerId));
    if (payload?.pickup) {
      runtimePowerups.handlePickupRequest(payload.pickup, player);
    }
    player.input = normalizeInput(payload);
    player.lastSeenAt = performance.now();
  });

  session.receiveSnapshot((payload, peerId) => {
    if (!payload || !Array.isArray(payload.players)) {
      return;
    }

    if (payload.phase) {
      session.lobby.state.phase = payload.phase;
      gameState.phase = payload.phase;
    }

    if ('endgameResults' in payload) {
      gameState.endgameResults = payload.endgameResults ?? null;
    }

    participantIds.add(peerId);
    callbacks.refreshHostRole(payload.hostId ?? peerId);

    if (typeof payload.matchTime === 'number' && !callbacks.isHost()) {
      timers.matchTime = payload.matchTime;
      callbacks.updateMatchTimerDisplay();
    }

    callbacks.applySnapshot(payload);
  });

  session.receiveMap((payload, peerId) => {
    if (!payload?.map) {
      return;
    }

    participantIds.add(peerId);
    callbacks.refreshHostRole(payload.hostId ?? peerId);

    if (peerId !== session.hostId) {
      return;
    }

    callbacks.applyAuthoritativeMap(payload.map);
  });

  session.receiveLobby((payload, peerId) => {
    if (!session.lobby || !payload || typeof payload !== 'object') {
      return;
    }

    session.lobby.handleMessage(payload, peerId);
    updatePauseHostLabel(context);
  });

  dom.playHud.style.display = 'block';
  setupPauseNetworking(session.room, localPlayer);
}

export function updatePeerCount(context) {
  const { callbacks, dom } = context;
  const totalPlayers = callbacks.getActiveParticipantIds().length;
  dom.peerCountLabel.textContent = `${totalPlayers}/${MAX_PLAYERS} player${totalPlayers === 1 ? '' : 's'} active`;
}

export function sendInputPacket(context, force = false) {
  const { callbacks, keys, selfId, session, timers } = context;

  if (callbacks.isHost() || !session.sendInput || session.hostId === selfId || !callbacks.isPeerActive(selfId)) {
    return;
  }

  const input = readCurrentInputState(keys);
  const signature = serializeInput(input);

  if (!force && signature === timers.lastSentInputSignature && timers.inputAccumulator < INPUT_SEND_INTERVAL_MS) {
    return;
  }

  timers.inputAccumulator = 0;
  timers.lastSentInputSignature = signature;
  session.sendInput(input, session.hostId);
}

export function sendSnapshotPacket(context, targetPeers) {
  const { callbacks, constants, gameState, playerLives, runtimePowerups, selfId, session, timers } = context;

  if (!callbacks.isHost() || !session.sendSnapshot) {
    return;
  }

  const snapshotNow = performance.now() / 1000;
  session.sendSnapshot({
    hostId: selfId,
    phase: session.lobby?.state.phase ?? 'playing',
    endgameResults: gameState.endgameResults,
    matchTime: timers.matchTime,
    players: callbacks.getAllPlayers().map((player) => ({
      id: player.id,
      x: player.position.x,
      z: player.position.y,
      heading: player.heading,
      vx: player.velocity.x,
      vz: player.velocity.y,
      ready: session.lobby?.state.players.get(player.id)?.ready ?? false,
      score: player.score ?? 0,
      alive: playerLives[player.id]?.isAlive?.() ?? true,
      life: getPlayerLifeValue(playerLives, player.id, constants.INITIAL_LIFE),
      maxLife: playerLives[player.id]?.maxLife ?? constants.INITIAL_LIFE,
      abilities: serializePlayerAbilities(player),
      heldAbilities: serializeHeldAbilities(player),
      shield: { activeUntil: player.shield?.activeUntil ?? 0 },
      ghost: { remainingSeconds: Math.max(0, (player.ghost?.activeUntil ?? 0) - snapshotNow) },
      collected: player.collected ?? false,
      collided: player.collided ?? false,
      bombDropped: player.bombDropped ?? false,
    })),
    powerups: runtimePowerups.getPowerups(),
    bombs: runtimePowerups.getBombs(),
  }, targetPeers);

  for (const player of callbacks.getAllPlayers()) {
    player.collected = false;
    player.collided = false;
    player.bombDropped = false;
  }
}

export function sendMapPacket(context, targetPeers) {
  const { callbacks, selfId, session } = context;

  if (!callbacks.isHost() || !session.sendMap) {
    return;
  }

  session.sendMap({
    hostId: selfId,
    map: getActiveMap(),
  }, targetPeers);
}

export function getPlayerDisplayName(context, peerId) {
  const playerName = context.session.lobby?.state?.players?.get(peerId)?.name?.trim();
  return playerName || shortId(peerId);
}

export function updatePauseHostLabel(context) {
  const { dom, session } = context;
  if (!dom.pauseHostLabel) {
    return;
  }

  dom.pauseHostLabel.textContent = `Host: ${getPlayerDisplayName(context, session.hostId)}`;
}

export function refreshHostRole(context, forcedHostId) {
  const { callbacks, dom, selfId, session } = context;

  if (typeof forcedHostId === 'string') {
    session.hostId = forcedHostId;
  } else if (context.participantIds.size > 0) {
    session.hostId = [...context.participantIds].sort()[0] ?? selfId;
  }

  if (!callbacks.isPeerActive(selfId)) {
    dom.statusLabel.textContent = `Room full. Only ${MAX_PLAYERS} players can be active.`;
    updatePauseHostLabel(context);
  } else if (callbacks.isHost()) {
    dom.statusLabel.textContent = 'You are the authoritative host.';
    updatePauseHostLabel(context);
  } else {
    dom.statusLabel.textContent = `Authoritative host: ${shortId(session.hostId)}`;
    updatePauseHostLabel(context);
  }
}

export function isHost(context) {
  return context.session.hostId === context.selfId;
}

export function getActiveParticipantIds(context) {
  return [...context.participantIds].slice(0, MAX_PLAYERS);
}

export function isPeerActive(context, peerId) {
  return getActiveParticipantIds(context).includes(peerId);
}

export function getSpawnPoint(context, peerId) {
  const spawnIndex = Math.max(0, getActiveParticipantIds(context).indexOf(peerId));
  const spawnCell = getMapSpawn(getActiveMap(), spawnIndex);
  return mapCellToWorld(spawnCell.x, spawnCell.y);
}

export function syncActiveRoster(context) {
  const { callbacks, localPlayer, remotePlayers, selfId, viewPosition, world } = context;

  for (const [peerId, player] of remotePlayers.entries()) {
    if (!callbacks.isPeerActive(peerId)) {
      world.remove(player.group);
      remotePlayers.delete(peerId);
    }
  }

  if (!callbacks.isPeerActive(selfId) && localPlayer.group.parentNode) {
    world.remove(localPlayer.group);
  } else if (callbacks.isPeerActive(selfId) && !localPlayer.group.parentNode) {
    const spawnPoint = callbacks.getSpawnPoint(selfId);
    localPlayer.position.set(spawnPoint.x, spawnPoint.y);
    localPlayer.previousPosition.copy(localPlayer.position);
    localPlayer.targetPosition.copy(localPlayer.position);
    viewPosition.copy(localPlayer.position);
    world.setViewPosition(viewPosition.x, viewPosition.y);
    world.add(localPlayer.group);
  }
}
