import { resetPlayerAbilities } from '../game/abilities';
import { getActiveMapSlot, getMapSlot } from '../game/map-data';
import { setLastUnpausedTime } from '../game/pause.js';
import { resetHeldAbilities } from '../game/powerups/effects';
import { updateMatchTimerDisplay as renderMatchTimerDisplay } from './runtime-hud.js';

function resetPlayerForMatch(context, player, playerId) {
  const { callbacks, constants, playerLives, viewPosition, world } = context;

  if (playerLives[playerId]) {
    playerLives[playerId].reset(constants.INITIAL_LIFE);
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
  player.pendingBombDrop = null;

  const spawn = callbacks.getSpawnPoint(playerId);
  player.position.set(spawn.x, spawn.y);
  player.previousPosition.copy(player.position);
  player.targetPosition.copy(player.position);

  if (playerId === context.selfId) {
    viewPosition.copy(player.position);
    world.setViewPosition(viewPosition.x, viewPosition.y);
  }

  if (!player.group.parentNode) {
    world.add(player.group);
  }
}

export function resetMatch(context) {
  const { callbacks, gameState, localPlayer, remotePlayers, runtimePowerups, selfId, session, timers } = context;

  if (callbacks.isHost()) {
    runtimePowerups.hostResetPowerups();
  }

  if (!callbacks.isHost()) {
    return;
  }

  gameState.phase = 'playing';
  if (session.lobby) {
    session.lobby.state.phase = 'playing';
  }

  const savedMap = getMapSlot(getActiveMapSlot());
  callbacks.applyAuthoritativeMap(savedMap);
  callbacks.sendMapPacket();

  timers.matchTime = 0;
  gameState.endgameResults = null;
  setLastUnpausedTime(performance.now());

  resetPlayerForMatch(context, localPlayer, selfId);
  for (const [peerId, player] of remotePlayers.entries()) {
    resetPlayerForMatch(context, player, peerId);
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
}

export function updateMatchTimerDisplay(context) {
  renderMatchTimerDisplay(context.dom.matchTimerDisplay, context.dom.globalMatchTimer, context.timers.matchTime);
}
