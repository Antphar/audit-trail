const keysP1 = { up: false, down: false, left: false, right: false, drift: false, driftPressed: false, item: false, itemPressed: false, ult: false, ultPressed: false, honk: false, honkPressed: false, leftPressed: false, rightPressed: false };
const keysP2 = { up: false, down: false, left: false, right: false, drift: false, driftPressed: false, item: false, itemPressed: false, ult: false, ultPressed: false, honk: false, honkPressed: false, leftPressed: false, rightPressed: false };
const keysGlobal = { pause: false, pausePressed: false, restart: false, restartPressed: false, mute: false, mutePressed: false, enter: false, enterPressed: false, back: false, backPressed: false };
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

export { keysP1, keysP2, keysGlobal, consumePressedGlobal, consumePressedP1, consumePressedP2, consumePressed };
