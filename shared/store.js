// ─── Trawley Coin data store ─────────────────────────────────────────────────
// One shared "family" state object, synced live.
//
//   demo mode     → localStorage + BroadcastChannel (live across tabs on one device)
//   firebase mode → Firestore document families/{code} with onSnapshot (live
//                   across devices; kid joins with the family code)
//
// All writes go through store.update(mutator) so both backends behave the same.

const LS_STATE = 'trawley-coin-state-v1';
const LS_FAMILY = 'trawley-coin-family-code';
const FIREBASE_VER = '10.12.2';

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_CHORES = [
  { name: 'Make your bed', coins: 2, emoji: '🛏️' },
  { name: 'Unstack the dishwasher', coins: 5, emoji: '🍽️' },
  { name: 'Take out the rubbish', coins: 3, emoji: '🗑️' },
  { name: 'Tidy your room', coins: 5, emoji: '🧸' },
  { name: 'Finish your homework', coins: 5, emoji: '📚' },
  { name: 'Help with dinner', coins: 4, emoji: '🥕' },
];

export function defaultState() {
  return {
    version: 1,
    familyName: 'Trawley Family',
    kidName: 'Kiddo',
    balance: 0,
    parentPin: null,
    chores: DEFAULT_CHORES.map((c) => ({ id: uid() + Math.random().toString(36).slice(2, 5), ...c })),
    requests: [],   // { id, choreId, choreName, coins, note, status, awarded, createdAt, resolvedAt }
    history: [],    // { id, type: 'earn'|'spend'|'adjust', amount, note, at }
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Keep the coin economy sane (also guards against silly typed amounts).
export const MAX_AWARD = 10000;      // most coins in a single award/adjust
export const MAX_BALANCE = 1000000;  // most coins a kid can hold

export function clampCoins(n, max = MAX_AWARD) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(0, v));
}

// Older saved states may miss newer fields — patch them in (and repair
// anything out of range).
function migrate(s) {
  const d = defaultState();
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.balance = clampCoins(s.balance, MAX_BALANCE);
  for (const r of s.requests) {
    if (r.awarded != null) r.awarded = clampCoins(r.awarded, MAX_BALANCE);
    if (r.coins != null) r.coins = clampCoins(r.coins, MAX_BALANCE);
  }
  for (const h of s.history) {
    const sign = (Number(h.amount) || 0) < 0 ? -1 : 1;
    h.amount = sign * clampCoins(Math.abs(Number(h.amount) || 0), MAX_BALANCE);
  }
  return s;
}

// ─── Demo backend: this browser only, live across tabs ───────────────────────

function createLocalStore() {
  const listeners = new Set();

  function read() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) return migrate(JSON.parse(raw));
    } catch (e) { console.warn('Trawley: could not read saved state', e); }
    return null;
  }

  let state = read();
  if (!state) {
    state = defaultState();
    localStorage.setItem(LS_STATE, JSON.stringify(state));
  }

  const notify = () => listeners.forEach((fn) => fn(state));

  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('trawley-coin') : null;
  if (bc) bc.onmessage = () => { const s = read(); if (s) { state = s; notify(); } };
  window.addEventListener('storage', (e) => {
    if (e.key === LS_STATE) { const s = read(); if (s) { state = s; notify(); } }
  });

  return {
    mode: 'demo',
    familyCode: () => null,
    needsSetup: () => false,
    getState: () => state,
    onChange(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    async update(mutator) {
      const s = read() || state;
      mutator(s);
      s.updatedAt = Date.now();
      state = s;
      localStorage.setItem(LS_STATE, JSON.stringify(s));
      if (bc) bc.postMessage('changed');
      notify();
    },
    async createFamily() { /* not needed in demo mode */ },
    async joinFamily() { /* not needed in demo mode */ },
    leaveFamily() { /* not needed in demo mode */ },
  };
}

// ─── Firebase backend: live across devices ───────────────────────────────────

function randomFamilyCode() {
  // No 0/O/1/I — kids type this in.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

async function createFirebaseStore(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);

  const app = appMod.initializeApp(cfg);
  await authMod.signInAnonymously(authMod.getAuth(app));
  let db;
  try {
    // Offline cache: balance/chores still show (last-known) without internet,
    // and both apps can be open in tabs of the same browser.
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn('Trawley: offline cache unavailable, continuing without it', e);
    db = fsMod.getFirestore(app);
  }

  const listeners = new Set();
  let code = localStorage.getItem(LS_FAMILY) || null;
  let state = null;
  let unsubscribe = null;

  const notify = () => { if (state) listeners.forEach((fn) => fn(state)); };
  const familyRef = () => fsMod.doc(db, 'families', code);

  function watch() {
    if (unsubscribe) unsubscribe();
    unsubscribe = fsMod.onSnapshot(familyRef(), (snap) => {
      if (snap.exists()) { state = migrate(snap.data()); notify(); }
    }, (err) => console.error('Trawley: sync error', err));
  }

  if (code) watch();

  return {
    mode: 'firebase',
    familyCode: () => code,
    needsSetup: () => !code,
    getState: () => state,
    onChange(fn) { listeners.add(fn); if (state) fn(state); return () => listeners.delete(fn); },
    async update(mutator) {
      if (!code) throw new Error('No family joined yet');
      try {
        // Online: a transaction keeps two devices from clobbering each other.
        await fsMod.runTransaction(db, async (tx) => {
          const snap = await tx.get(familyRef());
          const s = snap.exists() ? migrate(snap.data()) : defaultState();
          mutator(s);
          s.updatedAt = Date.now();
          tx.set(familyRef(), s);
        });
      } catch (e) {
        // Transactions need the server, so offline they always fail. Fall back
        // to a plain write against the local cache: Firestore queues it and
        // sends it when the phone reconnects, and the UI updates right away.
        const offline = e && (e.code === 'unavailable' || !navigator.onLine);
        if (!offline) {
          console.error('Trawley: write failed', e);
          throw new Error("That didn't save — check the internet and try again");
        }
        const base = state ? JSON.parse(JSON.stringify(state)) : defaultState();
        mutator(base);
        base.updatedAt = Date.now();
        fsMod.setDoc(familyRef(), base).catch((err) => {
          console.error('Trawley: queued write failed', err);
        });
        state = base;
        notify();
      }
    },
    async createFamily() {
      code = randomFamilyCode();
      state = defaultState();
      await fsMod.setDoc(familyRef(), state);
      localStorage.setItem(LS_FAMILY, code);
      watch();
      notify();
      return code;
    },
    async joinFamily(input) {
      const c = String(input || '').trim().toUpperCase();
      if (c.length !== 6) throw new Error('Family codes are 6 letters/numbers');
      const snap = await fsMod.getDoc(fsMod.doc(db, 'families', c));
      if (!snap.exists()) throw new Error('No family found with that code — check it with your parent');
      code = c;
      localStorage.setItem(LS_FAMILY, code);
      state = migrate(snap.data());
      watch();
      notify();
    },
    leaveFamily() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      code = null;
      state = null;
      localStorage.removeItem(LS_FAMILY);
    },
  };
}

export async function createStore() {
  const cfg = window.TRAWLEY_FIREBASE_CONFIG;
  // No silent fallback to demo mode: a family that normally syncs live must
  // never quietly open on a fresh local dataset (it looks like wiped coins,
  // and anything saved there would be stranded). Callers show a retry screen.
  if (cfg && cfg.projectId) return createFirebaseStore(cfg);
  return createLocalStore();
}

// ─── Domain actions (used by both apps) ──────────────────────────────────────

const MAX_REQUESTS = 100;
const MAX_HISTORY = 200;

/** Kid tells the parent they did a chore (or something else). */
export function submitRequest(store, { choreId = null, choreName, coins = null, note = null }) {
  return store.update((s) => {
    // One pending request per preset chore — rapid taps and sync races
    // must not let the same chore queue up twice.
    if (choreId && s.requests.some((r) => r.choreId === choreId && r.status === 'pending')) return;
    s.requests.unshift({
      id: uid(),
      choreId,
      choreName: String(choreName).slice(0, 140),
      coins: coins == null ? null : clampCoins(coins),
      note: note ? String(note).slice(0, 200) : null,
      status: 'pending',
      awarded: null,
      createdAt: Date.now(),
      resolvedAt: null,
    });
    s.requests = s.requests.slice(0, MAX_REQUESTS);
  });
}

/** Parent approves (choosing the amount) or denies a request. */
export function resolveRequest(store, requestId, approved, awarded = 0) {
  return store.update((s) => {
    const r = s.requests.find((x) => x.id === requestId);
    if (!r || r.status !== 'pending') return; // already handled elsewhere
    r.status = approved ? 'approved' : 'denied';
    r.resolvedAt = Date.now();
    if (approved) {
      const amt = clampCoins(awarded);
      r.awarded = amt;
      s.balance = Math.min(MAX_BALANCE, s.balance + amt);
      s.history.unshift({ id: uid(), type: 'earn', amount: amt, note: r.choreName, at: Date.now() });
      s.history = s.history.slice(0, MAX_HISTORY);
    }
  });
}

/** Parent adds or removes coins directly (bonus, pocket-money spend, fix-up). */
export function adjustBalance(store, amount, note) {
  return store.update((s) => {
    const raw = Math.round(Number(amount) || 0);
    const step = Math.sign(raw) * clampCoins(Math.abs(raw));
    const next = Math.min(MAX_BALANCE, Math.max(0, s.balance + step));
    const delta = next - s.balance;
    if (delta === 0) return;
    s.balance = next;
    s.history.unshift({
      id: uid(),
      type: delta > 0 ? 'adjust' : 'spend',
      amount: delta,
      note: note ? String(note).slice(0, 120) : (delta > 0 ? 'Bonus from parent' : 'Coins spent'),
      at: Date.now(),
    });
    s.history = s.history.slice(0, MAX_HISTORY);
  });
}

export function addChore(store, { name, coins, emoji }) {
  return store.update((s) => {
    s.chores.push({
      id: uid(),
      name: String(name).slice(0, 60),
      coins: clampCoins(coins),
      emoji: emoji ? String(emoji).slice(0, 8) : '⭐',
    });
  });
}

export function updateChore(store, id, { name, coins, emoji }) {
  return store.update((s) => {
    const c = s.chores.find((x) => x.id === id);
    if (!c) return;
    c.name = String(name).slice(0, 60);
    c.coins = clampCoins(coins);
    if (emoji) c.emoji = String(emoji).slice(0, 8);
  });
}

export function deleteChore(store, id) {
  return store.update((s) => {
    s.chores = s.chores.filter((x) => x.id !== id);
  });
}

export function saveSettings(store, { kidName, familyName }) {
  return store.update((s) => {
    if (kidName) s.kidName = String(kidName).slice(0, 40);
    if (familyName) s.familyName = String(familyName).slice(0, 40);
  });
}

export function setParentPin(store, pin) {
  return store.update((s) => { s.parentPin = pin || null; });
}

/** PINs are stored hashed so the synced family data never contains the raw digits. */
export async function hashPin(pin) {
  const data = new TextEncoder().encode(`trawley-pin:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function resetAllData(store) {
  return store.update((s) => {
    const fresh = defaultState();
    for (const k of Object.keys(fresh)) s[k] = fresh[k];
  });
}

// ─── Small shared UI helpers ─────────────────────────────────────────────────

export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const mins = Math.round((now - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('../sw.js').catch((e) => console.warn('SW registration failed', e));
    });
  }
}
