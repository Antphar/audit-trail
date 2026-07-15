export function createScreenManager() {
  const registry = new Map();

  return {
    register(name, element) {
      registry.set(name, element);
    },
    show(name) {
      for (const el of registry.values()) {
        el.classList.add("hidden");
      }
      const el = registry.get(name);
      if (el) el.classList.remove("hidden");
    },
    hide(name) {
      const el = registry.get(name);
      if (el) el.classList.add("hidden");
    },
    hideAll() {
      for (const el of registry.values()) {
        el.classList.add("hidden");
      }
    },
    isVisible(name) {
      const el = registry.get(name);
      return el ? !el.classList.contains("hidden") : false;
    },
  };
}

export const screens = createScreenManager();
