const keysP1 = { up: false, down: false, left: false, right: false, drift: false, driftPressed: false, item: false, itemPressed: false, ult: false, ultPressed: false, honk: false, honkPressed: false, leftPressed: false, rightPressed: false };
const keysP2 = { up: false, down: false, left: false, right: false, drift: false, driftPressed: false, item: false, itemPressed: false, ult: false, ultPressed: false, honk: false, honkPressed: false, leftPressed: false, rightPressed: false };
const keysGlobal = { pause: false, pausePressed: false, restart: false, restartPressed: false, mute: false, mutePressed: false, enter: false, enterPressed: false, back: false, backPressed: false };

const ACTIONS_P1 = ["up", "down", "left", "right", "drift", "item", "ult", "honk"];
const ACTIONS_GLOBAL = ["pause", "restart", "mute", "enter", "back"];
const EDGE_P1_P2 = new Set(["left", "right", "drift", "item", "ult", "honk"]);
const EDGE_GLOBAL = new Set(["pause", "restart", "mute", "enter", "back"]);

function createHeldMap(actions) {
  const map = {};
  for (const a of actions) map[a] = new Set();
  return map;
}

const heldCodes = {
  p1: createHeldMap(ACTIONS_P1),
  p2: createHeldMap(ACTIONS_P1),
  global: createHeldMap(ACTIONS_GLOBAL),
};

const TARGETS = {
  p1: { keys: keysP1, held: heldCodes.p1, edgeActions: EDGE_P1_P2 },
  p2: { keys: keysP2, held: heldCodes.p2, edgeActions: EDGE_P1_P2 },
  global: { keys: keysGlobal, held: heldCodes.global, edgeActions: EDGE_GLOBAL },
};

function setActionCode(targetName, action, code, isDown) {
  const target = TARGETS[targetName];
  if (!target) return;
  const set = target.held[action];
  if (!set) return;
  const wasDown = target.keys[action];
  if (isDown) {
    set.add(code);
    if (!wasDown && target.edgeActions.has(action)) {
      target.keys[action + "Pressed"] = true;
    }
    target.keys[action] = true;
  } else {
    set.delete(code);
    target.keys[action] = set.size > 0;
  }
}

function resetGroup(keys, held) {
  for (const k of Object.keys(keys)) {
    keys[k] = false;
  }
  for (const set of Object.values(held)) {
    set.clear();
  }
}

function resetAllInputs() {
  resetGroup(keysP1, heldCodes.p1);
  resetGroup(keysP2, heldCodes.p2);
  resetGroup(keysGlobal, heldCodes.global);
}

function readPadActions(pad) {
  const btns = pad?.buttons || [];
  const axes = pad?.axes || [];
  const btnDown = (idx, threshold = 0.25) => !!(btns[idx] && (btns[idx].pressed || btns[idx].value > threshold));
  const axisX = Number(axes[0] || 0);
  const axisY = Number(axes[1] || 0);
  return {
    up: btnDown(0) || btnDown(7) || btnDown(12) || axisY < -0.45,
    down: btnDown(1) || btnDown(6) || btnDown(13) || axisY > 0.45,
    left: btnDown(14) || axisX < -0.25,
    right: btnDown(15) || axisX > 0.25,
    drift: btnDown(5),
    item: btnDown(2) || btnDown(4),
    ult: btnDown(3),
    honk: btnDown(8) || btnDown(10) || btnDown(11),
    pause: btnDown(9),
  };
}

function applyPadToTarget(targetName, pad) {
  const state = pad ? readPadActions(pad) : null;
  for (const action of ACTIONS_P1) {
    setActionCode(targetName, action, "__gamepad__", !!(state && state[action]));
  }
}

function pollGamepads({ splitScreen = false } = {}) {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return;
  let pads;
  try {
    pads = navigator.getGamepads();
  } catch (e) {
    return;
  }
  if (!pads) return;
  const connected = [];
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].connected) connected.push(pads[i]);
  }
  const pad0 = connected[0] || null;
  applyPadToTarget("p1", pad0);
  setActionCode("global", "pause", "__gamepad__", !!(pad0 && readPadActions(pad0).pause));
  if (splitScreen) {
    applyPadToTarget("p2", connected[1] || null);
  } else {
    applyPadToTarget("p2", null);
  }
}

function consumePressedGlobal(action) {
  const flag = action + "Pressed";
  if (keysGlobal[flag]) {
    keysGlobal[flag] = false;
    return true;
  }
  return false;
}
function consumePressedP1(action) {
  const flag = action + "Pressed";
  if (keysP1[flag]) {
    keysP1[flag] = false;
    return true;
  }
  return false;
}
function consumePressedP2(action) {
  const flag = action + "Pressed";
  if (keysP2[flag]) {
    keysP2[flag] = false;
    return true;
  }
  return false;
}

function consumePressed(action) {
  if (consumePressedGlobal(action)) return true;
  if (consumePressedP1(action)) return true;
  if (consumePressedP2(action)) return true;
  return false;
}

export {
  keysP1,
  keysP2,
  keysGlobal,
  setActionCode,
  resetAllInputs,
  pollGamepads,
  consumePressedGlobal,
  consumePressedP1,
  consumePressedP2,
  consumePressed,
};
