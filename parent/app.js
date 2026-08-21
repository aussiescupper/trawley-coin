// ─── Trawley Coin — Parent app ───────────────────────────────────────────────
import {
  createStore, resolveRequest, adjustBalance, addChore, updateChore, deleteChore,
  saveSettings, setParentPin, resetAllData, fmtWhen, esc, toast, registerServiceWorker,
  clampCoins, MAX_AWARD, hashPin,
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

let tab = 'requests';
// Unlock lives in memory only: closing, reloading, or the kid pressing Back
// after the parent walks away all re-lock the app.
let pinOk = false;
window.addEventListener('pageshow', (e) => {
  if (e.persisted) {
    pinOk = false;
    const s = store.getState();
    if (s) render(s);
  }
});

if (store.mode === 'firebase' && !store.needsSetup() && !store.getState()) {
  $('#loading-gate').hidden = false;
}

$('#mode-pill').textContent = store.mode === 'firebase' ? 'LIVE' : 'demo';
$('#mode-pill').classList.toggle('live', store.mode === 'firebase');

// ── Set-up gate (live Firebase mode before create/join) ──
const setupGate = $('#setup-gate');
if (store.needsSetup()) {
  setupGate.hidden = false;

  $('#create-family').addEventListener('click', async () => {
    const btn = $('#create-family');
    btn.disabled = true;
    try {
      const code = await store.createFamily();
      setupGate.hidden = true;
      $('#fam-code-display').textContent = code;
      $('#dlg-family-code').showModal();
    } catch (e) {
      $('#parent-join-err').textContent = e.message || 'Could not create family — check your connection';
    } finally {
      btn.disabled = false;
    }
  });

  $('#parent-join-btn').addEventListener('click', async () => {
    const err = $('#parent-join-err');
    err.textContent = '';
    try {
      await store.joinFamily($('#parent-join-code').value);
      setupGate.hidden = true;
    } catch (e) {
      err.textContent = e.message || 'Could not join — try again';
    }
  });
}
$('#fam-code-ok').addEventListener('click', () => $('#dlg-family-code').close());

// ── PIN gate ──
function isLocked() {
  const s = store.getState();
  return Boolean(s && s.parentPin) && !pinOk;
}

async function pinMatches(entered, stored) {
  stored = String(stored);
  // Old saves kept the raw digits; new saves keep a SHA-256 hex hash.
  if (/^[0-9a-f]{64}$/.test(stored)) return (await hashPin(entered)) === stored;
  return entered === stored;
}

async function tryUnlock() {
  const s = store.getState();
  if (!s) return;
  if (await pinMatches($('#pin-entry').value, s.parentPin)) {
    pinOk = true;
    $('#pin-entry').value = '';
    $('#pin-entry-err').textContent = '';
    render(s);
  } else {
    $('#pin-entry-err').textContent = 'Wrong PIN — try again';
  }
}
$('#pin-unlock').addEventListener('click', tryUnlock);
$('#pin-entry').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

// ── Generic confirm dialog ──
function confirmDlg({ title, sub = '', okText = 'OK', danger = true }) {
  return new Promise((resolve) => {
    const d = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-sub').textContent = sub;
    const ok = $('#confirm-ok');
    ok.textContent = okText;
    ok.className = `btn ${danger ? 'danger' : ''}`;
    const done = (v) => {
      if (d.open) d.close();
      ok.onclick = null;
      $('#confirm-cancel').onclick = null;
      d.oncancel = null;
      resolve(v);
    };
    ok.onclick = () => done(true);
    $('#confirm-cancel').onclick = () => done(false);
    d.oncancel = () => done(false);
    d.showModal();
  });
}

// ── Rendering ──
store.onChange(render);

function render(s) {
  $('#loading-gate').hidden = true;

  const needPin = Boolean(s.parentPin) && !pinOk;
  $('#pin-gate').hidden = !needPin;
  // While locked, everything behind the gate is unreachable — no tabbing into
  // buttons, no dialogs floating above the lock screen.
  document.querySelector('.app').toggleAttribute('inert', needPin);
  document.querySelector('.tabbar').toggleAttribute('inert', needPin);
  if (needPin) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (!$('#pin-entry').matches(':focus')) $('#pin-entry').focus();
  }

  $('#sub').textContent = s.familyName;
  $('#bal-label').textContent = `${s.kidName}'s Trawley Coins`;
  const balEl = $('#balance');
  balEl.textContent = s.balance.toLocaleString();
  balEl.classList.toggle('long', balEl.textContent.length > 6);

  const pendingCount = s.requests.filter((r) => r.status === 'pending').length;
  const badge = $('#badge-requests');
  badge.hidden = !pendingCount;
  badge.textContent = pendingCount || '';
  document.title = pendingCount ? `(${pendingCount}) Trawley Coin — Parent` : 'Trawley Coin — Parent';

  // If a request being approved got handled elsewhere, close the dialog
  const dlg = $('#dlg-approve');
  if (dlg.open) {
    const r = s.requests.find((x) => x.id === dlg.dataset.id);
    if (!r || r.status !== 'pending') {
      dlg.close();
      toast('That one was already answered');
    }
  }

  // Nothing behind the lock screen gets built while locked
  if (!needPin) renderTab(s);
}

let pendingRender = false;

// A render skipped to protect typing is replayed once focus leaves the field
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!pendingRender) return;
    const s = store.getState();
    if (!s) return;
    pendingRender = false;
    renderTab(s);
  }, 0);
});

function renderTab(s) {
  for (const t of ['requests', 'chores', 'history', 'settings']) {
    $(`#tab-${t}`).hidden = t !== tab;
  }
  const el = $(`#tab-${tab}`);
  const ae = document.activeElement;
  // Don't clobber something the parent is typing when a live update arrives
  if (ae && el.contains(ae) && ae.matches('input, textarea')) {
    pendingRender = true;
    return;
  }

  if (tab === 'requests') renderRequests(s);
  else if (tab === 'chores') renderChores(s);
  else if (tab === 'history') $('#ledger').innerHTML = ledgerHTML(s);
  else if (tab === 'settings') renderSettings(s);
}

function choreEmoji(s, r) {
  const chore = r.choreId && s.chores.find((c) => c.id === r.choreId);
  return chore?.emoji || '📨';
}

function renderRequests(s) {
  const pending = s.requests.filter((r) => r.status === 'pending');
  const resolved = s.requests.filter((r) => r.status !== 'pending').slice(0, 10);

  let html = '<div class="section-title">Waiting for you</div>';
  if (!pending.length) {
    html += '<div class="card"><div class="empty"><span class="big">🎉</span>Nothing waiting — all caught up!</div></div>';
  }
  for (const r of pending) {
    html += `<div class="card">
      <div class="row" style="border:none;padding-top:0">
        <div class="emoji">${esc(choreEmoji(s, r))}</div>
        <div class="grow">
          <div class="title">${esc(r.choreName)}</div>
          <div class="meta">${esc(s.kidName)} · ${fmtWhen(r.createdAt)}</div>
        </div>
        ${r.coins != null ? `<span class="coin-amount">${COIN_SM} ${r.coins}</span>` : ''}
      </div>
      <div class="btn-row" style="margin-top:4px">
        <button class="btn secondary" data-deny="${r.id}">Not this time</button>
        <button class="btn good" data-approve="${r.id}">Approve…</button>
      </div>
    </div>`;
  }

  html += '<div class="section-title">Recently answered</div>';
  html += resolved.length
    ? `<div class="card">${resolved.map((r) => `
        <div class="row">
          <div class="grow">
            <div class="title">${esc(r.choreName)}</div>
            <div class="meta">${fmtWhen(r.resolvedAt)}</div>
          </div>
          ${r.status === 'approved' ? `<span class="coin-amount">+${r.awarded}&nbsp;${COIN_SM}</span>` : ''}
          <span class="status-chip ${r.status}">${r.status === 'approved' ? 'approved' : 'denied'}</span>
        </div>`).join('')}</div>`
    : '<div class="card"><div class="empty">Answered requests will show up here.</div></div>';

  $('#tab-requests').innerHTML = html;
}

function renderChores(s) {
  $('#chore-list').innerHTML = s.chores.map((c) => `
    <button class="row" data-edit="${c.id}" style="width:100%;background:none;text-align:left;color:inherit">
      <div class="emoji">${esc(c.emoji || '⭐')}</div>
      <div class="grow"><div class="title">${esc(c.name)}</div></div>
      <span class="coin-amount">${COIN_SM} ${c.coins}</span>
      <span style="color:var(--ink-soft)">✏️</span>
    </button>`).join('') || '<div class="empty"><span class="big">🧹</span>No chores yet — add your first one below.</div>';
}

function ledgerHTML(s) {
  return s.history.slice(0, 40).map((h) => `
    <div class="row">
      <div class="grow">
        <div class="title">${esc(h.note)}</div>
        <div class="meta">${fmtWhen(h.at)}</div>
      </div>
      <span class="${h.amount >= 0 ? 'delta-pos' : 'delta-neg'}">${h.amount >= 0 ? '+' : ''}${h.amount}</span>
    </div>`).join('') || '<div class="empty">No coin movements yet.</div>';
}

function renderSettings(s) {
  const kid = $('#set-kid');
  const fam = $('#set-family');
  if (document.activeElement !== kid) kid.value = s.kidName;
  if (document.activeElement !== fam) fam.value = s.familyName;
  $('#set-pin').textContent = s.parentPin ? 'Change PIN' : 'Set PIN';
  $('#remove-pin').hidden = !s.parentPin;

  if (store.mode === 'firebase') {
    $('#sync-card').innerHTML = `
      <p class="sub" style="margin-top:0">Live sync is on ✓ Your kid joins by typing this family code into their app:</p>
      <div class="family-code">${esc(store.familyCode() || '')}</div>`;
  } else {
    $('#sync-card').innerHTML = `
      <p class="sub" style="margin:0">Demo mode — data lives in this browser only, and the Parent and Kid
      apps sync live between tabs on this device. To link your phone with your kid's phone,
      set up free Firebase sync — see the 5-minute guide in README.md.</p>`;
  }
}

// ── Tabs ──
document.querySelector('.tabbar').addEventListener('click', (e) => {
  if (isLocked()) return;
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  tab = btn.dataset.tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
  const s = store.getState();
  if (s) renderTab(s);
});

// ── Requests: approve / deny ──
$('#tab-requests').addEventListener('click', async (e) => {
  if (isLocked()) return;
  const approveBtn = e.target.closest('[data-approve]');
  const denyBtn = e.target.closest('[data-deny]');
  const s = store.getState();
  if (!s) return;

  if (approveBtn) {
    const r = s.requests.find((x) => x.id === approveBtn.dataset.approve);
    if (!r) return;
    const dlg = $('#dlg-approve');
    dlg.dataset.id = r.id;
    $('#approve-sub').textContent = `"${r.choreName}" — how many Trawley Coins?`;
    $('#approve-amount').value = r.coins != null ? r.coins : '';
    dlg.showModal();
    $('#approve-amount').select();
  }

  if (denyBtn) {
    const r = s.requests.find((x) => x.id === denyBtn.dataset.deny);
    if (!r) return;
    const yes = await confirmDlg({
      title: `Say no to "${r.choreName}"?`,
      sub: `${s.kidName} will see it wasn't approved this time.`,
      okText: 'Not this time',
    });
    if (yes) {
      const cur = store.getState()?.requests.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'pending') {
        toast('That one was already answered');
        return;
      }
      await resolveRequest(store, r.id, false);
      toast('Okay — marked as not this time');
    }
  }
});

$('#approve-cancel').addEventListener('click', () => $('#dlg-approve').close());
$('#approve-ok').addEventListener('click', async () => {
  const dlg = $('#dlg-approve');
  const input = $('#approve-amount');
  if (input.value.trim() === '') { input.focus(); return; }
  const raw = Number(input.value);
  const amt = clampCoins(input.value);
  if (Number.isFinite(raw) && raw > MAX_AWARD) {
    toast(`Steady on! Max ${MAX_AWARD.toLocaleString()} coins at a time`);
    input.value = amt;
    return;
  }
  const id = dlg.dataset.id;
  dlg.close();
  await resolveRequest(store, id, true, amt);
  const s = store.getState();
  toast(`Approved! +${amt} coins for ${s ? s.kidName : 'your kid'} 🎉`);
});

// ── Chores ──
function openChoreDialog(chore) {
  const dlg = $('#dlg-chore');
  dlg.dataset.id = chore ? chore.id : '';
  $('#chore-dlg-title').textContent = chore ? 'Edit chore' : 'New chore';
  $('#chore-name').value = chore ? chore.name : '';
  $('#chore-emoji').value = chore ? (chore.emoji || '') : '';
  $('#chore-coins').value = chore ? chore.coins : '';
  $('#chore-delete').hidden = !chore;
  dlg.showModal();
  if (!chore) $('#chore-name').focus();
}

$('#add-chore').addEventListener('click', () => openChoreDialog(null));

$('#chore-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (!btn) return;
  const s = store.getState();
  const chore = s && s.chores.find((c) => c.id === btn.dataset.edit);
  if (chore) openChoreDialog(chore);
});

$('#chore-cancel').addEventListener('click', () => $('#dlg-chore').close());

$('#chore-save').addEventListener('click', async () => {
  const dlg = $('#dlg-chore');
  const name = $('#chore-name').value.trim();
  if (!name) { toast('Give the chore a name'); $('#chore-name').focus(); return; }
  const fields = {
    name,
    coins: $('#chore-coins').value,
    emoji: $('#chore-emoji').value.trim(),
  };
  dlg.close();
  if (dlg.dataset.id) {
    const exists = store.getState()?.chores.some((c) => c.id === dlg.dataset.id);
    if (!exists) { toast('That chore was deleted on another device'); return; }
    await updateChore(store, dlg.dataset.id, fields);
  } else {
    await addChore(store, fields);
  }
  toast('Chore saved ✓');
});

$('#chore-delete').addEventListener('click', async () => {
  const dlg = $('#dlg-chore');
  const s = store.getState();
  const chore = s && s.chores.find((c) => c.id === dlg.dataset.id);
  dlg.close();
  if (!chore) return;
  const yes = await confirmDlg({
    title: `Delete "${chore.name}"?`,
    sub: 'It disappears from the kid app too.',
    okText: 'Delete',
  });
  if (yes) {
    await deleteChore(store, chore.id);
    toast('Chore deleted');
  }
});

// ── History: manual adjust ──
async function doAdjust(sign) {
  const amtInput = $('#adj-amount');
  const n = clampCoins(amtInput.value);
  if (!n || n <= 0) { toast('Enter how many coins first'); amtInput.focus(); return; }
  const s = store.getState();
  if (!s) return;
  const actual = Math.max(0, s.balance + sign * n) - s.balance;
  if (actual === 0) { toast(`${s.kidName} has no coins to spend yet`); return; }
  const note = $('#adj-note').value.trim();
  await adjustBalance(store, sign * n, note || (sign > 0 ? 'Bonus from parent' : 'Coins spent'));
  amtInput.value = '';
  $('#adj-note').value = '';
  toast(actual > 0 ? `Added ${actual} coins ✓` : `Spent ${-actual} coins ✓`);
  const now = store.getState();
  if (now) renderTab(now);
}
$('#adj-add').addEventListener('click', () => doAdjust(1));
$('#adj-spend').addEventListener('click', () => doAdjust(-1));

// ── Settings ──
$('#save-settings').addEventListener('click', async () => {
  await saveSettings(store, {
    kidName: $('#set-kid').value.trim(),
    familyName: $('#set-family').value.trim(),
  });
  toast('Saved ✓');
  const s = store.getState();
  if (s) render(s);
});

$('#set-pin').addEventListener('click', () => {
  $('#pin-value').value = '';
  $('#pin-err').textContent = '';
  $('#dlg-pin').showModal();
});
$('#pin-cancel').addEventListener('click', () => $('#dlg-pin').close());
$('#pin-save').addEventListener('click', async () => {
  const v = $('#pin-value').value.trim();
  if (!/^\d{4,8}$/.test(v)) {
    $('#pin-err').textContent = 'PIN must be 4–8 digits';
    return;
  }
  $('#dlg-pin').close();
  await setParentPin(store, await hashPin(v));
  pinOk = true;
  toast('PIN set ✓');
});
$('#remove-pin').addEventListener('click', async () => {
  const yes = await confirmDlg({ title: 'Remove the parent PIN?', okText: 'Remove' });
  if (yes) {
    await setParentPin(store, null);
    toast('PIN removed');
  }
});

$('#reset-data').addEventListener('click', async () => {
  const yes = await confirmDlg({
    title: 'Reset all data?',
    sub: 'Balance, chores, requests and history all go back to the start. This can\'t be undone.',
    okText: 'Reset everything',
  });
  if (yes) {
    await resetAllData(store);
    toast('Fresh start ✓');
  }
});
