// Loads the built-in content (files in /data, cached for offline use by the service worker).
const cache = {};
async function json(name) {
  if (!cache[name]) {
    cache[name] = fetch(`data/${name}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${name}`);
      return r.json();
    }).catch((e) => { delete cache[name]; throw e; });
  }
  return cache[name];
}

export const D = { kana: [], kanji: [], vocab: [], strokes: {}, byId: new Map() };

export async function loadCore() {
  const [kana, kanji, vocab, strokes] = await Promise.all([json("kana.json"), json("kanji-n5.json"), json("vocab-n5.json"), json("strokes-core.json")]);
  Object.assign(D, { kana, kanji, vocab, strokes });
  kana.forEach((k) => D.byId.set(`kana:${k.char}`, { type: "kana", ...k }));
  kanji.forEach((k) => D.byId.set(`kanji:${k.char}`, { type: "kanji", ...k }));
  vocab.forEach((v) => D.byId.set(`vocab:${v.id}`, { type: "vocab", ...v }));
}

// Extra stroke data and dictionary are big, so they load only when needed (My book, rare kanji).
export async function strokesOf(ch) {
  if (D.strokes[ch]) return D.strokes[ch];
  const extra = await json("strokes-extra.json");
  return extra[ch] || null;
}
export const loadDict = () => json("dict-common.json");
export const loadKanjiInfo = () => json("kanji-info.json");

export const isKanji = (c) => /[一-龯㐀-䶿々]/.test(c);
export const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
