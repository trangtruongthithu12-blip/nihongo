// Syncs progress between devices through Supabase (one row per user).
// Sign-in uses a 6-digit code sent by email (works inside the Home Screen app on iPhone/iPad).
// Progress from different devices is merged card by card, so nothing is lost.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { store } from "./store.js";

const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
let client = null, user = null, onRemote = () => {}, pushTimer = null, status = "", busy = false;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Merge two progress states (local and remote).
export function merge(a, b) {
  const out = { ...a, cards: { ...a.cards }, learned: { ...a.learned }, days: { ...a.days } };
  for (const [id, c] of Object.entries(b.cards || {})) {
    const mine = out.cards[id];
    if (!mine || (c.last || 0) > (mine.last || 0) || (!mine.last && c.reps > mine.reps)) out.cards[id] = c;
  }
  for (const [id, t] of Object.entries(b.learned || {})) out.learned[id] = Math.min(out.learned[id] || Infinity, t);
  for (const [d, v] of Object.entries(b.days || {})) {
    const m = out.days[d] || {};
    out.days[d] = { reviews: Math.max(m.reviews || 0, v.reviews || 0), learned: Math.max(m.learned || 0, v.learned || 0), seconds: Math.max(m.seconds || 0, v.seconds || 0) };
  }
  const ids = new Set((a.mybook || []).map((m) => m.id));
  out.mybook = [...(a.mybook || []), ...(b.mybook || []).filter((m) => !ids.has(m.id))];
  const removed = new Set([...(a.removed || []), ...(b.removed || [])]);
  out.removed = [...removed];
  out.mybook = out.mybook.filter((m) => !removed.has(m.id));
  out.settings = (b.settingsAt || 0) > (a.settingsAt || 0) ? b.settings : a.settings;
  out.settingsAt = Math.max(a.settingsAt || 0, b.settingsAt || 0);
  return out;
}

async function getClient() {
  if (!enabled) return null;
  if (!client) {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  return client;
}

async function pull() {
  const c = await getClient();
  if (!c || !user) return;
  const { data, error } = await c.from("progress").select("data").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (data?.data) {
    store.replace(merge(store.state, data.data));
    onRemote();
  }
}

async function pushNow() {
  const c = await getClient();
  if (!c || !user || !navigator.onLine) return;
  busy = true;
  try {
    // merge first, so a change made on another device isn't overwritten
    const { data } = await c.from("progress").select("data").eq("user_id", user.id).maybeSingle();
    const merged = data?.data ? merge(store.state, data.data) : store.state;
    if (data?.data) store.replace(merged);
    const { error } = await c.from("progress").upsert({ user_id: user.id, data: merged, updated_at: new Date().toISOString() });
    if (error) throw error;
    status = `Synced ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (e) {
    status = `Sync failed: ${e.message}`;
  } finally { busy = false; updatePanel(); }
}

let panelEl = null, bindCb = null;
function updatePanel() { if (panelEl && document.body.contains(panelEl)) { panelEl.innerHTML = sync.panelHtml(); sync.bindPanel(panelEl, bindCb); } }

export const sync = {
  async init(opts) {
    onRemote = opts.onRemote || onRemote;
    if (!enabled) return;
    try {
      const c = await getClient();
      const { data } = await c.auth.getSession();
      user = data.session?.user || null;
      c.auth.onAuthStateChange((_e, s) => { user = s?.user || null; updatePanel(); });
      if (user && navigator.onLine) await pull();
    } catch (e) { status = `Offline: ${e.message}`; }
    store.onChange(() => { if (user) { clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 8000); } });
    window.addEventListener("online", () => { if (user) pushNow(); });
    document.addEventListener("visibilitychange", () => {
      if (!user) return;
      if (document.visibilityState === "hidden") pushNow(); else pull().catch(() => {});
    });
  },
  push() { if (user) pushNow(); },
  panelHtml() {
    if (!enabled) return `<p class="muted small">Sync is not set up yet. Your progress is saved on this device. Use "Download backup" to move it to another device.</p>`;
    if (!user) return `<p class="small">Sign in to sync your progress between iPad, iPhone and computer.</p>
      <div class="write-input"><input id="sync-email" type="email" placeholder="you@example.com" autocomplete="email"><button class="btn primary" id="sync-send">Send code</button></div>
      <div class="write-input" id="code-row" hidden><input id="sync-code" inputmode="numeric" placeholder="6-digit code" maxlength="10"><button class="btn primary" id="sync-verify">Sign in</button></div>
      <p class="muted small" id="sync-msg">${esc(status)}</p>`;
    return `<p class="small">✅ Signed in as <b>${esc(user.email)}</b>. Progress syncs automatically.</p>
      <p class="muted small">${esc(busy ? "Syncing…" : status)}</p>
      <div class="btn-row"><button class="btn" id="sync-now">↻ Sync now</button><button class="btn ghost" id="sync-out">Sign out</button></div>`;
  },
  bindPanel(el, cb) {
    panelEl = el; bindCb = cb;
    const msg = (t) => { const m = el.querySelector("#sync-msg"); if (m) m.textContent = t; };
    el.querySelector("#sync-send")?.addEventListener("click", async () => {
      const email = el.querySelector("#sync-email").value.trim();
      if (!email) return msg("Enter your email first.");
      msg("Sending…");
      const c = await getClient();
      const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) return msg(error.message);
      el.querySelector("#code-row").hidden = false;
      msg("Check your email and type the code here.");
    });
    el.querySelector("#sync-verify")?.addEventListener("click", async () => {
      const email = el.querySelector("#sync-email").value.trim(), token = el.querySelector("#sync-code").value.trim();
      const c = await getClient();
      const { data, error } = await c.auth.verifyOtp({ email, token, type: "email" });
      if (error) return msg(error.message);
      user = data.user;
      await pull().catch(() => {});
      await pushNow();
      cb?.();
    });
    el.querySelector("#sync-now")?.addEventListener("click", async () => { await pull().catch((e) => { status = e.message; }); await pushNow(); cb?.(); });
    el.querySelector("#sync-out")?.addEventListener("click", async () => { const c = await getClient(); await c.auth.signOut(); user = null; updatePanel(); });
  },
};
