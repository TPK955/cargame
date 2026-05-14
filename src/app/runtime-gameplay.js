import {
  ABILITY_DEFINITIONS,
  ABILITY_IDS,
  applyPlayerAbilitiesSnapshot,
  updatePlayerAbilityInput,
} from '../game/abilities';
import { syncCooldownIndicator } from '../game/cooldowns';
import {
  LOCAL_RECONCILE_RATE,
  REMOTE_INTERPOLATION_RATE,
  REMOTE_TIMEOUT_MS,
  SIMULATION_STEP,
  SNAPSHOT_POSITION_SNAP_DISTANCE,
  SNAPSHOT_SEND_INTERVAL_MS,
  SNAPSHOT_VELOCITY_SNAP_DELTA,
} from '../game/config';
import { readCurrentInputState } from '../game/input';
import { LifeSystem, isOnFloorOrWall } from '../game/life.js';
import { MAP_CELL_SIZE, MAP_WORLD_SIZE, getActiveMap, setSessionMap } from '../game/map-data';
import { syncPlayerTransform } from '../game/players';
import {
  playBombDropSound,
  playCollectSound,
  playCollisionSound,
  playDamageSound,
  playDespawnSound,
  playSpeedBoostSound,
  startGhostSound,
  startShieldSound,
  stopGhostSound,
  stopShieldSound,
  updateEngineSound,
} from '../game/audio/sound-manager';
import { applyHeldAbilitiesSnapshot, applyPowerupEffect } from '../game/powerups/effects';
import { Vec2 } from '../game/math';
import {
  resolveArenaCollision,
  resolveMapWallCollisions,
  resolvePlayerCollision,
  simulateMovement,
} from '../game/physics';
import { lerpAngle, shortId } from '../game/utils';
import { buildEndgameResults, shouldEndMatch } from '../game/win/win-logic';
import { renderUI } from '../ui/state-renderer.js';
import { updateHeldAbilitySlots as renderHeldAbilitySlots } from './runtime-ability-ui.js';
import { updateHpBar as updateHpBarDisplay } from './runtime-hud.js';
import { applyLifeSnapshotForPlayer, getHealthPercent as getPlayerHealthPercent } from './runtime-life.js';
import { getPaused, getLastUnpausedTime, setLastUnpausedTime } from '../game/pause.js';

export function handleResize(context) {
  context.world.setSize(window.innerWidth, window.innerHeight);
}

export function updateHpBar(context) {
  updateHpBarDisplay(context.dom.hpBarFill, context.playerLives[context.selfId], context.constants.INITIAL_LIFE);
}

export function updateUIVisibility(context) {
  const isLobby = context.gameState.phase === 'lobby';
  const nameInputGroup = document.querySelector('.name-input-group');

  if (nameInputGroup) {
    nameInputGroup.style.display = isLobby ? 'block' : 'none';
  }

  if (!isLobby && context.dom.readyButton) {
    context.dom.readyButton.style.display = 'none';
  }
}

export function loop(context) {
  try {
    const handleNewMatch = () => {
      if (context.callbacks.isHost()) {
        context.callbacks.resetMatch();
        context.callbacks.sendSnapshotPacket();
      }
    };

    renderUI(context.gameState, {
      lobby: context.session.lobby,
      playHud: context.dom.playHud,
      selfId: context.selfId,
      shortId,
      getActiveParticipantIds: context.callbacks.getActiveParticipantIds,
      getHealthPercent: context.callbacks.getHealthPercent,
      lobbyUI: context.lobbyUI,
      hostId: context.session.hostId,
      handleNewMatch,
    });

    if (context.gameState.phase !== 'playing') {
      context.updateScoreDisplay();
      context.world.render();
      requestAnimationFrame(context.callbacks.loop);
      return;
    }

    context.updateScoreDisplay();
    context.callbacks.updateMatchTimerDisplay();
    const delta = Math.min(context.clock.getDelta(), 0.05);

    if (!getPaused()) {
      if (context.callbacks.isHost()) {
        context.timers.matchTime += (performance.now() - getLastUnpausedTime()) / 1000;
      }
      setLastUnpausedTime(performance.now());

      if (context.callbacks.isHost()) {
        context.localPlayer.input = readCurrentInputState(context.keys);
        context.timers.simulationAccumulator += delta;

        while (context.timers.simulationAccumulator >= SIMULATION_STEP) {
          simulateAuthoritativeStep(context, SIMULATION_STEP);
          context.timers.simulationAccumulator -= SIMULATION_STEP;
        }

        context.timers.snapshotAccumulator += delta * 1000;
        if (context.timers.snapshotAccumulator >= SNAPSHOT_SEND_INTERVAL_MS) {
          context.timers.snapshotAccumulator = 0;
          context.callbacks.sendSnapshotPacket();
        }

        syncPlayerTransform(context.localPlayer);
        for (const remote of context.remotePlayers.values()) {
          syncPlayerTransform(remote);
        }
      } else {
        context.timers.inputAccumulator += delta * 1000;
        updatePredictedLocalPlayer(context, delta);
        updateRemotePlayers(context, delta);
        context.callbacks.sendInputPacket();
      }

      if (context.callbacks.isHost()) {
        context.timers.lifeTickAccumulator += delta;
        if (context.timers.lifeTickAccumulator >= context.constants.LIFE_TICK_INTERVAL) {
          context.timers.lifeTickAccumulator = 0;
          applyLifeTick(context);
          maybeFinishMatch(context);
        }
      }
    } else {
      setLastUnpausedTime(performance.now());
    }

    updateHpBar(context);
    syncCooldownIndicator(
      context.dom.abilityCooldownIndicator,
      context.dom.abilityCooldownIcon,
      ABILITY_DEFINITIONS[ABILITY_IDS.SPEED_BOOST],
      context.localPlayer.abilities?.[ABILITY_IDS.SPEED_BOOST],
      performance.now() / 1000
    );
    renderHeldAbilitySlots(context.localPlayer, context.dom.heldAbilityUiElements);

    const nowSeconds = performance.now() / 1000;
    const shieldActive = (context.localPlayer.shield?.activeUntil || 0) > nowSeconds;
    const ghostActive = (context.localPlayer.ghost?.activeUntil || 0) > nowSeconds;

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

    if (context.runtimeEditor.isEditMode() || !context.playerLives[context.selfId]?.isAlive()) {
      updateEditorView(context, delta);
    } else {
      updateWorldView(context, delta);
    }

    context.runtimePowerups.renderPowerups();
    context.runtimePowerups.renderBombs();
    context.runtimePowerups.tryPickupPowerup();
    context.world.render();

    const ramp = context.localPlayer.speedRamp || 0;
    const boostActive = context.localPlayer.abilities?.speedBoost?.activeUntil > (performance.now() / 1000);

    if (context.playerLives[context.selfId]?.isAlive()) {
      updateEngineSound(ramp, boostActive ? 1 : 0);
    } else {
      context.localPlayer.speedRamp = 0;
      updateEngineSound(0, 0);
    }

    requestAnimationFrame(context.callbacks.loop);
  } catch (error) {
    console.error('LOOP ERROR:', error);
  }
}

function applyLifeTick(context) {
  const map = getActiveMap();
  const collisionMap = { ...map, MAP_WORLD_SIZE, MAP_CELL_SIZE };
  const { constants, localPlayer, playerLives, remotePlayers, selfId, world } = context;

  if (playerLives[selfId].isAlive() && !isOnFloorOrWall(localPlayer, collisionMap)) {
    playerLives[selfId].loseLife(constants.LIFE_TICK_DAMAGE);
    playDamageSound();
    if (!playerLives[selfId].isAlive()) {
      playDespawnSound();
      if (localPlayer.group.parentNode) {
        world.remove(localPlayer.group);
      }
      for (const [peerId, remoteLife] of Object.entries(playerLives)) {
        if (peerId !== selfId && remoteLife.isAlive() && remotePlayers.has(peerId) && remotePlayers.get(peerId).score !== undefined) {
          remotePlayers.get(peerId).score += 1;
        }
      }
    }
  }

  for (const [peerId, player] of remotePlayers.entries()) {
    if (playerLives[peerId].isAlive() && !isOnFloorOrWall(player, collisionMap)) {
      playerLives[peerId].loseLife(constants.LIFE_TICK_DAMAGE);
      playDamageSound();
      if (!playerLives[peerId].isAlive()) {
        playDespawnSound();
        if (player.group.parentNode) {
          world.remove(player.group);
        }
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
}

export function maybeFinishMatch(context) {
  if (!context.callbacks.isHost() || context.gameState.phase !== 'playing') {
    return;
  }

  const activeParticipantIds = context.callbacks.getActiveParticipantIds();
  if (!shouldEndMatch(context.playerLives, activeParticipantIds)) {
    return;
  }

  context.gameState.endgameResults = buildEndgameResults({
    playerLives: context.playerLives,
    participantIds: activeParticipantIds,
    getPlayerById: (id) => {
      if (id === context.selfId) {
        return context.localPlayer;
      }
      return context.remotePlayers.get(id) ?? null;
    },
    getDisplayName: (id) => context.session.lobby?.state?.players?.get(id)?.name?.trim() || shortId(id),
  });

  context.gameState.phase = 'endgame';
  if (context.session.lobby) {
    context.session.lobby.state.phase = 'endgame';
  }

  context.callbacks.sendSnapshotPacket();
}

export function updateLocalPlayerAbilityInput(context, player, input, now) {
  const speedBoostHeld = Boolean(input?.speedBoost);
  const boostJustPressed = speedBoostHeld && !player.abilityInputState?.speedBoostHeld;
  updatePlayerAbilityInput(player, input, now);
  if (boostJustPressed) {
    playSpeedBoostSound();
  }
}

export function updatePredictedLocalPlayer(context, delta) {
  const input = readCurrentInputState(context.keys);
  const now = performance.now() / 1000;
  updateLocalPlayerAbilityInput(context, context.localPlayer, input, now);
  simulateMovement(context.localPlayer, input, delta, now);
  resolveArenaCollision(context.localPlayer);
  resolveMapWallCollisions(context.localPlayer);
  reconcileLocalPlayer(context, delta);
  syncPlayerTransform(context.localPlayer);
}

export function updateRemotePlayers(context, delta) {
  const now = performance.now();

  for (const [peerId, player] of context.remotePlayers.entries()) {
    if (now - player.lastSeenAt > REMOTE_TIMEOUT_MS) {
      context.world.remove(player.group);
      context.remotePlayers.delete(peerId);
      context.callbacks.updatePeerCount();
      continue;
    }

    player.position.lerp(player.targetPosition, Math.min(1, delta * REMOTE_INTERPOLATION_RATE));
    player.velocity.lerp(player.targetVelocity, Math.min(1, delta * 6));
    player.heading = lerpAngle(player.heading, player.targetHeading, Math.min(1, delta * 10));
    syncPlayerTransform(player);
  }
}

export function applyAuthoritativeMap(context, nextMap) {
  const appliedMap = setSessionMap(nextMap);
  context.world.setMap(appliedMap);
  context.callbacks.syncActiveRoster();

  if (!context.callbacks.isHost()) {
    const localSpawn = context.callbacks.getSpawnPoint(context.selfId);
    context.localPlayer.position.set(localSpawn.x, localSpawn.y);
    context.localPlayer.previousPosition.copy(context.localPlayer.position);
    context.localPlayer.targetPosition.copy(context.localPlayer.position);
    context.viewPosition.copy(context.localPlayer.position);
    context.world.setViewPosition(context.viewPosition.x, context.viewPosition.y);
  }
}

export function reconcileLocalPlayer(context, delta) {
  if (!context.localPlayer.hasSnapshot) {
    return;
  }

  context.localPlayer.position.lerp(context.localPlayer.targetPosition, Math.min(1, delta * LOCAL_RECONCILE_RATE));
  context.localPlayer.velocity.lerp(context.localPlayer.targetVelocity, Math.min(1, delta * 6));
  context.localPlayer.heading = lerpAngle(
    context.localPlayer.heading,
    context.localPlayer.targetHeading,
    Math.min(1, delta * LOCAL_RECONCILE_RATE)
  );
}

export function updateWorldView(context, delta) {
  context.viewPosition.lerp(context.localPlayer.position, Math.min(1, delta * 5.5));
  context.world.setViewPosition(context.viewPosition.x, context.viewPosition.y);
}

export function updateEditorView(context, delta) {
  const viewStep = context.constants.EDIT_CAMERA_SPEED * delta;

  if (context.keys.forward) {
    context.viewPosition.y -= viewStep;
  }

  if (context.keys.backward) {
    context.viewPosition.y += viewStep;
  }

  if (context.keys.left) {
    context.viewPosition.x -= viewStep;
  }

  if (context.keys.right) {
    context.viewPosition.x += viewStep;
  }

  context.world.setViewPosition(context.viewPosition.x, context.viewPosition.y);
}

export function getAllPlayers(context) {
  const players = [];
  if (context.callbacks.isPeerActive(context.selfId)) {
    players.push(context.localPlayer);
  }

  return [...players, ...context.remotePlayers.values()];
}

export function simulateAuthoritativeStep(context, delta) {
  const players = getAllPlayers(context).filter((player) => {
    if (player.id === context.selfId) {
      return context.playerLives[context.selfId]?.isAlive();
    }
    return context.playerLives[player.id]?.isAlive();
  });

  for (const player of players) {
    const input = player.isLocal
      ? readCurrentInputState(context.keys)
      : (player.input ?? {
          forward: false,
          backward: false,
          left: false,
          right: false,
          strafeLeft: false,
          strafeRight: false,
        });
    const now = performance.now() / 1000;
    if (player.isLocal) {
      updateLocalPlayerAbilityInput(context, player, input, now);
    } else {
      updatePlayerAbilityInput(player, input, now);
    }
    simulateMovement(player, input, delta, now);

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

  for (let index = 0; index < players.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < players.length; otherIndex += 1) {
      const prevPos1X = players[index].position.x;
      const prevPos1Y = players[index].position.y;
      const prevPos2X = players[otherIndex].position.x;
      const prevPos2Y = players[otherIndex].position.y;

      resolvePlayerCollision(players[index], players[otherIndex]);

      const didCollide1 = prevPos1X !== players[index].position.x || prevPos1Y !== players[index].position.y;
      const didCollide2 = prevPos2X !== players[otherIndex].position.x || prevPos2Y !== players[otherIndex].position.y;
      if ((didCollide1 || didCollide2) && (!players[index].collided || !players[otherIndex].collided)) {
        playCollisionSound();
        players[index].collided = true;
        players[otherIndex].collided = true;
      }
    }
  }

  context.runtimePowerups.simulateAuthoritativeStep(delta, players);
}

export function applySnapshot(context, playerStates) {
  const now = performance.now();

  let playerList = playerStates;
  let powerupList;
  let bombList;

  if (!Array.isArray(playerStates) && playerStates && typeof playerStates === 'object') {
    playerList = playerStates.players;
    powerupList = playerStates.powerups;
    bombList = playerStates.bombs;
  }

  context.runtimePowerups.applySnapshotPowerups(powerupList, bombList);

  for (const playerState of playerList) {
    if (playerState.id === context.selfId) {
      if (!context.callbacks.isHost()) {
        context.localPlayer.targetPosition.set(playerState.x, playerState.z);
        context.localPlayer.targetVelocity.set(playerState.vx, playerState.vz);
        context.localPlayer.targetHeading = playerState.heading;
        context.localPlayer.score = Number(playerState.score ?? context.localPlayer.score ?? 0);
        applyPlayerAbilitiesSnapshot(context.localPlayer, playerState.abilities);
        applyHeldAbilitiesSnapshot(context.localPlayer, playerState.heldAbilities);

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
          if (!context.localPlayer.shield) {
            context.localPlayer.shield = { activeUntil: 0 };
          }
          context.localPlayer.shield.activeUntil = playerState.shield.activeUntil;
        }

        if (playerState.ghost) {
          if (!context.localPlayer.ghost) {
            context.localPlayer.ghost = { activeUntil: 0 };
          }
          context.localPlayer.ghost.activeUntil = playerState.ghost.remainingSeconds > 0
            ? performance.now() / 1000 + playerState.ghost.remainingSeconds
            : 0;
        }

        applyLifeSnapshotForPlayer(context.playerLives, context.constants.INITIAL_LIFE, playerState.id, playerState);
        context.localPlayer.pendingBombDrop = null;
        context.localPlayer.hasSnapshot = true;
        context.localPlayer.lastSeenAt = now;

        if (context.playerLives[context.selfId]?.isAlive?.() && !context.localPlayer.group.parentNode) {
          context.world.add(context.localPlayer.group);
        } else if (!context.playerLives[context.selfId]?.isAlive?.() && context.localPlayer.group.parentNode) {
          context.world.remove(context.localPlayer.group);
        }
      }

      continue;
    }

    const player = context.ensureRemotePlayerWithLife(playerState.id, { x: playerState.x, y: playerState.z });

    if (!player.hasSpawned) {
      player.position.set(playerState.x, playerState.z);
      player.targetPosition.copy(player.position);
      player.hasSpawned = true;
    }

    const positionError = player.position.distanceTo(new Vec2(playerState.x, playerState.z));
    const velocityError = player.velocity.distanceTo(new Vec2(playerState.vx, playerState.vz));
    const shouldSnapToSnapshot = positionError >= SNAPSHOT_POSITION_SNAP_DISTANCE
      || velocityError >= SNAPSHOT_VELOCITY_SNAP_DELTA;

    player.targetPosition.set(playerState.x, playerState.z);
    player.targetVelocity.set(playerState.vx, playerState.vz);
    player.targetHeading = playerState.heading;
    player.score = Number(playerState.score ?? player.score ?? 0);
    applyPlayerAbilitiesSnapshot(player, playerState.abilities);
    applyHeldAbilitiesSnapshot(player, playerState.heldAbilities);

    if (playerState.shield) {
      if (!player.shield) {
        player.shield = { activeUntil: 0 };
      }
      player.shield.activeUntil = playerState.shield.activeUntil;
    }

    if (playerState.ghost) {
      if (!player.ghost) {
        player.ghost = { activeUntil: 0 };
      }
      player.ghost.activeUntil = playerState.ghost.remainingSeconds > 0
        ? performance.now() / 1000 + playerState.ghost.remainingSeconds
        : 0;
    }

    applyLifeSnapshotForPlayer(context.playerLives, context.constants.INITIAL_LIFE, playerState.id, playerState);
    player.pendingBombDrop = null;
    player.lastSeenAt = now;

    if (shouldSnapToSnapshot) {
      player.position.copy(player.targetPosition);
      player.velocity.copy(player.targetVelocity);
      player.heading = player.targetHeading;
    }

    if (context.callbacks.isHost()) {
      player.position.set(playerState.x, playerState.z);
      player.velocity.set(playerState.vx, playerState.vz);
      player.heading = playerState.heading;
    }

    if (context.playerLives[playerState.id]?.isAlive?.() && !player.group.parentNode) {
      context.world.add(player.group);
    } else if (!context.playerLives[playerState.id]?.isAlive?.() && player.group.parentNode) {
      context.world.remove(player.group);
    }
  }
}

export function applyPickupEffect(context, type, player) {
  applyPowerupEffect(type, player);
  player.collected = true;

  if (player.isLocal) {
    playCollectSound();
  }
}

export function getHealthPercent(context, peerId) {
  return getPlayerHealthPercent(context.playerLives, peerId, context.constants.INITIAL_LIFE);
}
