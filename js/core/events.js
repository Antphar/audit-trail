const listeners = new Map();

export const bus = {
  on(type, fn) {
    let arr = listeners.get(type);
    if (!arr) {
      arr = [];
      listeners.set(type, arr);
    }
    arr.push(fn);
  },

  off(type, fn) {
    const arr = listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },

  emit(type, payload) {
    const arr = listeners.get(type);
    if (!arr || !arr.length) return;
    for (let i = 0, n = arr.length; i < n; i++) {
      arr[i](payload);
    }
  },
};
