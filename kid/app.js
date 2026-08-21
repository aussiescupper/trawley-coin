// ─── Trawley Coins — Kid app ─────────────────────────────────────────────────
import {
  createStore, submitRequest, fmtWhen, esc, toast, registerServiceWorker,
} from '../shared/store.js';

registerServiceWorker();

const $ = (sel) => document.querySelector(sel);

const COIN_SM = `<svg class="coin small" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="30" fill="#f5a623" stroke="#c77f0a" stroke-width="4"/>
  <text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-size="30" font-weight="800" fill="#8a5a06">T</text>
</svg>`;

let store;
try {
  store = await createStore();
} catch (e) {
  console.error('Trawley: could not start', e);
  $('#conn-gate').hidden = false;
  throw e;
}

// Surface failed saves (e.g. offline in live mode) instead of losing them silently
window.addEventListener('unhandledrejection', (e) => {
  toast((e.reason && e.reason.message) || "Something didn't save — try again");
});

// ── Family join gate (live mode only) ──
const joinGate = $('#join-gate');
if (store.needsSetup()) {
  joinGate.hidden = false;
  $('#join-btn').addEventListener('click', doJoin);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
}

async function doJoin() {
  const err = $('#join-err');
  const btn = $('#join-btn');
  err.textContent = '';
  btn.disabled = true;
  try {
    await store.joinFamily($('#join-code').value);
    joinGate.hidden = true;
    toast('Welcome to the family! 🎉');
  } catch (e) {
    err.textContent = e.message || 'Could not join — try again';
  } finally {
    btn.disabled = false;
  }
}

$('#mode-pill').textContent = store.mode === 'firebase' ? 'LIVE' : 'demo';
$('#mode-pill').classList.toggle('live', store.mode === 'firebase');

// In live mode the first snapshot takes a moment — show "Connecting…" until it lands
if (store.mode === 'firebase' && !store.needsSetup() && !store.getState()) {
  $('#loading-gate').hidden = false;
}

// ── Rendering ──
let shownBalance = null;
let balanceAnim = null;
let prevStatuses = null; // request id -> status, to spot fresh approvals

store.onChange(render);

function render(s) {
  $('#loading-gate').hidden = true;
  $('#hi').textContent = `Hi ${s.kidName}!`;
  $('#sub').textContent = s.familyName;

  animateBalance(s.balance);

  // Chore tiles — a chore you've already sent shows as "waiting"
  const pendingChoreIds = new Set(
    s.requests.filter((r) => r.status === 'pending' && r.choreId).map((r) => r.choreId)
  );
  $('#chores').innerHTML = s.chores.map((c) => {
    const waiting = pendingChoreIds.has(c.id);
    return `<button class="chore-tile ${waiting ? 'waiting' : ''}" data-chore="${c.id}" ${waiting ? 'disabled' : ''}>
      <span class="emoji">${esc(c.emoji || '⭐')}</span>
      <span class="name">${esc(c.name)}</span>
      ${waiting
        ? '<span class="waiting-chip">Sent! Waiting…</span>'
        : `<span class="worth coin-amount">${COIN_SM} ${c.coins}</span>`}
    </button>`;
  }).join('') || `<div class="card empty" style="grid-column:1/-1"><span class="big">🧹</span>No chores yet — ask your parent to add some!</div>`;

  // My messages
  const recent = s.requests.slice(0, 8);
  $('#requests').innerHTML = recent.map((r) => `
    <div class="row">
      <div class="grow">
        <div class="title">${esc(r.choreName)}</div>
        <div class="meta">${fmtWhen(r.createdAt)}</div>
      </div>
      ${r.status === 'approved' ? `<span class="coin-amount">+${r.awarded}&nbsp;${COIN_SM}</span>` : ''}
      <span class="status-chip ${r.status}">${
        r.status === 'pending' ? 'waiting' : r.status === 'approved' ? 'yes! ✓' : 'not this time'
      }</span>
    </div>`).join('') || `<div class="empty"><span class="big">📨</span>Tap a chore above to tell your parent you did it!</div>`;

  // Coin history
  $('#history').innerHTML = s.history.slice(0, 6).map((h) => `
    <div class="row">
      <div class="grow">
        <div class="title">${esc(h.note)}</div>
        <div class="meta">${fmtWhen(h.at)}</div>
      </div>
      <span class="${h.amount >= 0 ? 'delta-pos' : 'delta-neg'}">${h.amount >= 0 ? '+' : ''}${h.amount}</span>
    </div>`).join('') || `<div class="empty">No coins yet — you've got this! 💪</div>`;

  // Celebrate fresh answers (but not old ones on first load)
  if (prevStatuses) {
    for (const r of s.requests) {
      const prev = prevStatuses.get(r.id);
      if (prev === 'pending' && r.status === 'approved') celebrate(r.awarded, r.choreName);
      if (prev === 'pending' && r.status === 'denied') toast(`"${r.choreName}" — not this time 💛`);
    }
  }
  prevStatuses = new Map(s.requests.map((r) => [r.id, r.status]));
}

function showBalance(el, n) {
  el.textContent = n.toLocaleString();
  el.classList.toggle('long', el.textContent.length > 6);
}

function animateBalance(target) {
  const el = $('#balance');
  if (shownBalance === null) {
    shownBalance = target;
    showBalance(el, target);
    return;
  }
  if (target === shownBalance) return;
  const from = shownBalance;
  shownBalance = target;
  // Animation frames are frozen while the app is in the background — just show
  // the new number so it's never left stale.
  if (document.hidden) {
    cancelAnimationFrame(balanceAnim);
    showBalance(el, target);
    return;
  }
  if (target > from) {
    const c = $('#big-coin');
    c.classList.remove('spin');
    void c.getBoundingClientRect(); // restart the animation
    c.classList.add('spin');
  }
  const start = performance.now();
  const dur = 700;
  cancelAnimationFrame(balanceAnim);
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    showBalance(el, Math.round(from + (target - from) * eased));
    if (p < 1) balanceAnim = requestAnimationFrame(step);
  };
  balanceAnim = requestAnimationFrame(step);
}

// If an approval lands while the app is in the background, hold the party
// until the kid is actually looking.
const queuedParties = [];
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  while (queuedParties.length) {
    const p = queuedParties.shift();
    celebrate(p.amount, p.why);
  }
});

function celebrate(amount, why) {
  if (document.hidden) { queuedParties.push({ amount, why }); return; }
  const wrap = document.createElement('div');
  wrap.className = 'celebrate';
  wrap.innerHTML = `<div class="msg">
    <div class="big">🎉</div>
    <div class="amt">+${amount} Trawley Coin${amount === 1 ? '' : 's'}!</div>
    <div class="why">${esc(why)}</div>
  </div>`;
  document.body.appendChild(wrap);
  for (let i = 0; i < 26; i++) {
    const c = document.createElement('span');
    c.className = 'confetti-coin';
    c.textContent = Math.random() < 0.75 ? '🪙' : '⭐';
    c.style.left = `${Math.random() * 100}vw`;
    c.style.animationDuration = `${1.3 + Math.random() * 1.4}s`;
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 3400);
  }
  setTimeout(() => wrap.remove(), 3000);
}

// ── Actions ──
const inFlight = new Set(); // chores mid-send: live-mode saves take a moment

$('#chores').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-chore]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.chore;
  if (inFlight.has(id)) return;
  const s = store.getState();
  const chore = s && s.chores.find((c) => c.id === id);
  if (!chore) return;
  inFlight.add(id);
  btn.disabled = true;
  try {
    await submitRequest(store, { choreId: chore.id, choreName: chore.name, coins: chore.coins });
    toast('Sent to your parent! 📨');
  } catch (err) {
    btn.disabled = false;
    toast(err.message || "Couldn't send — try again");
  } finally {
    inFlight.delete(id);
  }
});

async function sendCustom() {
  const input = $('#custom-msg');
  const btn = $('#send-custom');
  const msg = input.value.trim();
  if (!msg) { toast('Type what you did first!'); input.focus(); return; }
  btn.disabled = true;
  try {
    await submitRequest(store, { choreName: msg });
    input.value = '';
    toast('Sent to your parent! 📨');
  } catch (err) {
    toast(err.message || "Couldn't send — try again");
  } finally {
    btn.disabled = false;
  }
}
$('#send-custom').addEventListener('click', sendCustom);
$('#custom-msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCustom(); });
