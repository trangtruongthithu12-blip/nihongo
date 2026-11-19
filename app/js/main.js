import { D, loadCore, strokesOf, loadDict, loadKanjiInfo, isKanji, toHira } from "./data.js";
import { store, today, streak } from "./store.js";
import { newCard, review, preview, strength, GRADES, startOfDay } from "./srs.js";
import { say, hasJapaneseVoice } from "./speech.js";
import { createPad, strokeOrderSvg } from "./writing.js";
import { sync } from "./sync.js";

// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const app = $("#app");
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((p) => p[1]);

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ---------------------------------------------------------------- items & cards
const KANA_ORDER = (k) => (k.script === "hiragana" ? 0 : 1000) + ({ basic: 0, dakuten: 300, combo: 600 }[k.kind]);
function allItems() {
  const kana = D.kana.map((k, i) => ({ id: `kana:${k.char}`, type: "kana", order: KANA_ORDER(k) + i, ...k }));
  const kanji = D.kanji.map((k) => ({ id: `kanji:${k.char}`, type: "kanji", ...k }));
  const vocab = D.vocab.map((v) => ({ ...v, id: `vocab:${v.id}`, vid: v.id, type: "vocab" }));
  const mine = store.state.mybook.map((m) => ({ ...m, id: `my:${m.id}`, type: "vocab", mine: true }));
  return { kana: kana.sort((a, b) => a.order - b.order), kanji, vocab, mine };
}
let ITEMS = null;
const refreshItems = () => { ITEMS = allItems(); ITEMS.map = new Map([...ITEMS.kana, ...ITEMS.kanji, ...ITEMS.vocab, ...ITEMS.mine].map((i) => [i.id, i])); };
const item = (id) => ITEMS.map.get(id);
const writable = (s) => [...s].filter((c) => c !== "～" && c !== "〜" && c !== " ");

function cardKinds(it) {
  if (it.type === "kana") return it.kind === "combo" ? ["read"] : ["read", "write"];
  if (it.type === "kanji") return ["read", "write"];
  return ["read", "write"];
}
const cardsOf = (it) => cardKinds(it).map((k) => store.card(`${it.id}:${k}`));
const itemStrength = (it) => store.isLearned(it.id) ? strength(cardsOf(it)) : "new";

function learnItem(it) {
  if (store.isLearned(it.id)) return;
  store.markLearned(it.id);
  const now = Date.now();
  cardKinds(it).forEach((k, i) => store.setCard(`${it.id}:${k}`, { ...newCard(now), due: now + i * 30000 }));
  store.logDay("learned", 1);
}

function dueCards(now = Date.now()) {
  const out = [];
  for (const [id, c] of Object.entries(store.state.cards)) {
    if (c.due <= now && item(id.replace(/:(read|write)$/, ""))) out.push(id);
  }
  return out.sort((a, b) => store.card(a).due - store.card(b).due);
}

const learnedTodayOf = (type) => Object.entries(store.state.learned).filter(([id, t]) => today(t) === today() && id.startsWith(type)).length;
const kanaDone = (script, kinds = ["basic", "dakuten"]) => ITEMS.kana.filter((k) => k.script === script && kinds.includes(k.kind)).every((k) => store.isLearned(k.id));

// Today's new items, following the recommended order.
function plannedNew() {
  const s = store.settings, out = [];
  const kanaLeft = ITEMS.kana.filter((k) => !store.isLearned(k.id));
  const kanaQuota = Math.max(0, s.newKana - learnedTodayOf("kana:"));
  out.push(...kanaLeft.slice(0, kanaQuota));
  if (kanaDone("hiragana")) {
    const kq = Math.max(0, s.newKanji - learnedTodayOf("kanji:"));
    out.push(...ITEMS.kanji.filter((k) => !store.isLearned(k.id)).slice(0, kq));
    const vq = Math.max(0, s.newVocab - learnedTodayOf("vocab:") - learnedTodayOf("my:"));
    out.push(...[...ITEMS.mine, ...ITEMS.vocab].filter((v) => !store.isLearned(v.id)).slice(0, vq));
  }
  return out;
}

// ---------------------------------------------------------------- furigana
function knownKanji(c) {
  const it = ITEMS.map.get(`kanji:${c}`);
  return it && ["known", "mastered"].includes(itemStrength(it));
}
function ruby(segs, { force } = {}) {
  const mode = force || store.settings.furigana;
  return segs.map(([t, r]) => {
    if (!r) return esc(t);
    const show = mode === "always" || (mode === "auto" && [...t].some((c) => isKanji(c) && !knownKanji(c)));
    return show ? `<ruby>${esc(t)}<rt>${esc(r)}</rt></ruby>` : `<ruby class="rt-hidden" title="${esc(r)}">${esc(t)}<rt>${esc(r)}</rt></ruby>`;
  }).join("");
}
const plainOf = (segs) => segs.map((s) => s[0]).join("");
// Furigana for a word (whole-word reading, okurigana kept outside).
function wordRuby(word, reading) {
  if (![...word].some(isKanji) || !reading || word === reading) return [[word]];
  let w = word, r = toHira(reading), post = "", pre = "";
  while (w && r && !isKanji(w.at(-1)) && toHira(w.at(-1)) === r.at(-1)) { post = w.at(-1) + post; w = w.slice(0, -1); r = r.slice(0, -1); }
  while (w && r && !isKanji(w[0]) && toHira(w[0]) === r[0]) { pre += w[0]; w = w.slice(1); r = r.slice(1); }
  return [...(pre ? [[pre]] : []), [w, r], ...(post ? [[post]] : [])];
}

// ---------------------------------------------------------------- router
const routes = {};
function go(hash) { location.hash = hash; }
async function render() {
  const [r, ...args] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const view = routes[r || "today"] || routes.today;
  window.speechSynthesis?.cancel();
  document.body.dataset.view = r || "today";
  await view(...args);
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", () => { if (!session.active) render(); });

function shell(content, active) {
  const tab = (h, icon, label) => `<a href="#/${h}" class="tab ${active === h ? "on" : ""}"><span>${icon}</span>${label}</a>`;
  app.innerHTML = `<main class="page">${content}</main>
    <nav class="tabbar">${tab("today", "🏠", "Today")}${tab("learn", "📚", "Learn")}${tab("write", "✍️", "Write")}${tab("mybook", "📘", "My book")}${tab("settings", "⚙️", "Settings")}</nav>`;
}

// ---------------------------------------------------------------- today
routes.today = () => {
  const due = dueCards().length;
  const planned = plannedNew();
  const day = store.state.days[today()] || { reviews: 0, learned: 0, seconds: 0 };
  const mins = Math.round(day.seconds / 60), goal = store.settings.minutes;
  const pct = Math.min(100, Math.round((day.seconds / 60 / goal) * 100));
  const count = (list) => `${list.filter((i) => store.isLearned(i.id)).length}/${list.length}`;
  const hira = ITEMS.kana.filter((k) => k.script === "hiragana"), kata = ITEMS.kana.filter((k) => k.script === "katakana");
  const nextStep = !kanaDone("hiragana") ? "Start with <b>hiragana</b>, the basic Japanese alphabet. Kanji and words unlock in your daily plan once you know it."
    : !kanaDone("katakana") ? "Hiragana done! Now <b>katakana</b>, plus your first kanji and words."
    : "Keep going with N5 kanji and vocabulary.";
  shell(`
    <header class="hello"><h1>今日も がんばろう！</h1><p class="muted">Let's do our best today!</p></header>
    <section class="today-card">
      <div class="ring" style="--p:${pct}"><div><b>${mins}</b><small>/ ${goal} min</small></div></div>
      <div class="today-info">
        <div class="stat-row">
          <div><b>${due}</b><span>reviews due</span></div>
          <div><b>${planned.length}</b><span>new today</span></div>
          <div><b>🔥 ${streak()}</b><span>day streak</span></div>
        </div>
        <button class="btn primary big" id="start" ${due + planned.length ? "" : "disabled"}>${due + planned.length ? "▶ Start today's session" : "✓ All done for today"}</button>
        ${due && planned.length ? `<button class="btn ghost" id="reviews-only">Reviews only (${due})</button>` : ""}
      </div>
    </section>
    <p class="tip">💡 ${nextStep}</p>
    <section class="progress-list">
      ${progressRow("ひ", "Hiragana", count(hira), hira, "#/learn/kana/hiragana")}
      ${progressRow("カ", "Katakana", count(kata), kata, "#/learn/kana/katakana")}
      ${progressRow("日", "Kanji N5", count(ITEMS.kanji), ITEMS.kanji, "#/learn/kanji")}
      ${progressRow("語", "Words N5", count(ITEMS.vocab), ITEMS.vocab, "#/learn/vocab")}
      ${ITEMS.mine.length ? progressRow("📘", "My book", count(ITEMS.mine), ITEMS.mine, "#/mybook") : ""}
    </section>
    ${hasJapaneseVoice() ? "" : `<p class="tip warn">🔈 No Japanese voice found on this device. On iPhone/iPad: Settings → Accessibility → Spoken Content → Voices → Japanese.</p>`}`, "today");
  $("#start")?.addEventListener("click", () => startSession({ newItems: planned }));
  $("#reviews-only")?.addEventListener("click", () => startSession({ newItems: [] }));
};

function progressRow(icon, label, text, list, href) {
  const known = list.filter((i) => ["known", "mastered"].includes(itemStrength(i))).length;
  const learned = list.filter((i) => store.isLearned(i.id)).length;
  return `<a class="prog" href="${href}"><span class="prog-icon jp">${icon}</span><span class="prog-body"><b>${label}</b>
    <span class="bar"><i class="learned" style="width:${(learned / list.length) * 100}%"></i><i class="known" style="width:${(known / list.length) * 100}%"></i></span></span>
    <span class="prog-num">${text}</span></a>`;
}

// ---------------------------------------------------------------- session
const session = { active: false };

function startSession({ newItems }) {
  Object.assign(session, { active: true, newItems: [...newItems], started: Date.now(), lastTick: Date.now(), done: 0, learned: 0, ids: new Set(), results: [] });
  nextInSession();
}

function sessionTime() {
  const now = Date.now(), dt = Math.min(120000, now - session.lastTick);
  session.lastTick = now;
  store.logDay("seconds", 0, Math.round(dt / 1000));
}

function nextInSession() {
  sessionTime();
  const now = Date.now();
  const due = dueCards(now);
  if (due.length) return showCard(due[0]);
  if (session.newItems.length) return showLearn(session.newItems.shift(), { inSession: true });
  // pull forward cards still in learning from this session (due within 15 min)
  const soon = [...session.ids].filter((id) => store.card(id) && store.card(id).due - now < 15 * 60000).sort((a, b) => store.card(a).due - store.card(b).due);
  if (soon.length) return showCard(soon[0]);
  endSession();
}

function endSession() {
  session.active = false;
  const mins = Math.round((Date.now() - session.started) / 60000);
  const right = session.results.filter((g) => g >= GRADES.good).length;
  app.innerHTML = `<main class="page center">
    <div class="done-big">🎉</div><h1>お疲れさまでした！</h1><p class="muted">Good work today.</p>
    <div class="stat-row big"><div><b>${session.done}</b><span>reviews</span></div><div><b>${session.learned}</b><span>new items</span></div>
      <div><b>${session.results.length ? Math.round((right / session.results.length) * 100) : 0}%</b><span>correct</span></div><div><b>${mins}</b><span>minutes</span></div></div>
    <button class="btn primary big" id="home">Back to Today</button></main>`;
  $("#home").addEventListener("click", () => { go("#/today"); render(); });
  sync.push();
}

function sessionHeader(label) {
  const mins = Math.floor((Date.now() - session.started) / 60000);
  const left = dueCards().length + session.newItems.length;
  return `<header class="sess-head"><button class="icon-btn" id="quit" aria-label="End session">✕</button>
    <div class="sess-label">${label}</div><div class="sess-meta">${left} left · ${mins} min</div></header>`;
}
function bindQuit() {
  $("#quit")?.addEventListener("click", () => { sessionTime(); session.active = false; go("#/today"); render(); sync.push(); });
}

function grade(cardId, g) {
  const c = store.card(cardId) || newCard();
  store.setCard(cardId, review(c, g));
  session.ids.add(cardId);
  session.done += 1; session.results.push(g);
  store.logDay("reviews", 1);
  nextInSession();
}

function gradeButtons(cardId, suggested) {
  const c = store.card(cardId) || newCard();
  const b = (g, label, cls) => `<button class="grade ${cls} ${suggested === g ? "suggested" : ""}" data-g="${g}"><b>${label}</b><small>${preview(c, g)}</small></button>`;
  return `<div class="grades">${b(GRADES.again, "Again", "again")}${b(GRADES.hard, "Hard", "hard")}${b(GRADES.good, "Good", "good")}${b(GRADES.easy, "Easy", "easy")}</div>`;
}
function bindGrades(cardId) {
  $$(".grade").forEach((btn) => btn.addEventListener("click", () => grade(cardId, Number(btn.dataset.g))));
}

async function showCard(cardId) {
  const [type, key, kind] = cardId.split(":");
  const it = item(`${type}:${key}`);
  if (!it) { delete store.state.cards[cardId]; return nextInSession(); }
  if (it.type === "kana") return kind === "read" ? kanaRead(it, cardId) : writeCard(it, cardId);
  if (it.type === "kanji") return kind === "read" ? kanjiRead(it, cardId) : writeCard(it, cardId);
  return kind === "read" ? vocabRead(it, cardId) : writeCard(it, cardId);
}

// Kana: pick the right romaji.
function kanaRead(it, cardId) {
  const same = ITEMS.kana.filter((k) => k.script === it.script && k.romaji !== it.romaji);
  const opts = shuffle([it.romaji, ...shuffle([...new Set(same.map((k) => k.romaji))]).slice(0, 3)]);
  app.innerHTML = `${sessionHeader(it.script === "hiragana" ? "Hiragana" : "Katakana")}
    <main class="page card-page"><div class="prompt jp huge">${esc(it.char)}</div><p class="muted center">How do you read this?</p>
    <div class="choices">${opts.map((o) => `<button class="choice" data-o="${o}">${o}</button>`).join("")}</div><div id="after"></div></main>`;
  bindQuit();
  $$(".choice").forEach((b) => b.addEventListener("click", () => {
    const ok = b.dataset.o === it.romaji;
    $$(".choice").forEach((x) => { x.disabled = true; if (x.dataset.o === it.romaji) x.classList.add("right"); });
    if (!ok) b.classList.add("wrong");
    say(it.char);
    $("#after").innerHTML = `<p class="center">${ok ? "✅ Correct!" : `❌ It's <b>${it.romaji}</b>`}</p>${gradeButtons(cardId, ok ? GRADES.good : GRADES.again)}`;
    bindGrades(cardId);
  }));
}

function kanjiRead(it, cardId) {
  app.innerHTML = `${sessionHeader("Kanji")}
    <main class="page card-page"><div class="prompt jp huge">${esc(it.char)}</div><p class="muted center">What does it mean? How is it read?</p>
    <div id="answer"></div><div class="center"><button class="btn primary big" id="show">Show answer</button></div></main>`;
  bindQuit();
  $("#show").addEventListener("click", () => {
    $("#show").remove();
    $("#answer").innerHTML = kanjiFacts(it) + gradeButtons(cardId);
    bindGrades(cardId); bindSay();
  });
}

function kanjiFacts(it) {
  const words = it.words.map((w) => ITEMS.map.get(`vocab:${w}`)).filter(Boolean).slice(0, 4);
  return `<div class="facts">
    <div class="meaning">${esc(it.meanings.join(", "))}</div>
    <div class="readings"><span class="rtag on">On</span> <span class="jp">${esc(it.on.join("、") || "–")}</span>
      <span class="rtag kun">Kun</span> <span class="jp">${esc(it.kun.join("、") || "–")}</span></div>
    ${words.length ? `<div class="mini-words">${words.map((w) => `<button class="mini-word say" data-say="${esc(w.reading)}"><span class="jp">${ruby(wordRuby(w.word, w.reading), { force: "always" })}</span><small>${esc(w.meaning.split(/[;,]/)[0])}</small></button>`).join("")}</div>` : ""}
  </div>`;
}

function vocabRead(it, cardId) {
  app.innerHTML = `${sessionHeader(it.mine ? `My book${it.lesson ? ` · ${esc(it.lesson)}` : ""}` : "Words")}
    <main class="page card-page"><div class="prompt jp large">${ruby(wordRuby(it.word, it.reading), { force: "never" })}</div>
    <p class="muted center">Do you know this word? Say it, then check.</p>
    <div id="answer"></div><div class="center"><button class="btn primary big" id="show">Show answer</button></div></main>`;
  bindQuit();
  $("#show").addEventListener("click", () => {
    $("#show").remove();
    $(".prompt").innerHTML = ruby(wordRuby(it.word, it.reading), { force: "always" });
    $("#answer").innerHTML = vocabFacts(it) + gradeButtons(cardId);
    bindGrades(cardId); bindSay();
    if (store.settings.autoplay) say(it.reading || it.word);
  });
}

function vocabFacts(it, { full = false } = {}) {
  const ex = (it.examples || (it.example ? [it.example] : [])).slice(0, full ? 2 : 1);
  const kanjiParts = [...new Set([...it.word].filter(isKanji))].map((c) => ITEMS.map.get(`kanji:${c}`)).filter(Boolean);
  return `<div class="facts">
    <div class="reading jp">${esc(it.reading)} <button class="say-btn say" data-say="${esc(it.reading || it.word)}" aria-label="Play">🔊</button></div>
    <div class="meaning">${esc(it.meaning)}</div>
    ${ex.map((e) => `<div class="example"><div class="ex-ja jp"><span class="sent">${ruby(e.ja)}</span><button class="say-btn say" data-say="${esc(plainOf(e.ja))}" aria-label="Play sentence">🔊</button></div><div class="ex-en">${esc(e.en)}</div></div>`).join("")}
    ${full && kanjiParts.length ? `<div class="kanji-parts">${kanjiParts.map((k) => `<a href="#/item/${encodeURIComponent(k.id)}" class="kpart"><span class="jp">${k.char}</span><small>${esc(k.meanings[0])}</small></a>`).join("")}</div>` : ""}
  </div>`;
}

function bindSay() { $$(".say").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); say(b.dataset.say); })); }

// Write from memory with the Apple Pencil.
async function writeCard(it, cardId) {
  const text = it.type === "vocab" ? it.word : it.char;
  const chars = writable(text);
  const prompt = it.type === "kana" ? `<div class="prompt big-romaji">${esc(it.romaji)}</div><p class="muted center">Write this ${it.script} from memory.</p>`
    : it.type === "kanji" ? `<div class="prompt meaning-prompt">${esc(it.meanings.join(", "))}</div><p class="muted center jp">${esc([...it.kun, ...it.on].slice(0, 3).join("、"))}</p><p class="muted center">Write the kanji.</p>`
    : `<div class="prompt meaning-prompt">${esc(it.meaning)}</div><p class="center jp reading-hint">${esc(it.reading)}</p><p class="muted center">Write the word${chars.some(isKanji) ? " (with kanji)" : ""}.</p>`;
  app.innerHTML = `${sessionHeader("Writing")}<main class="page card-page">${prompt}
    <div class="char-progress" id="cp"></div><div id="pad-area" class="pad-area"></div><p id="pad-msg" class="pad-msg"></p>
    <div class="pad-tools"><button class="btn ghost" id="hint">💡 Hint</button><button class="btn ghost" id="giveup">Show me</button></div><div id="after"></div></main>`;
  bindQuit();
  $(".say")?.addEventListener("click", () => say(text));
  let totalMistakes = 0, totalGiven = 0, i = 0, pad;
  const strokesList = await Promise.all(chars.map((c) => strokesOf(c)));
  const drawProgress = () => { $("#cp").innerHTML = chars.length > 1 ? chars.map((c, k) => `<span class="cp ${k < i ? "done" : k === i ? "cur" : ""}">${k < i ? esc(c) : "？"}</span>`).join("") : ""; };
  const finish = () => {
    $(".pad-tools").remove();
    const g = totalGiven > 0 || totalMistakes >= 4 ? GRADES.again : totalMistakes >= 2 ? GRADES.hard : totalMistakes === 1 ? GRADES.good : GRADES.easy;
    say(it.type === "vocab" ? it.reading || it.word : it.char);
    $("#pad-msg").innerHTML = `${g >= GRADES.good ? "✅" : "📝"} <span class="jp">${esc(text)}</span>: ${totalMistakes} mistake${totalMistakes === 1 ? "" : "s"}${totalGiven ? `, ${totalGiven} stroke${totalGiven === 1 ? "" : "s"} shown` : ""}`;
    $("#after").innerHTML = (it.type === "vocab" ? vocabFacts(it) : "") + gradeButtons(cardId, g);
    bindGrades(cardId); bindSay();
  };
  const nextChar = () => {
    while (i < chars.length && !strokesList[i]) i++; // characters without stroke data (e.g. ー) are filled in
    drawProgress();
    if (i >= chars.length) return finish();
    pad = createPad($("#pad-area"), {
      char: chars[i], strokes: strokesList[i], mode: "memory",
      onStroke: (r) => { $("#pad-msg").textContent = r.message || ""; },
      onDone: (r) => { totalMistakes += r.mistakes; totalGiven += r.given; i++; setTimeout(nextChar, 450); },
    });
  };
  $("#hint").addEventListener("click", () => { totalMistakes += 1; pad?.hint(); });
  $("#giveup").addEventListener("click", () => pad?.reveal());
  nextChar();
}

// ---------------------------------------------------------------- learning a new item
async function showLearn(it, { inSession = false } = {}) {
  const header = inSession ? sessionHeader("New") : `<header class="sess-head"><button class="icon-btn" id="back" aria-label="Back">‹</button><div class="sess-label">${it.type === "vocab" ? "Word" : it.type === "kanji" ? "Kanji" : it.script}</div><div></div></header>`;
  const learned = store.isLearned(it.id);
  let body = "";
  if (it.type === "kana") {
    body = `<div class="learn-top"><div class="jp huge">${esc(it.char)}</div><div class="romaji">${esc(it.romaji)} <button class="say-btn say" data-say="${esc(it.char)}">🔊</button></div>
      <p class="muted">${it.script === "hiragana" ? "Hiragana" : "Katakana"} · ${it.kind === "combo" ? "combination" : it.kind === "dakuten" ? "with ゛ or ゜ marks" : "basic"}</p></div>`;
  } else if (it.type === "kanji") {
    body = `<div class="learn-top"><div class="jp huge">${esc(it.char)}</div><p class="muted">${it.strokes} strokes · lesson ${it.lesson}</p></div>${kanjiFacts(it)}`;
  } else {
    body = `<div class="learn-top"><div class="jp large">${ruby(wordRuby(it.word, it.reading), { force: "always" })}</div>
      ${it.pos?.length ? `<p class="muted">${esc(it.pos.join(", "))}</p>` : ""}</div>${vocabFacts(it, { full: true })}`;
  }
  const chars = writable(it.type === "vocab" ? it.word : it.char);
  const strokesList = await Promise.all(chars.map((c) => strokesOf(c)));
  const writeIdx = chars.map((c, i) => (strokesList[i] ? i : -1)).filter((i) => i >= 0);
  app.innerHTML = `${header}<main class="page learn-page">${body}
    ${writeIdx.length && !(it.type === "kana" && it.kind === "combo") ? `<section class="practice">
      <h3>Stroke order <small class="muted">(tap to replay)</small></h3>
      <div class="order-row">${writeIdx.map((i) => `<div class="order-box" data-i="${i}"></div>`).join("")}</div>
      <h3>Practise writing</h3>
      <div class="seg-row"><button class="seg on" data-mode="trace">1 · Trace</button><button class="seg" data-mode="guide">2 · With hints</button><button class="seg" data-mode="memory">3 · From memory</button></div>
      ${writeIdx.length > 1 ? `<div class="seg-row" id="charpick">${writeIdx.map((i, k) => `<button class="seg small ${k === 0 ? "on" : ""}" data-c="${i}"><span class="jp">${esc(chars[i])}</span></button>`).join("")}</div>` : ""}
      <div id="pad-area" class="pad-area"></div><p id="pad-msg" class="pad-msg"></p>
    </section>` : ""}
    <div class="learn-actions">${inSession ? `<button class="btn primary big" id="got">Got it · next →</button>`
      : learned ? `<span class="muted">✓ In your reviews (${itemStrength(it)})</span>` : `<button class="btn primary big" id="addnow">＋ Add to my reviews</button>`}</div>
  </main>`;
  if (inSession) bindQuit(); else $("#back")?.addEventListener("click", () => history.back());
  bindSay();
  if (store.settings.autoplay) say(it.type === "vocab" ? it.reading || it.word : it.char);
  $$(".order-box").forEach((b) => strokeOrderSvg(b, strokesList[Number(b.dataset.i)]));
  let mode = "trace", ci = writeIdx[0];
  const makePad = () => {
    if (ci === undefined) return;
    createPad($("#pad-area"), {
      char: chars[ci], strokes: strokesList[ci], mode,
      onStroke: (r) => { $("#pad-msg").textContent = r.message || (r.ok ? `Stroke ${r.index}/${r.total} ✓` : ""); },
      onDone: (r) => {
        $("#pad-msg").innerHTML = r.mistakes ? `Done with ${r.mistakes} mistake${r.mistakes > 1 ? "s" : ""}. <button class="linklike" id="again">Try again</button>` : `🎉 Perfect! <button class="linklike" id="again">Again</button>${mode !== "memory" ? ` · <button class="linklike" id="harder">Next level →</button>` : ""}`;
        $("#again")?.addEventListener("click", makePad);
        $("#harder")?.addEventListener("click", () => { mode = mode === "trace" ? "guide" : "memory"; $$("[data-mode]").forEach((x) => x.classList.toggle("on", x.dataset.mode === mode)); makePad(); });
      },
    });
    $("#pad-msg").textContent = mode === "trace" ? "Trace the grey strokes in order. Start at the red dot." : mode === "guide" ? "Write it. A hint appears if you get stuck." : "Write it from memory.";
  };
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; $$("[data-mode]").forEach((x) => x.classList.toggle("on", x === b)); makePad(); }));
  $$("[data-c]").forEach((b) => b.addEventListener("click", () => { ci = Number(b.dataset.c); $$("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); makePad(); }));
  makePad();
  $("#got")?.addEventListener("click", () => { learnItem(it); session.learned += 1; cardKinds(it).forEach((k) => session.ids.add(`${it.id}:${k}`)); nextInSession(); });
  $("#addnow")?.addEventListener("click", () => { learnItem(it); toast("Added. It will come up in your reviews."); render(); });
}

// ---------------------------------------------------------------- browse
const DOT = { new: "", learning: "s-learning", known: "s-known", mastered: "s-mastered" };

routes.learn = (kind, sub) => {
  if (kind === "kana") return kanaChart(sub || "hiragana");
  if (kind === "kanji") return kanjiList();
  if (kind === "vocab") return vocabList(sub);
  const card = (href, icon, title, desc, list) => {
    const l = list.filter((i) => store.isLearned(i.id)).length;
    return `<a class="hub-card" href="${href}"><span class="hub-icon jp">${icon}</span><span><b>${title}</b><small>${desc}</small></span><span class="prog-num">${l}/${list.length}</span></a>`;
  };
  shell(`<h1>Learn</h1>
    <p class="muted">Study in this order: hiragana → katakana → kanji and words. Your daily session already follows it; open a set here to browse it or learn ahead.</p>
    <div class="hub">
      ${card("#/learn/kana/hiragana", "あ", "Hiragana", "The basic alphabet: 46 letters + marks + combinations", ITEMS.kana.filter((k) => k.script === "hiragana"))}
      ${card("#/learn/kana/katakana", "ア", "Katakana", "Used for foreign words and names", ITEMS.kana.filter((k) => k.script === "katakana"))}
      ${card("#/learn/kanji", "日", "Kanji · JLPT N5", "The 79 kanji for N5, 5 per lesson", ITEMS.kanji)}
      ${card("#/learn/vocab", "語", "Words · JLPT N5", "717 words, each with an example sentence", ITEMS.vocab)}
      ${card("#/mybook", "📘", "My book", "Words from your Minna no Nihongo lessons", ITEMS.mine)}
    </div>
    <p class="legend"><span class="dot s-learning"></span>learning <span class="dot s-known"></span>known <span class="dot s-mastered"></span>mastered</p>`, "learn");
};

function kanaChart(script) {
  const list = ITEMS.kana.filter((k) => k.script === script);
  const group = (kind, title) => `<h3>${title}</h3><div class="kana-grid ${kind}">${list.filter((k) => k.kind === kind).map((k) =>
    `<a class="kana-cell ${DOT[itemStrength(k)]}" href="#/item/${encodeURIComponent(k.id)}"><span class="jp">${k.char}</span><small>${k.romaji}</small></a>`).join("")}</div>`;
  shell(`<div class="title-row"><h1>${script === "hiragana" ? "Hiragana ひらがな" : "Katakana カタカナ"}</h1>
      <div class="seg-row"><a class="seg ${script === "hiragana" ? "on" : ""}" href="#/learn/kana/hiragana">あ</a><a class="seg ${script === "katakana" ? "on" : ""}" href="#/learn/kana/katakana">ア</a></div></div>
    ${group("basic", "Basic")}${group("dakuten", "With ゛ and ゜ (dakuten)")}${group("combo", "Combinations")}`, "learn");
}

function kanjiList() {
  const lessons = [...new Set(ITEMS.kanji.map((k) => k.lesson))];
  shell(`<h1>Kanji · JLPT N5</h1>${lessons.map((l) => `<h3>Lesson ${l}</h3><div class="kanji-grid">${ITEMS.kanji.filter((k) => k.lesson === l).map((k) =>
    `<a class="kanji-cell ${DOT[itemStrength(k)]}" href="#/item/${encodeURIComponent(k.id)}"><span class="jp">${k.char}</span><small>${esc(k.meanings[0])}</small></a>`).join("")}</div>`).join("")}`, "learn");
}

function vocabList(q = "") {
  const query = q.trim().toLowerCase();
  const list = ITEMS.vocab.filter((v) => !query || v.word.includes(q) || v.reading.includes(q) || v.meaning.toLowerCase().includes(query));
  const lessons = [...new Set(list.map((v) => v.lesson))];
  shell(`<h1>Words · JLPT N5</h1>
    <input type="search" class="search" id="vq" placeholder="Search: 食べる, たべる or eat" value="${esc(q)}">
    ${lessons.slice(0, query ? 999 : 80).map((l) => `<h3>${query ? "" : `Lesson ${l}`}</h3><div class="word-list">${list.filter((v) => v.lesson === l).map((v) =>
      `<a class="word-row ${DOT[itemStrength(v)]}" href="#/item/${encodeURIComponent(v.id)}"><span class="jp">${esc(v.word)}</span><span class="jp muted">${v.word !== v.reading ? esc(v.reading) : ""}</span><span class="wm">${esc(v.meaning)}</span></a>`).join("")}</div>`).join("")}`, "learn");
  $("#vq").addEventListener("change", (e) => go(`#/learn/vocab/${encodeURIComponent(e.target.value)}`));
}

routes.item = (id) => { const it = item(id); if (!it) return go("#/learn"); showLearn(it); };

// ---------------------------------------------------------------- free writing
routes.write = async (text) => {
  shell(`<h1>Writing practice</h1>
    <p class="muted">Practise any kana, kanji or word with your Apple Pencil.</p>
    <div class="write-input"><input id="wtext" class="search jp" placeholder="Type or paste, e.g. 日本 or ありがとう" value="${esc(text || "")}"><button class="btn primary" id="wgo">Practise</button></div>
    <div class="quick">${["あいうえお", "かきくけこ", "日月火水木", "一二三四五", "日本語", "先生", "学生"].map((s) => `<a class="chip jp" href="#/write/${encodeURIComponent(s)}">${s}</a>`).join("")}</div>
    <div id="wbox"></div>`, "write");
  $("#wgo").addEventListener("click", () => go(`#/write/${encodeURIComponent($("#wtext").value.trim())}`));
  $("#wtext").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#wgo").click(); });
  if (!text) return;
  const chars = writable(text);
  const strokesList = await Promise.all(chars.map((c) => strokesOf(c)));
  const ok = chars.map((c, i) => (strokesList[i] ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) { $("#wbox").innerHTML = `<p class="muted">No stroke data for these characters.</p>`; return; }
  let ci = ok[0], mode = "trace";
  $("#wbox").innerHTML = `<div class="seg-row">${ok.map((i, k) => `<button class="seg small ${k === 0 ? "on" : ""}" data-c="${i}"><span class="jp">${esc(chars[i])}</span></button>`).join("")}</div>
    <div class="seg-row"><button class="seg on" data-mode="trace">Trace</button><button class="seg" data-mode="guide">Hints</button><button class="seg" data-mode="memory">Memory</button><button class="seg" data-mode="order">▶ Stroke order</button></div>
    <div id="pad-area" class="pad-area"></div><p id="pad-msg" class="pad-msg"></p>`;
  const draw = () => {
    if (mode === "order") { strokeOrderSvg($("#pad-area"), strokesList[ci]); $("#pad-msg").textContent = "Tap to replay."; return; }
    createPad($("#pad-area"), {
      char: chars[ci], strokes: strokesList[ci], mode,
      onStroke: (r) => { $("#pad-msg").textContent = r.message || (r.ok ? `Stroke ${r.index}/${r.total} ✓` : ""); },
      onDone: (r) => {
        $("#pad-msg").innerHTML = `${r.mistakes ? `${r.mistakes} mistake${r.mistakes > 1 ? "s" : ""}` : "🎉 Perfect!"} <button class="linklike" id="again">Again</button>`;
        $("#again").addEventListener("click", draw);
        const nextI = ok[ok.indexOf(ci) + 1];
        if (nextI !== undefined) setTimeout(() => { ci = nextI; $$("[data-c]").forEach((x) => x.classList.toggle("on", Number(x.dataset.c) === ci)); draw(); }, 900);
      },
    });
  };
  $$("[data-c]").forEach((b) => b.addEventListener("click", () => { ci = Number(b.dataset.c); $$("[data-c]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; $$("[data-mode]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  draw();
};

// ---------------------------------------------------------------- My book
let lastLesson = localStorage.getItem("nihongo-last-lesson") || "Minna L1";
routes.mybook = async () => {
  const groups = {};
  for (const m of ITEMS.mine) (groups[m.lesson || "Other"] ||= []).push(m);
  shell(`<h1>My book</h1>
    <p class="muted">Add the words from the lesson you are studying (e.g. Minna no Nihongo lesson 3). Type the word in kanji or kana; the app finds the reading, meaning and an example sentence.</p>
    <section class="panel">
      <div class="form-row"><label>Lesson <input id="mlesson" value="${esc(lastLesson)}" placeholder="Minna L1"></label></div>
      <div class="write-input"><input id="mq" class="search jp" placeholder="e.g. 先生, せんせい, がっこう" autocomplete="off" autocapitalize="off"><button class="btn primary" id="mfind">Find</button></div>
      <div id="mres"></div>
    </section>
    ${Object.keys(groups).length ? Object.entries(groups).map(([l, list]) => `<h3>${esc(l)} <small class="muted">${list.length} words</small></h3><div class="word-list">${list.map((v) =>
      `<div class="word-row ${DOT[itemStrength(v)]}"><a href="#/item/${encodeURIComponent(v.id)}" class="jp">${esc(v.word)}</a><span class="jp muted">${v.word !== v.reading ? esc(v.reading) : ""}</span><span class="wm">${esc(v.meaning)}</span><button class="icon-btn small" data-del="${esc(v.id.slice(3))}" aria-label="Remove">🗑</button></div>`).join("")}</div>`).join("")
      : `<p class="muted center">No words yet.</p>`}`, "mybook");
  const find = async () => {
    const q = $("#mq").value.trim();
    if (!q) return;
    $("#mres").innerHTML = `<p class="muted">Searching…</p>`;
    const dict = await loadDict();
    const hira = toHira(q);
    let hits = dict.filter((e) => e.k.includes(q) || e.r.includes(hira));
    if (!hits.length) hits = dict.filter((e) => e.k.some((k) => k.startsWith(q)) || e.r.some((r) => r.startsWith(hira))).slice(0, 8);
    const n5 = D.vocab.filter((v) => v.word === q || v.reading === hira);
    // N5 words first, then the most common words
    const isN5 = (e) => n5.some((v) => e.k.includes(v.word) || (!e.k.length && e.r.includes(v.reading)));
    hits = hits.sort((a, b) => (isN5(b) - isN5(a)) || ((a.f ?? 99) - (b.f ?? 99)));
    $("#mres").innerHTML = (hits.length ? hits.slice(0, 8).map((e, i) => {
      const w = e.uk ? e.r[0] : e.k[0] || e.r[0];
      return `<div class="hit"><div><span class="jp hit-w">${esc(e.k[0] || e.r[0])}</span> <span class="jp muted">${esc(e.r.join("・"))}</span><div class="wm">${esc(e.m)}</div></div>
        <button class="btn small primary" data-add="${i}">＋ Add</button></div>`;
    }).join("") : `<p class="muted">Not found in the dictionary.</p>`) + manualForm(q);
    $$("[data-add]").forEach((b) => b.addEventListener("click", () => {
      const e = hits[Number(b.dataset.add)];
      const word = e.k[0] || e.r[0], reading = e.r[0];
      const n = n5.find((v) => v.word === word);
      addMine({ word, reading, meaning: e.m.split("; ")[0], examples: n?.examples || (e.ex ? [e.ex] : []) });
    }));
    $("#madd")?.addEventListener("click", () => {
      const word = $("#mw").value.trim(), reading = $("#mr").value.trim(), meaning = $("#mm").value.trim();
      if (!word || !meaning) return toast("Enter at least the word and its meaning.");
      addMine({ word, reading: reading || word, meaning, examples: [] });
    });
  };
  const addMine = (w) => {
    lastLesson = $("#mlesson").value.trim() || "My lesson";
    localStorage.setItem("nihongo-last-lesson", lastLesson);
    if (store.state.mybook.some((m) => m.word === w.word && m.reading === w.reading && m.lesson === lastLesson)) return toast("Already in this lesson.");
    store.addMyBook({ id: Date.now().toString(36), lesson: lastLesson, ...w, added: Date.now() });
    refreshItems();
    toast(`Added ${w.word} to ${lastLesson}`);
    routes.mybook();
  };
  $("#mfind").addEventListener("click", find);
  $("#mq").addEventListener("keydown", (e) => { if (e.key === "Enter") find(); });
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Remove this word from My book?")) return;
    const id = b.dataset.del;
    store.removeMyBook(id);
    refreshItems(); routes.mybook();
  }));
};
function manualForm(q) {
  return `<details class="manual"><summary>Add it yourself</summary>
    <div class="form-grid"><label>Word <input id="mw" class="jp" value="${esc(q)}"></label><label>Reading (kana) <input id="mr" class="jp"></label><label>Meaning <input id="mm"></label></div>
    <button class="btn" id="madd">Add</button></details>`;
}

// ---------------------------------------------------------------- settings
routes.settings = () => {
  const s = store.settings;
  const num = (k, label, min, max) => `<label class="set-row"><span>${label}</span><input type="number" min="${min}" max="${max}" data-num="${k}" value="${s[k]}"></label>`;
  const sel = (k, label, opts) => `<label class="set-row"><span>${label}</span><select data-sel="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select></label>`;
  shell(`<h1>Settings</h1>
    <section class="panel"><h3>Daily plan</h3>
      ${num("minutes", "Daily goal (minutes)", 5, 120)}
      ${num("newKana", "New kana per day", 0, 40)}
      ${num("newKanji", "New kanji per day", 0, 20)}
      ${num("newVocab", "New words per day", 0, 40)}
      <p class="muted small">For 20 minutes a day: about 10 kana, or 4 kanji + 8 words, plus reviews. Lower these if reviews start taking too long.</p></section>
    <section class="panel"><h3>Writing & reading</h3>
      ${sel("pencilOnly", "Apple Pencil only", [["auto", "Automatic (ignore fingers after the Pencil is used)"], ["on", "Pencil only"], ["off", "Pencil and fingers"]])}
      ${sel("strictness", "Stroke checking", [["easy", "Easy"], ["normal", "Normal"], ["strict", "Strict"]])}
      ${sel("furigana", "Furigana (reading above kanji)", [["auto", "Only for kanji I don't know yet"], ["always", "Always"], ["never", "Never"]])}
      ${sel("voiceRate", "Voice speed", [[0.7, "Slow"], [0.9, "Normal"], [1.1, "Fast"]])}
      ${sel("autoplay", "Play audio automatically", [[true, "Yes"], [false, "No"]])}
    </section>
    <section class="panel"><h3>Sync & backup</h3><div id="sync-box">${sync.panelHtml()}</div>
      <div class="btn-row"><button class="btn" id="export">⬇ Download backup</button><label class="btn">⬆ Restore backup<input type="file" id="import" accept="application/json" hidden></label></div></section>
    <section class="panel"><h3>About</h3><p class="small">Content: JLPT N5 lists by Jonathan Waller (CC BY), kanji and dictionary data from KANJIDIC2 and JMdict by EDRDG (CC BY-SA), stroke order from KanjiVG by Ulrich Apel (CC BY-SA), example sentences from the Tatoeba project (CC BY), furigana generated with kuromoji. Some beginner sentences were written for this app. <a href="#/credits">Full credits</a></p></section>`, "settings");
  $$("[data-num]").forEach((i) => i.addEventListener("change", () => store.setSetting(i.dataset.num, Math.max(Number(i.min), Math.min(Number(i.max), Number(i.value) || 0)))));
  $$("[data-sel]").forEach((i) => i.addEventListener("change", () => store.setSetting(i.dataset.sel, i.value === "true" ? true : i.value === "false" ? false : isNaN(Number(i.value)) ? i.value : Number(i.value))));
  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.state)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `nihongo-backup-${today()}.json`; a.click();
  });
  $("#import").addEventListener("change", async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!data.cards || !data.settings) throw new Error("Not a backup file");
      if (!confirm("Replace your progress on this device with this backup?")) return;
      store.replace(data); refreshItems(); toast("Backup restored."); render();
    } catch (err) { toast(`Could not restore: ${err.message}`); }
  });
  sync.bindPanel($("#sync-box"), () => { refreshItems(); });
};

routes.credits = () => {
  shell(`<h1>Credits</h1><div class="panel small">
    <p><b>Stroke order</b>: <a href="https://kanjivg.tagaini.net/">KanjiVG</a> © Ulrich Apel, CC BY-SA 3.0.</p>
    <p><b>Kanji information and dictionary</b>: <a href="https://www.edrdg.org/">KANJIDIC2 and JMdict</a> © Electronic Dictionary Research and Development Group, CC BY-SA 4.0, via <a href="https://github.com/davidluzgouveia/kanji-data">kanji-data</a> (MIT).</p>
    <p><b>Example sentences</b>: <a href="https://tatoeba.org/">Tatoeba</a>, CC BY 2.0 FR (included in JMdict).</p>
    <p><b>JLPT N5 lists</b>: Jonathan Waller, <a href="http://www.tanos.co.uk/jlpt/">tanos.co.uk</a>, CC BY, via <a href="https://github.com/elzup/jlpt-word-list">jlpt-word-list</a> (MIT).</p>
    <p><b>Furigana</b>: generated with <a href="https://github.com/takuyaa/kuromoji.js">kuromoji.js</a> (Apache 2.0); readings may occasionally be wrong.</p>
    <p>JLPT levels are unofficial estimates: the JLPT has not published official lists since 2010. Minna no Nihongo content is not included; add your lesson words in My book.</p></div>`, "settings");
};

// ---------------------------------------------------------------- boot
(async function boot() {
  app.innerHTML = `<main class="page center"><div class="jp huge">日本語</div><p class="muted">Loading…</p></main>`;
  try { await loadCore(); }
  catch (e) { app.innerHTML = `<main class="page center"><p>Could not load the lessons. Check your connection and reload.</p><p class="muted">${esc(e.message)}</p></main>`; return; }
  refreshItems();
  store.onChange(() => { if (store.state.mybook.length !== ITEMS.mine.length) refreshItems(); });
  await sync.init({ onRemote: () => { refreshItems(); if (!session.active) render(); } });
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  loadKanjiInfo().catch(() => {});
})();
