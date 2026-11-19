// Progress and settings, saved on this device. (Online sync plugs in through onChange.)
const KEY = "nihongo-state-v1";

const DEFAULT_SETTINGS = {
  newKana: 10,        // per day while learning kana
  newKanji: 4,        // per day
  newVocab: 8,        // per day
  minutes: 20,        // daily goal
  furigana: "auto",   // auto = hide over kanji you know well; always; never
  pencilOnly: "auto", // auto = ignore fingers once the Apple Pencil is used; on; off
  strictness: "normal",
  voiceRate: 0.9,
  autoplay: true,
};

function blank() {
  return { version: 1, cards: {}, learned: {}, mybook: [], removed: [], days: {}, settings: { ...DEFAULT_SETTINGS }, settingsAt: 0, updatedAt: 0 };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    return { ...blank(), ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) } };
  } catch { return blank(); }
}

let saveTimer = null;
function save() {
  state.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn("Could not save progress", e); }
  }, 150);
  listeners.forEach((fn) => fn(state));
}

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  card(id) { return state.cards[id] || null; },
  setCard(id, card) { state.cards[id] = card; save(); },
  markLearned(itemId) { state.learned[itemId] = Date.now(); save(); },
  isLearned(itemId) { return Boolean(state.learned[itemId]); },
  setSetting(k, v) { state.settings[k] = v; state.settingsAt = Date.now(); save(); },
  addMyBook(entry) { state.mybook.push(entry); save(); },
  removeMyBook(id) {
    state.mybook = state.mybook.filter((e) => e.id !== id);
    state.removed = [...(state.removed || []), id];
    for (const k of ["read", "write"]) delete state.cards[`my:${id}:${k}`];
    delete state.learned[`my:${id}`];
    save();
  },
  logDay(kind, n = 1, seconds = 0) {
    const d = today();
    const day = state.days[d] || (state.days[d] = { reviews: 0, learned: 0, seconds: 0 });
    day[kind] = (day[kind] || 0) + n;
    day.seconds += seconds;
    save();
  },
  replace(newState) { state = { ...blank(), ...newState, settings: { ...DEFAULT_SETTINGS, ...(newState.settings || {}) } }; save(); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  flush() { clearTimeout(saveTimer); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } },
};

export function today(t = Date.now()) {
  const d = new Date(t - 4 * 3600 * 1000); // the study day starts at 4 am
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function streak() {
  let n = 0;
  const t = Date.now();
  for (let i = 0; i < 3650; i++) {
    const d = today(t - i * 86400000);
    const day = state.days[d];
    if (day && (day.reviews || day.learned)) n++;
    else if (i > 0) break;
  }
  return n;
}

window.addEventListener("pagehide", () => store.flush());
