import { resetPlayerAbilities } from '../game/abilities';
import { getActiveMapSlot, getMapSlot } from '../game/map-data';
import { setLastUnpausedTime, startCountdown } from '../game/pause.js';
import { syncPlayerTransform } from '../game/players';
import { resetHeldAbilities } from '../game/powerups/effects';
import { updateMatchTimerDisplay as renderMatchTimerDisplay } from './runtime-hud.js';

function placePlayerForMatchStart(context, player, playerId) {
  const { callbacks, constants, playerLives, viewPosition, world } = context;

  if (playerLives[playerId]) {
    playerLives[playerId].reset(constants.INITIAL_LIFE);
  }

  if (player.totalScore === undefined) {
    player.totalScore = 0;
  }
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
  player.stone = { activeUntil: 0 };
  player.pendingBombDrop = null;
  player.hasSnapshot = callbacks.isHost();

  const spawn = callbacks.getSpawnPoint(playerId);
  player.position.set(spawn.x, spawn.y);
  player.previousPosition.copy(player.position);
  player.targetPosition.copy(player.position);
  player.targetVelocity.set(0, 0);
  player.targetHeading = player.heading;
  syncPlayerTransform(player);

  if (playerId === context.selfId) {
    viewPosition.copy(player.position);
    world.setViewPosition(viewPosition.x, viewPosition.y);
  }
}

function attachPlayerModel(context, player) {
  const { world } = context;
  if (!player.group.parentNode) {
    world.add(player.group);
  }
}

function resetPlayerForMatch(context, player, playerId) {
  placePlayerForMatchStart(context, player, playerId);
  attachPlayerModel(context, player);
}

function resetClientLocalPlayerForMatch(context) {
  const { localPlayer, selfId } = context;
  placePlayerForMatchStart(context, localPlayer, selfId);

  localPlayer.pendingBombDrop = null;
  localPlayer.hasSnapshot = false;
  context.awaitingRoundStartSnapshot = true;
  context.pendingSelfSnapshotAtRoundStart = null;
  attachPlayerModel(context, localPlayer);
}

function beginMatchCountdown(context, countdownStartAtMs) {
  const { callbacks, gameState, localPlayer, remotePlayers, runtimePowerups, selfId, session, timers } = context;

  gameState.phase = 'playing';
  if (session.lobby) {
    session.lobby.state.phase = 'playing';
  }

  timers.matchTime = 0;
  gameState.endgameResults = null;
  context.endgameNotificationShown = false;

  if (callbacks.isHost()) {
    if (session.lobby?.assignSpawnOrder) {
      session.lobby.assignSpawnOrder();
    }

    context.awaitingRoundStartSnapshot = false;
    context.pendingSelfSnapshotAtRoundStart = null;
    runtimePowerups.hostResetPowerups();
    const savedMap = getMapSlot(getActiveMapSlot());
    callbacks.applyAuthoritativeMap(savedMap);
    callbacks.sendMapPacket();

    for (const id of callbacks.getActiveParticipantIds()) {
      if (id !== selfId) {
        context.ensureRemotePlayerWithLife(id, callbacks.getSpawnPoint(id));
      }
    }

    resetPlayerForMatch(context, localPlayer, selfId);
    for (const [peerId, player] of remotePlayers.entries()) {
      if (callbacks.isPeerActive(peerId)) {
        resetPlayerForMatch(context, player, peerId);
      }
    }

    callbacks.updateHpBar();
    context.updateScoreDisplay();
    callbacks.updateMatchTimerDisplay();

    if (session.lobby) {
      for (const id of callbacks.getActiveParticipantIds()) {
        const player = session.lobby.state.players.get(id);
        session.lobby.state.players.set(id, {
          name: player?.name ?? '',
          ready: false,
        });
      }
    }

    callbacks.sendSnapshotPacket();
  } else {
    for (const id of callbacks.getActiveParticipantIds()) {
      if (id === selfId) {
        continue;
      }

      const peerPlayer = context.ensureRemotePlayerWithLife(id, callbacks.getSpawnPoint(id));
      placePlayerForMatchStart(context, peerPlayer, id);
      attachPlayerModel(context, peerPlayer);
    }

    resetClientLocalPlayerForMatch(context);
    context.updateScoreDisplay();
    callbacks.updateMatchTimerDisplay();
  }

  startCountdown(() => {
    setLastUnpausedTime(performance.now());
  }, countdownStartAtMs);
}

export function resetMatch(context, countdownStartAtMs = Date.now()) {
  beginMatchCountdown(context, countdownStartAtMs);
}


export function updateMatchTimerDisplay(context) {
  renderMatchTimerDisplay(context.dom.matchTimerDisplay, context.dom.globalMatchTimer, context.timers.matchTime);
}
