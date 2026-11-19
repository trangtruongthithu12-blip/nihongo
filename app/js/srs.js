// Spaced repetition (SM-2 style with learning steps).
// A card comes back just before you would forget it: soon at first, then at growing intervals.

const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
const LEARN_STEPS = [1 * MIN, 10 * MIN];   // new cards: again after 1 min, then 10 min, then 1 day
const RELEARN_STEP = 10 * MIN;

export const GRADES = { again: 0, hard: 1, good: 2, easy: 3 };

export function newCard(now = Date.now()) {
  return { state: "new", due: now, interval: 0, ease: 2.5, step: 0, reps: 0, lapses: 0 };
}

// Returns an updated copy of the card after answering with `grade`.
export function review(card, grade, now = Date.now()) {
  const c = { ...card, reps: card.reps + 1, last: now };
  if (c.state === "new" || c.state === "learning" || c.state === "relearning") {
    if (grade === GRADES.again) {
      c.step = 0; c.state = c.state === "relearning" ? "relearning" : "learning";
      c.due = now + (c.state === "relearning" ? RELEARN_STEP : LEARN_STEPS[0]);
      return c;
    }
    if (grade === GRADES.easy) return graduate(c, c.state === "relearning" ? Math.max(1, c.interval) : 4, now);
    const steps = c.state === "relearning" ? [RELEARN_STEP] : LEARN_STEPS;
    const next = grade === GRADES.hard ? c.step : c.step + 1;
    if (next >= steps.length) return graduate(c, c.state === "relearning" ? Math.max(1, c.interval) : 1, now);
    c.step = next; c.state = c.state === "new" ? "learning" : c.state;
    c.due = now + steps[next];
    return c;
  }
  // review state
  if (grade === GRADES.again) {
    c.lapses += 1; c.state = "relearning"; c.step = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.interval = Math.max(1, Math.round(c.interval * 0.5));
    c.due = now + RELEARN_STEP;
    return c;
  }
  let ivl;
  if (grade === GRADES.hard) { ivl = c.interval * 1.2; c.ease = Math.max(1.3, c.ease - 0.15); }
  else if (grade === GRADES.good) ivl = c.interval * c.ease;
  else { ivl = c.interval * c.ease * 1.3; c.ease += 0.15; }
  ivl = Math.max(c.interval + 1, Math.round(ivl * (0.95 + Math.random() * 0.1))); // small fuzz
  c.interval = Math.min(ivl, 365 * 3);
  c.due = startOfDay(now) + c.interval * DAY + 4 * 60 * MIN; // due from 4 am that day
  return c;
}

function graduate(c, days, now) {
  c.state = "review"; c.step = 0; c.interval = days;
  c.due = startOfDay(now) + days * DAY + 4 * 60 * MIN;
  return c;
}

export function startOfDay(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Human text for the next interval, shown on the grade buttons.
export function preview(card, grade, now = Date.now()) {
  const ms = review(card, grade, now).due - now;
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} h`;
  const d = Math.round(ms / DAY);
  return d < 31 ? `${d} d` : d < 365 ? `${Math.round(d / 30)} mo` : `${(d / 365).toFixed(1)} y`;
}

// "Mastery" label for an item from its cards.
export function strength(cards) {
  const list = cards.filter(Boolean);
  if (!list.length) return "new";
  const min = Math.min(...list.map((c) => (c.state === "review" ? c.interval : 0)));
  if (min >= 21) return "mastered";
  if (min >= 3) return "known";
  return "learning";
}
