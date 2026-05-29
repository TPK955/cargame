export function createInputState() {
  return {
    forward: false,
    backward: false,
    left: false,
    right: false,
    strafeLeft: false,
    strafeRight: false,
    ability1: false, // Q
    ability2: false, // E
    speedBoost: false, // Space
  };
}

export function setupInput(keys) {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      return;
    }

    setKey(keys, event.code, true);
  });

  window.addEventListener('keyup', (event) => {
    setKey(keys, event.code, false);
  });

  window.addEventListener('blur', () => {
    resetKeys(keys);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetKeys(keys);
    }
  });
}

export function readCurrentInputState(keys) {
  return {
    forward: keys.forward,
    backward: keys.backward,
    left: keys.left,
    right: keys.right,
    strafeLeft: Boolean(keys.strafeLeft),
    strafeRight: Boolean(keys.strafeRight),
    ability1: Boolean(keys.ability1),
    ability2: Boolean(keys.ability2),
    speedBoost: Boolean(keys.speedBoost),
  };
}

export function normalizeInput(payload) {
  return {
    forward: Boolean(payload?.forward),
    backward: Boolean(payload?.backward),
    left: Boolean(payload?.left),
    right: Boolean(payload?.right),
    strafeLeft: Boolean(payload?.strafeLeft),
    strafeRight: Boolean(payload?.strafeRight),
    ability1: Boolean(payload?.ability1),
    ability2: Boolean(payload?.ability2),
    speedBoost: Boolean(payload?.speedBoost),
  };
}

export function serializeInput(input) {
  return `${Number(input.forward)}${Number(input.backward)}${Number(input.left)}${Number(input.right)}${Number(input.strafeLeft)}${Number(input.strafeRight)}${Number(input.ability1)}${Number(input.ability2)}${Number(input.speedBoost)}`;
}

function setKey(keys, code, pressed) {
  if (code === 'KeyW') {
    keys.forward = pressed;
  } else if (code === 'KeyS') {
    keys.backward = pressed;
  } else if (code === 'KeyA') {
    keys.left = pressed;
  } else if (code === 'KeyD') {
    keys.right = pressed;
  } else if (code === 'KeyQ') {
    keys.ability1 = pressed;
  } else if (code === 'KeyE') {
    keys.ability2 = pressed;
  } else if (code === 'Space') {
    keys.speedBoost = pressed;
  }
}

function resetKeys(keys) {
  for (const key of Object.keys(keys)) {
    keys[key] = false;
  }
}