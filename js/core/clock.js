/**
 * Virtual sim clock. Headless episodes drive time explicitly so that
 * timing-dependent sim logic (cooldowns, countdown, lap/finish times) is
 * reproducible; normal play keeps wall-clock behavior.
 */
let virtual = false;
let virtualMs = 0;

export function simNow() {
  return virtual ? virtualMs : performance.now();
}

export function setSimClock(ms) {
  virtualMs = ms;
}

export function useVirtualClock(enabled) {
  virtual = !!enabled;
}
