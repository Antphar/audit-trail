export const URL_PARAMS = new URLSearchParams(window.location.search);
export const HEADLESS_MODE = URL_PARAMS.has("headless");

export function headlessFlag(name, defaultValue = false) {
  const raw = URL_PARAMS.get(name);
  if (raw === null) return defaultValue;
  return raw === "" || raw === "1" || raw === "true" || raw === "yes";
}
