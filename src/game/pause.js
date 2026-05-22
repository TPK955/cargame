import { playCountdownSound, playStartMatchSound } from './audio/sound-manager.js';

// Countdown state
let countdownActive = false;
let countdownTimeout = null;

/**
 * Shows a 3-second countdown overlay and blocks gameplay until done.
 * Calls the provided callback when countdown completes.
 */
export function startCountdown(callback) {
  if (countdownActive) return;
  countdownActive = true;
  let seconds = 3;
  if (gameplayNotification) {
    gameplayNotification.style.opacity = '1';
    gameplayNotification.textContent = `Starting in ${seconds}`;
    playCountdownSound();
  }
  function tick() {
    seconds--;
    if (seconds > 0) {
      if (gameplayNotification) gameplayNotification.textContent = `Starting in ${seconds}`;
      playCountdownSound();
      countdownTimeout = setTimeout(tick, 1000);
      
    } else {
      if (gameplayNotification) gameplayNotification.style.opacity = '0';
      countdownActive = false;
      playStartMatchSound();
      if (typeof callback === 'function') callback();
    }
  }
  countdownTimeout = setTimeout(tick, 1000);
}

export function isCountdownActive() {
  return countdownActive;
}

// Import lobbyRef to access player names
import { lobbyRef, setLobbyRef } from '../main.js';
import { gameState } from '../main.js';
// --- Multiplayer Pause Networking Setup ---
// Call this from main.js: setupPauseNetworking(room, localPlayer)
let isPaused = false;
let lastUnpausedTime = performance.now();
let pauseMenu = null;
let resumeBtn = null;
let quitBtn = null;
let pauseStatusLabel = null;
let pauseWhoLabel = null;
let gameplayNotification = null;
let gameplayNotificationTimeout = null;
let sendPause = null;
let selfName = '';
let matchStarted = false; // Track if match has actually begun


// Setup networking for pause actions. All peers (host or not) process all pause actions.
export function setupPauseNetworking(room, localPlayer) {
  if (!room || !localPlayer) {
    console.warn('[pause] setupPauseNetworking: missing room or localPlayer');
    return;
  }
  // Ensure lobbyRef is set
  if (!lobbyRef && window.lobby) {
    setLobbyRef(window.lobby);
  }
  const [sendPauseAction, receivePause] = room.makeAction('pause');
  sendPause = sendPauseAction;
  selfName = localPlayer.id;
  if (receivePause) {
    receivePause((payload) => {
      applyPauseNetworkEvent(payload);
    });
  }
}

export function initPauseMenu() {
  pauseMenu = document.getElementById('pause-menu');
  resumeBtn = document.getElementById('resume-btn');
  quitBtn = document.getElementById('quit-btn');
  pauseStatusLabel = document.getElementById('pause-status-label');
  pauseWhoLabel = document.getElementById('pause-who-label');
  gameplayNotification = document.getElementById('gameplay-notification');
  
  // Hide quit button initially (match hasn't started)
  if (quitBtn) {
    quitBtn.style.display = 'none';
  }
  if (gameplayNotification) {
    gameplayNotification.style.opacity = '0';
  }
  
  const newMatchBtn = document.getElementById('new-match-btn');
  if (newMatchBtn) {
    newMatchBtn.style.display = 'none';
  }
  
  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => triggerPauseAction(false, 'resume'));
  }
  if (quitBtn) {
    quitBtn.addEventListener('click', () => {
      // Quit button: broadcast quit and navigate immediately
      const playerObj = lobbyRef?.state?.players?.get(selfName);
      const displayName = playerObj?.name?.trim() || selfName;
      console.log('[pause] Quit clicked, broadcasting quit event...');
      if (sendPause && typeof sendPause === 'function') {
        sendPause({ type: 'quit', peerId: selfName, displayName });
      }
      applyPauseNetworkEvent({ type: 'quit', peerId: selfName, displayName });
      setTimeout(() => {
        window.location.href = window.location.origin;
      }, 100);
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') triggerPauseAction(!isPaused, isPaused ? 'resume' : 'pause');
  });
}

export function updatePauseMenuButtons(isPreMatch) {
  if (resumeBtn) {
    resumeBtn.textContent = isPreMatch ? 'Start' : 'Resume';
  }

 if (quitBtn) {
    quitBtn.style.display = isPreMatch ? 'none' : 'block';
  }

}

export function setMatchStarted(started) {
  matchStarted = started;
}

export function showGameplayNotification(message, duration = 3000) {
  if (!gameplayNotification) return;
  if (gameplayNotificationTimeout) {
    clearTimeout(gameplayNotificationTimeout);
    gameplayNotificationTimeout = null;
  }

  gameplayNotification.textContent = message;
  gameplayNotification.style.opacity = '1';

  gameplayNotificationTimeout = setTimeout(() => {
    if (gameplayNotification) {
      gameplayNotification.style.opacity = '0';
    }
    gameplayNotificationTimeout = null;
  }, duration);
}
function triggerPauseAction(paused, action = 'pause') {
  // Only allow pausing in 'playing' phase
  if (!gameState || (gameState.phase !== 'playing') && (!matchStarted)) {
    console.warn('[pause] Cannot pause: not in playing phase');
    if (pauseStatusLabel) pauseStatusLabel.textContent = 'Cannot pause: only allowed during gameplay.';
    return;
  }
  // Require name only in playing phase
  if (!lobbyRef || !lobbyRef.state || !lobbyRef.state.players || !lobbyRef.state.players.get) {
    console.warn('[pause] Cannot pause: lobby not ready');
    if (pauseStatusLabel) pauseStatusLabel.textContent = 'Cannot pause: lobby not ready.';
    return;
  }
  const playerObj = lobbyRef.state.players.get(selfName);
  if (!playerObj || typeof playerObj.name !== 'string' || playerObj.name.trim() === '') {
    console.warn('[pause] Cannot pause: player name not set');
    if (pauseStatusLabel) pauseStatusLabel.textContent = 'Cannot pause: set your name first.';
    return;
  }
  let displayName = playerObj.name.trim();
  console.log('[pause] Sending pause event:', { type: action, peerId: selfName, displayName });
  if (sendPause && typeof sendPause === 'function') {
    sendPause({ type: action, peerId: selfName, displayName });
  }
  applyPauseNetworkEvent({ type: action, peerId: selfName, displayName });
}

function applyPauseNetworkEvent({ type, peerId, displayName }) {
  // Prefer displayName from payload, otherwise look up from lobbyRef
  let nameToShow = displayName;
  let lobbyName = undefined;
  if (lobbyRef && lobbyRef.state && lobbyRef.state.players && lobbyRef.state.players.get) {
    const playerObj = lobbyRef.state.players.get(peerId);
    if (playerObj && playerObj.name && playerObj.name.trim() !== '') {
      lobbyName = playerObj.name;
    }
  }
  if ((!nameToShow || nameToShow.trim() === '') && lobbyName) {
    nameToShow = lobbyName;
  } else if (!nameToShow || nameToShow.trim() === '') {
    nameToShow = 'Player';
  }
  console.log('[pause] Received pause event:', { type, peerId, displayName, lobbyName, nameToShow });
  if (type === 'pause') {
    isPaused = true;
    if (pauseMenu) pauseMenu.style.display = 'flex';
    const isPreMatch = !matchStarted;
    updatePauseMenuButtons(isPreMatch);
    // Show player name only if match has started
    if (pauseWhoLabel) pauseWhoLabel.textContent = isPreMatch ? 'Match paused before start.' : `${nameToShow} paused the game.`;
  } else if (type === 'resume') {
    isPaused = false;
    if (pauseMenu) pauseMenu.style.display = 'none';
    lastUnpausedTime = performance.now();
    if (pauseWhoLabel) pauseWhoLabel.textContent = '';
    if (pauseStatusLabel) pauseStatusLabel.textContent = matchStarted ? `${nameToShow} resumed the game.` : '';
    if (!matchStarted) {
      matchStarted = true;
      updatePauseMenuButtons(false);
    }
    startCountdown();
  } else if (type === 'quit') {
    isPaused = false;
    if (pauseMenu) pauseMenu.style.display = 'none';
    lastUnpausedTime = performance.now();
    if (pauseWhoLabel) pauseWhoLabel.textContent = '';
    if (pauseStatusLabel) pauseStatusLabel.textContent = `${nameToShow} quit the game.`;
    // Show quit notification during gameplay
    if (gameplayNotification) {
      gameplayNotification.textContent = `${nameToShow} quit the game.`;
      gameplayNotification.style.opacity = '1';
      setTimeout(() => {
        if (gameplayNotification) gameplayNotification.style.opacity = '0';
      }, 7000);
    }
  }
}

export function setPaused(paused, action = 'pause') {
  triggerPauseAction(paused, action);
}

export function getPaused() {
  return isPaused;
}

export function getLastUnpausedTime() {
  return lastUnpausedTime;
}

export function setLastUnpausedTime(time) {
  lastUnpausedTime = time;
}
