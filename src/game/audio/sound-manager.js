// =========================
// Sound Manager (basic)
// =========================

import { speedBoost } from "../powerups/effects";

let ctx = null;

// Engine sound
let engineSource = null;
let engineGain = null;
let smoothedThrottle = 0;
let smoothedBoost = 0;
let idleStartTime = null;
let engineStopped = false;

// Effects
let collectBuffer = null;
let collisionBuffer = null;
let lastCollisionSoundTime = 0;
let damageBuffer = null;
let despawnBuffer = null;
let speedBoostBuffer = null;
let shieldBuffer = null;
let ghostBuffer = null;
let fanfareBuffer = null;
let countdownBuffer = null;
let startMatchBuffer = null;

let ghostSource = null;
let ghostGain = null;
let ghostPlaying = false;

let bombDropBuffer = null;
let explosionBuffer = null;

let shieldSource = null;
let shieldGain = null;
let shieldPlaying = false;

// State
let initialized = false;

// =========================
// Init (must be called from user interaction)
// =========================
export async function initAudio() {
  if (initialized) return;

  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Load samples
  const engineBuffer = await loadSound("/sounds/engine_loop.wav");
  collectBuffer = await loadSound("/sounds/collect.wav");
  collisionBuffer = await loadSound("/sounds/collision.wav");
  damageBuffer = await loadSound("/sounds/damage.wav");
  despawnBuffer = await loadSound("/sounds/despawn.wav");
  speedBoostBuffer = await loadSound("/sounds/speed_boost.wav");
  shieldBuffer = await loadSound("/sounds/shield.wav");
  explosionBuffer = await loadSound("/sounds/explosion.wav");
  ghostBuffer = await loadSound("/sounds/ghost.wav");
  bombDropBuffer = await loadSound("/sounds/bomb_drop.wav");
  fanfareBuffer = await loadSound("/sounds/fanfare.wav");
  countdownBuffer = await loadSound("/sounds/countdown_signal.wav");
  startMatchBuffer = await loadSound("/sounds/countdown_final.wav");
  engineSource = ctx.createBufferSource();
  engineSource.buffer = engineBuffer;
  engineSource.loop = true;

  engineGain = ctx.createGain();
  engineGain.gain.value = 0;

  engineSource.connect(engineGain).connect(ctx.destination);
  engineSource.start(0);

  initialized = true;

  console.log("[Audio] Initialized");
}

// =========================
// Load helper
// =========================
async function loadSound(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

// =========================
// Update engine sound
// =========================
export function updateEngineSound(t, boost = 0) {
  if (!initialized || !engineSource || !engineGain) {
    return;
  }

  if (ghostPlaying) {
    // Mute engine when ghosting
    engineGain.gain.value += (0.1 - engineGain.gain.value) * 0.1;
    return;
  }

  const isIdle = t <= 0.01;

  // Smooth throttle
  smoothedThrottle += (t - smoothedThrottle) * 0.08;

  // Smooth boost decay
  smoothedBoost += (boost - smoothedBoost) * 0.04;

  const boostPitch = smoothedBoost * 0.8;

  // Idle timer
  if (isIdle) {
    if (idleStartTime === null) {
      idleStartTime = performance.now();
    }

    // After 2s idle -> fade engine out
    if (performance.now() - idleStartTime > 2000) {
      engineStopped = true;
    }
  } else {
    idleStartTime = null;

    // Engine wakes instantly when throttle pressed
    if (engineStopped) {
      engineStopped = false;
    }
  }

  // Pitch always updates
  engineSource.playbackRate.value = 0.6 + smoothedThrottle * 1.1 + boostPitch;

  // Target volume
  let targetGain;

  if (engineStopped) {
    targetGain = 0;
  } else {
    targetGain = 0.25 + smoothedThrottle * 0.75 + smoothedBoost * 0.15;
  }

  // Smooth gain transition
  engineGain.gain.value += (targetGain - engineGain.gain.value) * 0.05;
}

// =========================
// Play SFX
// =========================
export function playCollectSound() {
  if (!initialized || !collectBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = collectBuffer;

  src.playbackRate.value = 0.95 + Math.random() * 0.3;

  src.connect(ctx.destination);
  src.start(0);
}

export function playCollisionSound(strength = 1) {
  if (!initialized || !collisionBuffer) return;

  const now = performance.now();

  // Prevent audio spam
  if (now - lastCollisionSoundTime < 80) {
    return;
  }

  lastCollisionSoundTime = now;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = collisionBuffer;

  // Randomize pitch slightly
  src.playbackRate.value = 0.9 + Math.random() * 0.25;

  // Volume scales with impact
  const gain = ctx.createGain();

  gain.gain.value = Math.min(1, 0.2 + strength * 0.8);

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function playDamageSound(healthPercent) {
  if (!initialized || !damageBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = damageBuffer;

  const gain = ctx.createGain();

  // Lower health = slower / heavier sound
  if (healthPercent <= 25) {
    src.playbackRate.value = 0.60;
    gain.gain.value = 0.9;
  } else if (healthPercent <= 50) {
    src.playbackRate.value = 0.74;
    gain.gain.value = 0.8;
  } else if (healthPercent <= 75) {
    src.playbackRate.value = 0.87;
    gain.gain.value = 0.7;
  } else {
    src.playbackRate.value = 1;
  }

  src.connect(gain).connect(ctx.destination);
  src.start(0);
}

export function playDespawnSound() {
  if (!initialized || !despawnBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = despawnBuffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.6;

  src.connect(gain).connect(ctx.destination);
  src.start(ctx.currentTime + 0.5);
}

export function playSpeedBoostSound() {
  if (!initialized || !speedBoostBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = speedBoostBuffer;

  // Small variation to avoid repetition
  src.playbackRate.value = 0.96 + Math.random() * 0.08;

  const gain = ctx.createGain();
  gain.gain.value = 0.8;

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function startShieldSound() {
  if (!initialized || !shieldBuffer) return;
  if (shieldPlaying) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  shieldSource = ctx.createBufferSource();
  shieldSource.buffer = shieldBuffer;
  shieldSource.loop = true;

  shieldGain = ctx.createGain();
  shieldGain.gain.value = 0;

  shieldSource.connect(shieldGain).connect(ctx.destination);

  shieldSource.start(0);

  // Smooth fade in
  shieldGain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.2);

  shieldPlaying = true;
}

export function stopShieldSound() {
  if (!shieldPlaying || !shieldSource || !shieldGain) {
    return;
  }

  // Smooth fade out
  shieldGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);

  const sourceToStop = shieldSource;

  setTimeout(() => {
    try {
      sourceToStop.stop();
    } catch {}
  }, 300);

  shieldSource = null;
  shieldGain = null;

  shieldPlaying = false;
}

export function playBombDropSound() {
  if (!initialized || !bombDropBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = bombDropBuffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.7;

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function playExplosionSound() {
  if (!initialized || !explosionBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = explosionBuffer;

  src.playbackRate.value = 0.95 + Math.random() * 0.3;

  src.connect(ctx.destination);
  src.start(0);
}

export function startGhostSound() {
  if (!initialized || !ghostBuffer) return;
  if (ghostPlaying) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  ghostSource = ctx.createBufferSource();
  ghostSource.buffer = ghostBuffer;
  ghostSource.loop = true;

  ghostGain = ctx.createGain();
  ghostGain.gain.value = 0;

  ghostSource.connect(ghostGain).connect(ctx.destination);

  ghostSource.start(0);

  // Smooth fade in
  ghostGain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.2);

  ghostPlaying = true;
}

export function stopGhostSound() {
  if (!ghostPlaying || !ghostSource || !ghostGain) {
    return;
  }

  // Smooth fade out
  ghostGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);

  const sourceToStop = ghostSource;

  setTimeout(() => {
    try {
      sourceToStop.stop();
    } catch {}
  }, 300);

  ghostSource = null;
  ghostGain = null;

  ghostPlaying = false;
}

export function playFanfareSound() {
  if (!initialized || !fanfareBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = fanfareBuffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.8;

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function playCountdownSound() {
  if (!initialized || !countdownBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = countdownBuffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.5;

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function playStartMatchSound() {
  if (!initialized || !startMatchBuffer) return;

  if (ctx.state === "suspended") {
    ctx.resume();
  }

  const src = ctx.createBufferSource();
  src.buffer = startMatchBuffer;

  const gain = ctx.createGain();
  gain.gain.value = 0.5;

  src.connect(gain).connect(ctx.destination);

  src.start(0);
}

export function stopAllVehicleSounds() {
  // Stop all vehicle-related continuous sounds when player despawns
  updateEngineSound(0, 0);
  stopShieldSound();
  stopGhostSound();
}
