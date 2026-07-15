const SETTINGS_STORAGE_KEY = "turboKartDash.settings.v1";
function loadGameSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}
const RECORDS_STORAGE_KEY = "turboKartDash.records.v1";

function loadRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function getMapRecord(mapId) {
  const all = loadRecords();
  return all[mapId] || null;
}

// Update stored bests for a map. Returns which records were beaten this run.
function updateMapRecord(mapId, { total, lap } = {}) {
  const beaten = { total: false, lap: false };
  if (!mapId) return beaten;
  try {
    const all = loadRecords();
    const cur = all[mapId] || {};
    if (Number.isFinite(total) && total > 0 && (!Number.isFinite(cur.bestTotal) || total < cur.bestTotal)) {
      cur.bestTotal = total;
      beaten.total = true;
    }
    if (Number.isFinite(lap) && lap > 0 && (!Number.isFinite(cur.bestLap) || lap < cur.bestLap)) {
      cur.bestLap = lap;
      beaten.lap = true;
    }
    all[mapId] = cur;
    localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    // Storage unavailable (private mode / sandbox) — records just won't persist.
  }
  return beaten;
}

export { SETTINGS_STORAGE_KEY, loadGameSettings, RECORDS_STORAGE_KEY, loadRecords, getMapRecord, updateMapRecord };
