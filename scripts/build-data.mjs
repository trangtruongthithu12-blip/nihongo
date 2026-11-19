// Builds the app's data files from the open-data downloads.
// Usage: node build-data.mjs <source-data dir> <output dir>
//
// Sources (credited in the app):
//   KanjiVG (CC BY-SA 3.0)               - stroke order paths
//   KANJIDIC2 / JMdict, EDRDG (CC BY-SA)  - kanji info, dictionary, examples (via kanji-data, MIT)
//   Tatoeba (CC BY 2.0 FR)                - example sentences inside JMdict
//   JLPT lists by Jonathan Waller (CC BY) - N5 word list (via jlpt-word-list, MIT)
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import kuromoji from "kuromoji";

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) { console.error("Usage: node build-data.mjs <source-data dir> <output dir>"); process.exit(1); }
const DL = path.join(SRC, "downloads");
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => {
  const s = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, name), s);
  console.log(`  ${name}: ${(s.length / 1024).toFixed(0)} KB`);
};

const isKanji = (c) => /[一-龯㐀-䶿々]/.test(c);
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// ---------------------------------------------------------------- kana
const ROWS = [
  ["a", "あいうえお", "アイウエオ", ["a", "i", "u", "e", "o"]],
  ["k", "かきくけこ", "カキクケコ", ["ka", "ki", "ku", "ke", "ko"]],
  ["s", "さしすせそ", "サシスセソ", ["sa", "shi", "su", "se", "so"]],
  ["t", "たちつてと", "タチツテト", ["ta", "chi", "tsu", "te", "to"]],
  ["n", "なにぬねの", "ナニヌネノ", ["na", "ni", "nu", "ne", "no"]],
  ["h", "はひふへほ", "ハヒフヘホ", ["ha", "hi", "fu", "he", "ho"]],
  ["m", "まみむめも", "マミムメモ", ["ma", "mi", "mu", "me", "mo"]],
  ["y", "やゆよ", "ヤユヨ", ["ya", "yu", "yo"]],
  ["r", "らりるれろ", "ラリルレロ", ["ra", "ri", "ru", "re", "ro"]],
  ["w", "わをん", "ワヲン", ["wa", "wo", "n"]],
  ["g", "がぎぐげご", "ガギグゲゴ", ["ga", "gi", "gu", "ge", "go"]],
  ["z", "ざじずぜぞ", "ザジズゼゾ", ["za", "ji", "zu", "ze", "zo"]],
  ["d", "だぢづでど", "ダヂヅデド", ["da", "ji", "zu", "de", "do"]],
  ["b", "ばびぶべぼ", "バビブベボ", ["ba", "bi", "bu", "be", "bo"]],
  ["p", "ぱぴぷぺぽ", "パピプペポ", ["pa", "pi", "pu", "pe", "po"]],
];
const YOON = [["き", "ky"], ["し", "sh"], ["ち", "ch"], ["に", "ny"], ["ひ", "hy"], ["み", "my"], ["り", "ry"], ["ぎ", "gy"], ["じ", "j"], ["び", "by"], ["ぴ", "py"]];
function buildKana() {
  const out = [];
  for (const [script, idx] of [["hiragana", 1], ["katakana", 2]]) {
    for (const row of ROWS) {
      [...row[idx]].forEach((ch, i) => out.push({ char: ch, romaji: row[3][i], script, group: row[0], kind: /^[gzdbp]$/.test(row[0]) ? "dakuten" : "basic" }));
    }
    for (const [base, cons] of YOON) {
      for (const [small, v] of [["ゃ", "a"], ["ゅ", "u"], ["ょ", "o"]]) {
        let ch = base + small;
        if (script === "katakana") ch = String.fromCharCode(base.charCodeAt(0) + 0x60) + String.fromCharCode(small.charCodeAt(0) + 0x60);
        out.push({ char: ch, romaji: cons + v, script, group: `y-${cons}`, kind: "combo" });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- strokes
const KVG = path.join(SRC, "kanjivg", "kanji");
function strokesFor(ch) {
  const hex = ch.codePointAt(0).toString(16).padStart(5, "0");
  const file = path.join(KVG, `${hex}.svg`);
  if (!fs.existsSync(file)) return null;
  const svg = fs.readFileSync(file, "utf8");
  const paths = [...svg.matchAll(/<path[^>]*\sid="kvg:[^"]*-s(\d+)"[^>]*\sd="([^"]+)"/g)]
    .map((m) => [Number(m[1]), m[2]]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  return paths.length ? paths : null;
}

// ---------------------------------------------------------------- JMdict
console.log("Reading JMdict…");
const xml = zlib.gunzipSync(fs.readFileSync(path.join(DL, "JMdict_e_examp.gz"))).toString("utf8");
const decodeEnt = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const all = (re, s) => [...s.matchAll(re)].map((m) => decodeEnt(m[1]));
const PRI = /^(ichi1|news1|spec1|spec2|gai1)$/;
const entries = [];
for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
  const e = m[1];
  const kebs = all(/<keb>([^<]+)<\/keb>/g, e);
  const rebs = all(/<reb>([^<]+)<\/reb>/g, e);
  const pris = all(/<(?:ke|re)_pri>([^<]+)<\/(?:ke|re)_pri>/g, e);
  const nf = Math.min(...pris.filter((p) => /^nf\d+/.test(p)).map((p) => Number(p.slice(2))), 99);
  const senses = [...e.matchAll(/<sense>([\s\S]*?)<\/sense>/g)].map((s) => ({
    gloss: all(/<gloss>([^<]+)<\/gloss>/g, s[1]),
    pos: all(/<pos>&([^;]+);<\/pos>/g, s[1]),
    uk: /<misc>&uk;<\/misc>/.test(s[1]),
  }));
  const examples = [...e.matchAll(/<example>([\s\S]*?)<\/example>/g)].map((x) => ({
    ja: decodeEnt((x[1].match(/<ex_sent xml:lang="jpn">([^<]+)</) || [])[1] || ""),
    en: decodeEnt((x[1].match(/<ex_sent xml:lang="eng">([^<]+)</) || [])[1] || ""),
  })).filter((x) => x.ja && x.en);
  entries.push({ kebs, rebs, common: pris.some((p) => PRI.test(p)), nf, senses, examples, uk: senses.some((s) => s.uk) });
}
console.log(`  ${entries.length} entries`);
const byKeb = new Map(), byReb = new Map();
for (const e of entries) {
  e.kebs.forEach((k) => { if (!byKeb.has(k)) byKeb.set(k, []); byKeb.get(k).push(e); });
  e.rebs.forEach((r) => { if (!byReb.has(r)) byReb.set(r, []); byReb.get(r).push(e); });
}
const allSentences = entries.flatMap((e) => e.examples);

// ---------------------------------------------------------------- furigana
console.log("Loading kuromoji…");
const dicPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "node_modules", "kuromoji", "dict");
const tokenizer = await new Promise((res, rej) => kuromoji.builder({ dicPath }).build((err, t) => (err ? rej(err) : res(t))));

// Returns [[text, reading?], ...]; reading only on parts with kanji.
function furigana(sentence) {
  const segs = [];
  for (const t of tokenizer.tokenize(sentence)) {
    const surface = t.surface_form;
    if (![...surface].some(isKanji) || !t.reading || t.reading === "*") { segs.push([surface]); continue; }
    let reading = surface === "日本" ? "にほん" : toHira(t.reading), text = surface;
    let pre = "", post = "";
    while (text && reading && text[0] === reading[0] && !isKanji(text[0])) { pre += text[0]; text = text.slice(1); reading = reading.slice(1); }
    while (text && reading && text.at(-1) === reading.at(-1) && !isKanji(text.at(-1))) { post = text.at(-1) + post; text = text.slice(0, -1); reading = reading.slice(0, -1); }
    if (pre) segs.push([pre]);
    segs.push(reading ? [text, reading] : [text]);
    if (post) segs.push([post]);
  }
  // merge neighbouring plain segments
  return segs.reduce((acc, s) => { const last = acc.at(-1); if (s.length === 1 && last && last.length === 1) last[0] += s[0]; else acc.push([...s]); return acc; }, []);
}

// ---------------------------------------------------------------- N5 kanji
const kanjiInfo = JSON.parse(fs.readFileSync(path.join(DL, "kanji.json"), "utf8"));
const N5_KANJI = Object.keys(kanjiInfo).filter((c) => kanjiInfo[c].jlpt_new === 5).sort((a, b) => (kanjiInfo[a].freq || 9999) - (kanjiInfo[b].freq || 9999));
const n5Set = new Set(N5_KANJI);

// Beginner-friendly: short, few kanji outside N5. Unpleasant topics are skipped.
const UNPLEASANT = /殺|死|くそ|クソ|馬鹿|ばか|バカ|戦争|血|自殺|酔っ払|嫌い|憎|地獄|泥棒|犯/;
function sentenceScore(ja, learnedKanji) {
  const hard = [...ja].filter((c) => isKanji(c) && !learnedKanji.has(c)).length;
  return ja.length + hard * 12 + (ja.length < 6 ? 20 : 0) + Math.max(0, ja.length - 22) * 2;
}
// The kanji part of a word and its reading: 行く/いく -> 行/い, 外国人 -> 外国人/がいこくじん.
function stemOf(word, reading) {
  let w = word, r = toHira(reading);
  while (w && r && !isKanji(w.at(-1)) && toHira(w.at(-1)) === r.at(-1)) { w = w.slice(0, -1); r = r.slice(0, -1); }
  while (w && r && !isKanji(w[0]) && toHira(w[0]) === r[0]) { w = w.slice(1); r = r.slice(1); }
  return { stem: w || word, sr: r || toHira(reading) };
}
// Is the stem read as expected in this sentence? (e.g. 後 = あと, not のち; 九 = く, not きゅう)
function readsAs(segs, stem, sr) {
  const text = segs.map((s) => s[0]).join("");
  const start = text.indexOf(stem);
  if (start < 0) return false;
  let pos = 0, got = "", aligned = true, covering = false;
  for (const s of segs) {
    const a = pos, b = pos + s[0].length;
    if (b > start && a < start + stem.length) {
      if (a < start || b > start + stem.length) aligned = false;
      got += toHira(s[1] || s[0]); covering = true;
    }
    pos = b;
  }
  return covering && aligned && (got === sr || (IRREGULAR[stem] || []).includes(got));
}
// Irregular verbs change the kanji reading when conjugated (来る: 来ます/来ない).
const IRREGULAR = { 来: ["く", "き", "こ"] };
function pickExamples(word, reading, list, max = 2, linked = false) {
  const seen = new Set();
  const hasKanji = [...word].some(isKanji);
  const { stem, sr } = stemOf(word, reading);
  const needle = hasKanji ? stem : word;
  return list
    .filter((x) => x.ja.length <= 40 && !UNPLEASANT.test(x.ja) && (x.ja.includes(needle) || (linked && !hasKanji && x.ja.includes(reading))))
    .filter((x) => !seen.has(x.ja) && seen.add(x.ja))
    .sort((a, b) => sentenceScore(a.ja, n5Set) - sentenceScore(b.ja, n5Set))
    .slice(0, 300)
    .map((x) => ({ ja: furigana(x.ja), en: x.en }))
    .filter((x) => !hasKanji || readsAs(x.ja, stem, sr))
    .slice(0, max);
}

// Essential first words for absolute beginners (in this order), then the rest by frequency.
const STARTER = ["私", "あなた", "これ", "それ", "あれ", "この", "その", "はい", "いいえ", "人", "日本", "学生", "先生", "名前", "何", "誰", "本", "水", "お茶", "今日", "明日", "昨日", "今", "時", "毎日", "行く", "来る", "食べる", "飲む", "見る", "大きい", "小さい", "いい", "好き", "友達"];

// ---------------------------------------------------------------- N5 vocabulary
function parseCsv(text) {
  const rows = [];
  for (const line of text.replace(/\r/g, "").split("\n").slice(1)) {
    if (!line.trim()) continue;
    const cells = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur); cur = ""; } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}
// Hand-written examples (scripts/extra-examples.txt): 漢字[よみ] marks furigana.
function parseRuby(s) {
  const segs = []; let last = 0;
  for (const m of s.matchAll(/([一-龯㐀-䶿々]+)\[([^\]]+)\]/g)) {
    if (m.index > last) segs.push([s.slice(last, m.index)]);
    segs.push([m[1], m[2]]); last = m.index + m[0].length;
  }
  if (last < s.length) segs.push([s.slice(last)]);
  return segs;
}
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const EXTRA = new Map();
for (const line of fs.readFileSync(path.join(here, "extra-examples.txt"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [w, r, ja, en] = line.split("|");
  EXTRA.set(`${w}|${r}`, { ja: parseRuby(ja.replace(/\s+/g, "")), en, own: true });
}

console.log("Building N5 vocabulary…");
const seenWords = new Set();
const vocab = [];
for (const [expr, readingRaw, meaning] of parseCsv(fs.readFileSync(path.join(DL, "n5.csv"), "utf8"))) {
  const word = expr.split(/[;；、,]/)[0].trim();
  const reading = readingRaw.split(/[;；、,]/)[0].replace(/\s*[(（].*?[)）]/g, "").trim();
  const key = `${word}|${reading}`;
  if (!word || seenWords.has(key)) continue;
  seenWords.add(key);
  const cands = [...(byKeb.get(word) || []), ...(word === reading ? byReb.get(reading) || [] : [])];
  const entry = cands.find((e) => e.rebs.includes(reading)) || cands[0];
  let examples = pickExamples(word, reading, entry ? entry.examples : [], 2, true);
  if (examples.length < 2) examples = [...examples, ...pickExamples(word, reading, allSentences, 2)
    .filter((x) => !examples.some((y) => JSON.stringify(y.ja) === JSON.stringify(x.ja)))];
  if (!examples.length && EXTRA.has(key)) examples = [EXTRA.get(key)];
  vocab.push({
    id: `n5-${vocab.length + 1}`,
    word, reading,
    meaning: meaning.trim(),
    pos: entry ? [...new Set(entry.senses[0]?.pos || [])].slice(0, 2) : [],
    kanji: [...word].filter(isKanji),
    nf: entry ? entry.nf : 99,
    common: entry ? entry.common : false,
    examples,
  });
}
// Teaching order: common words first; words with unknown kanji later.
const starterRank = (v) => { const i = STARTER.indexOf(v.word); return i < 0 ? 999 : i; };
vocab.sort((a, b) => {
  const hardA = a.kanji.filter((c) => !n5Set.has(c)).length, hardB = b.kanji.filter((c) => !n5Set.has(c)).length;
  return (starterRank(a) - starterRank(b)) || (b.common - a.common) || (a.nf - b.nf) || (hardA - hardB) || (a.word.length - b.word.length);
});
vocab.forEach((v, i) => { v.order = i; v.lesson = Math.floor(i / 10) + 1; delete v.nf; delete v.common; });
console.log(`  ${vocab.length} words, ${vocab.filter((v) => v.examples.length).length} with examples`);

const kanji = N5_KANJI.map((c, i) => {
  const k = kanjiInfo[c];
  return {
    char: c, order: i, lesson: Math.floor(i / 5) + 1, strokes: k.strokes,
    meanings: k.meanings.slice(0, 4), on: k.readings_on || [], kun: k.readings_kun || [],
    words: vocab.filter((v) => v.word.includes(c)).slice(0, 6).map((v) => v.id),
  };
});

// ---------------------------------------------------------------- strokes
console.log("Collecting stroke order…");
const kana = buildKana();
const coreChars = [...new Set([...kana.filter((k) => k.kind !== "combo").map((k) => k.char), ...N5_KANJI, ..."ゃゅょャュョっッー"])];
const strokes = {};
for (const c of coreChars) { const s = strokesFor(c); if (s) strokes[c] = s; else console.warn(`  no strokes for ${c}`); }
const extraChars = Object.keys(kanjiInfo).filter((c) => (kanjiInfo[c].grade && kanjiInfo[c].grade <= 8) || kanjiInfo[c].jlpt_new);
const strokesAll = {};
for (const c of extraChars) { if (strokes[c]) continue; const s = strokesFor(c); if (s) strokesAll[c] = s; }

// ---------------------------------------------------------------- "My book" dictionary (common words)
console.log("Building dictionary for My book…");
const dict = [];
for (const e of entries) {
  if (!e.common) continue;
  const ex = e.examples.slice().sort((a, b) => sentenceScore(a.ja, n5Set) - sentenceScore(b.ja, n5Set))[0];
  dict.push({
    k: e.kebs.slice(0, 2), r: e.rebs.slice(0, 2),
    m: e.senses.slice(0, 3).map((s) => s.gloss.slice(0, 3).join(", ")).join("; "),
    f: e.nf, // frequency rank (1 = most common), for ordering search results
    uk: e.uk || undefined,
    ex: ex && ex.ja.length <= 50 ? { ja: furigana(ex.ja), en: ex.en } : undefined,
  });
}
const kanjiAll = {};
for (const c of extraChars) {
  const k = kanjiInfo[c];
  kanjiAll[c] = { m: (k.meanings || []).slice(0, 3), on: (k.readings_on || []).slice(0, 3), kun: (k.readings_kun || []).slice(0, 3), s: k.strokes };
}

console.log("Writing files:");
write("kana.json", kana);
write("kanji-n5.json", kanji);
write("vocab-n5.json", vocab);
write("strokes-core.json", strokes);
write("strokes-extra.json", strokesAll);
write("dict-common.json", dict);
write("kanji-info.json", kanjiAll);
console.log("Done.");
