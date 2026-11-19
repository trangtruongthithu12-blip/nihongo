// Handwriting pad for Apple Pencil (or finger/mouse) with stroke-by-stroke checking.
// Reference strokes come from KanjiVG (109 x 109 coordinate box).
import { store } from "./store.js";

const NS = "http://www.w3.org/2000/svg";
const BOX = 109;
const N = 32; // points compared per stroke
let pencilSeen = false;

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// Points along an SVG path, evenly spaced.
function samplePath(pathEl, n = N) {
  const len = pathEl.getTotalLength();
  return Array.from({ length: n }, (_, i) => { const p = pathEl.getPointAtLength((len * i) / (n - 1)); return [p.x, p.y]; });
}
function resample(pts, n = N) {
  if (pts.length < 2) return Array.from({ length: n }, () => pts[0] || [0, 0]);
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = d.at(-1) || 1, out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = (total * i) / (n - 1);
    while (j < d.length - 2 && d[j + 1] < t) j++;
    const seg = d[j + 1] - d[j] || 1, f = (t - d[j]) / seg;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]);
  }
  return out;
}
const length = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const meanDist = (a, b) => a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / a.length;

const LIMITS = {
  easy: { mean: 19, start: 28 },
  normal: { mean: 15, start: 22 },
  strict: { mean: 11, start: 16 },
};

// Compare a drawn stroke with a reference stroke.
function compare(user, ref) {
  const u = resample(user), r = ref.pts;
  const lim = LIMITS[store.settings.strictness] || LIMITS.normal;
  const short = ref.len < 14; // dots and tiny ticks: be lenient on shape
  const mean = meanDist(u, r);
  const rev = meanDist(u, [...r].reverse());
  const startD = Math.hypot(u[0][0] - r[0][0], u[0][1] - r[0][1]);
  const ratio = length(user) / (ref.len || 1);
  const ok = mean < lim.mean * (short ? 1.4 : 1) && startD < lim.start * (short ? 1.4 : 1) && (short || (ratio > 0.45 && ratio < 2.2));
  const reversed = !ok && rev < lim.mean && rev < mean * 0.7;
  return { ok, reversed, mean };
}

/**
 * Creates a writing pad for one character.
 * mode: "trace" (grey model visible) | "guide" (hints after a mistake) | "memory" (blank)
 * onDone({ mistakes, given }) is called when all strokes are written.
 */
export function createPad(container, { char, strokes, mode = "guide", onDone, onStroke, size }) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "pad";
  if (size) wrap.style.width = wrap.style.height = `${size}px`;
  container.appendChild(wrap);
  const svg = el("svg", { viewBox: `0 0 ${BOX} ${BOX}`, class: "pad-svg" }, wrap);
  // grid
  el("rect", { x: 1, y: 1, width: BOX - 2, height: BOX - 2, class: "pad-frame", rx: 4 }, svg);
  el("line", { x1: BOX / 2, y1: 2, x2: BOX / 2, y2: BOX - 2, class: "pad-grid" }, svg);
  el("line", { x1: 2, y1: BOX / 2, x2: BOX - 2, y2: BOX / 2, class: "pad-grid" }, svg);
  const gModel = el("g", { class: "pad-model" }, svg);
  const gHint = el("g", { class: "pad-hint" }, svg);
  const gDone = el("g", { class: "pad-done" }, svg);
  const gInk = el("g", { class: "pad-ink" }, svg);

  const refs = strokes.map((d) => {
    const p = el("path", { d }, gModel);
    return { d, el: p, pts: samplePath(p), len: p.getTotalLength() };
  });
  if (mode !== "trace") gModel.style.display = "none";

  let idx = 0, mistakes = 0, given = 0, failsHere = 0, finished = false;
  let cur = null, curLine = null, activePointer = null;

  const toBox = (e) => {
    const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * BOX, ((e.clientY - r.top) / r.height) * BOX];
  };
  const fingerBlocked = (e) => {
    const s = store.settings.pencilOnly;
    if (e.pointerType === "pen") pencilSeen = true;
    if (e.pointerType !== "touch") return false;
    return s === "on" || (s === "auto" && pencilSeen);
  };

  function showHint() {
    gHint.innerHTML = "";
    if (idx >= refs.length) return;
    const r = refs[idx];
    el("path", { d: r.d, class: "hint-stroke" }, gHint);
    el("circle", { cx: r.pts[0][0], cy: r.pts[0][1], r: 3.2, class: "hint-start" }, gHint);
  }
  function flash(d, cls) {
    const p = el("path", { d, class: cls }, gHint);
    setTimeout(() => p.remove(), 900);
  }
  function accept(given_) {
    const r = refs[idx];
    el("path", { d: r.d, class: given_ ? "done-stroke given" : "done-stroke" }, gDone);
    idx += 1; failsHere = 0; gHint.innerHTML = "";
    onStroke?.({ index: idx, total: refs.length, ok: !given_ });
    if (idx >= refs.length) { finished = true; wrap.classList.add("complete"); onDone?.({ mistakes, given }); }
    else if (mode === "trace") showHint();
  }

  wrap.addEventListener("pointerdown", (e) => {
    if (finished || fingerBlocked(e) || activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId;
    wrap.setPointerCapture(e.pointerId);
    cur = [toBox(e)];
    curLine = el("polyline", { points: cur.map((p) => p.join(",")).join(" "), class: "ink" }, gInk);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (e.pointerId !== activePointer || !cur) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) cur.push(toBox(ev));
    curLine.setAttribute("points", cur.map((p) => p.join(",")).join(" "));
  });
  const up = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    const pts = cur; cur = null;
    curLine?.remove(); curLine = null;
    if (!pts || finished) return;
    if (pts.length < 2 || length(pts) < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]); // a tap = a dot
    const res = compare(pts, refs[idx]);
    if (res.ok) return accept(false);
    // Did they write a later stroke instead (wrong order)?
    const later = refs.slice(idx + 1).findIndex((r) => compare(pts, r).ok);
    mistakes += 1; failsHere += 1;
    wrap.classList.remove("shake"); void wrap.offsetWidth; wrap.classList.add("shake");
    const msg = later >= 0 ? `That's stroke ${idx + later + 2}. Write stroke ${idx + 1} first.`
      : res.reversed ? "Right place, wrong direction." : "Not quite. Try that stroke again.";
    onStroke?.({ index: idx, total: refs.length, ok: false, message: msg });
    flash(refs[idx].d, "wrong-stroke");
    if (failsHere >= 3) { given += 1; accept(true); }
    else if (mode !== "memory" || failsHere >= 2) showHint();
  };
  wrap.addEventListener("pointerup", up);
  wrap.addEventListener("pointercancel", (e) => { if (e.pointerId === activePointer) { activePointer = null; cur = null; curLine?.remove(); } });
  // Stop iOS from scrolling / zooming while writing.
  wrap.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
  wrap.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  if (mode === "trace") showHint();

  return {
    char,
    hint() { showHint(); },
    reset() { createPad(container, { char, strokes, mode, onDone, onStroke, size }); },
    reveal() { while (!finished) { given += 1; accept(true); } },
  };
}

// Animated stroke order (for learning screens).
export function strokeOrderSvg(container, strokes, { numbers = true, speed = 1 } = {}) {
  container.innerHTML = "";
  const svg = el("svg", { viewBox: `0 0 ${BOX} ${BOX}`, class: "order-svg" }, container);
  el("rect", { x: 1, y: 1, width: BOX - 2, height: BOX - 2, class: "pad-frame", rx: 4 }, svg);
  el("line", { x1: BOX / 2, y1: 2, x2: BOX / 2, y2: BOX - 2, class: "pad-grid" }, svg);
  el("line", { x1: 2, y1: BOX / 2, x2: BOX - 2, y2: BOX / 2, class: "pad-grid" }, svg);
  const ghost = el("g", { class: "pad-model" }, svg);
  const g = el("g", { class: "order-strokes" }, svg);
  const gn = el("g", { class: "order-nums" }, svg);
  const paths = strokes.map((d) => { el("path", { d }, ghost); return el("path", { d }, g); });
  const play = () => {
    let delay = 0;
    gn.innerHTML = "";
    paths.forEach((p, i) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      const dur = Math.max(250, len * 9) / speed;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: dur, delay, fill: "forwards", easing: "ease-in-out" });
      if (numbers) {
        const pt = p.getPointAtLength(0);
        setTimeout(() => { const t = el("text", { x: pt.x - 4, y: pt.y - 2, class: "order-num" }, gn); t.textContent = i + 1; }, delay);
      }
      delay += dur + 120 / speed;
    });
    return delay;
  };
  play();
  svg.addEventListener("click", play);
  return { play };
}
