// Member-facing page. No password, no officer data.
//
// Also hosts the interest check: while any item is collecting interest, a
// member picks themselves from the roster and the quantity boxes on those
// item cards unlock. One send per member per item. Not an order.

import * as R from './rules.js';
import { searchRoster, memberLabel } from './interest.js';

const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const state = {
  unitName: 'Hawkbat Garrison',
  items: [],          // public items from /api/public
  interest: new Map(), // id -> interest item from /api/interest
  roster: [],
  max: 25,
  member: null,
  answered: new Set(),
  results: [],
  active: -1,
  sending: false,
  sent: null,          // { name, any } after a successful send
  interestError: '',
};

function header() {
  return `
    <header class="top public-top">
      <div class="brand">
        <img src="assets/hbg.svg" alt="" width="84" height="84">
        <div>
          <p class="legion">501st Legion</p>
          <h1>${esc(state.unitName)} merch</h1>
          <p class="sub">What's running, what's coming, and where each item stands.</p>
        </div>
      </div>
      <a class="officer" href="/admin">Officer login</a>
    </header>
    <div class="stripe" aria-hidden="true"></div>`;
}

// ---------- interest check panel ----------

function interestPanel() {
  if (!state.interest.size) return '';
  const count = state.interest.size;
  const plural = count === 1 ? 'item' : 'items';

  let who;
  if (state.sent) {
    who = `
      <div class="thanks-inline" role="status">
        <p><strong>Got it${state.sent.name ? `, ${esc(state.sent.name)}` : ''}.</strong>
        ${state.sent.any
          ? "Your numbers are in. They help set how many get made."
          : "Recorded that you'd pass. That helps just as much."}</p>
        <button class="link" data-action="change-member">Answer for someone else</button>
      </div>`;
  } else if (state.member) {
    const left = [...state.interest.keys()].filter((id) => !state.answered.has(id)).length;
    who = `
      <div class="who-picked">
        <span class="who-name">${esc(memberLabel(state.member))}</span>
        <button class="link" data-action="change-member">Not you?</button>
      </div>
      <p class="sub">${left
        ? `Fill in the boxes on the ${left === 1 ? 'item' : `${left} items`} marked <span class="tag-interest">Interest check</span> below, then send.`
        : "You've already answered every open item. Ask the merch officer if you need to change something."}</p>`;
  } else {
    who = `
      <div class="who-search">
        <label for="member-search">Find yourself by name or Legion ID</label>
        <input id="member-search" type="search" autocomplete="off" spellcheck="false"
          placeholder="Start typing, like Henkel or TK 61472"
          role="combobox" aria-expanded="false" aria-controls="member-results" aria-autocomplete="list">
        <ul id="member-results" class="who-results" role="listbox" aria-label="Matching members" hidden></ul>
        <p class="hint muted">Not listed? Ask the merch officer to add you.</p>
      </div>`;
  }

  return `
    <section class="interest-panel" id="interest">
      <div class="interest-panel-head">
        <h2>Interest check</h2>
        <span class="muted">${count} ${plural} open</span>
      </div>
      <p class="sub"><strong>This is not an order.</strong> Nothing is charged and you aren't held to it.
        Nothing gets made until the sale runs. Your numbers help us confirm quantities with the Legion before we open it. When the sale opens, you'll order through the ordering link.</p>
      ${who}
    </section>`;
}

function paintResults() {
  const list = document.getElementById('member-results');
  const input = document.getElementById('member-search');
  if (!list || !input) return;
  if (!input.value.trim()) {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  list.innerHTML = state.results.length
    ? state.results.map((m, i) => `
        <li role="option" id="opt-${esc(m.id)}" aria-selected="${i === state.active}"
          class="${i === state.active ? 'active' : ''}" data-member="${esc(m.id)}">
          <span>${esc(m.name || 'Private member')}</span>
          <span class="who-id">${esc(m.prefix)} ${esc(m.id)}</span>
        </li>`).join('')
    : '<li class="who-none">No match. Try your last name or just the number.</li>';
  const act = state.results[state.active];
  if (act) input.setAttribute('aria-activedescendant', `opt-${act.id}`);
  else input.removeAttribute('aria-activedescendant');
}

async function pickMember(id) {
  const m = state.roster.find((x) => x.id === id);
  if (!m) return;
  state.member = m;
  state.answered = new Set();
  state.sent = null;
  render();
  try {
    const res = await fetch(`/api/interest?member=${encodeURIComponent(m.id)}`);
    const json = await res.json();
    state.answered = new Set(json.answered || []);
  } catch { /* the server checks again on send */ }
  render();
  const first = document.querySelector('.qty-input:not([disabled])');
  first?.closest('.card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first?.focus({ preventScroll: true });
}

// ---------- cards ----------

function qtyBlock(it) {
  const done = state.answered.has(it.id);
  if (state.member && done) {
    return '<p class="meta qty-done">Your answer is in. Ask the merch officer if you need to change it.</p>';
  }
  const locked = !state.member || Boolean(state.sent);

  return `
    <div class="qty-block${locked ? ' locked' : ''}">
      <p class="qty-title">How many would you buy?</p>
      ${[it.choices].map((list) => `
        <fieldset class="qty-group">
          <legend class="sr-only">Quantity</legend>
          <div class="qty-grid wide">
            ${list.map((c) => `
              <label class="qty">
                <span>${esc(c.variant || 'Quantity')}${c.command ? ' <span class="variant-tag command">Command only</span>' : ''}</span>
                <input class="qty-input" type="number" inputmode="numeric" min="0" max="${state.max}" step="1"
                  name="${esc(it.id)}::${esc(c.key)}" placeholder="0" ${locked ? 'disabled' : ''}>
              </label>`).join('')}
          </div>
        </fieldset>`).join('')}
      ${locked && !state.sent ? '<p class="hint muted">Find yourself in Interest check above to fill this in.</p>' : ''}
      <p class="item-total" data-total="${esc(it.id)}" aria-live="polite"></p>
    </div>`;
}

function card(item, today) {
  const intr = state.interest.get(item.id);
  const status = item.fromInterestOnly ? null : R.publicStatus(item, today);
  const open = status?.label === 'Ordering open';
  const prices = intr ? intr.prices : R.priceLines(item);
  const event = item.type === 'event' && item.eventDate
    ? `For ${esc(item.eventName || 'event')}, ${R.formatDate(item.eventDate)}`
    : '';
  const done = intr && state.member && state.answered.has(item.id);

  return `
    <li class="card${intr ? ' interest-card' : ''}${done ? ' is-done' : ''}">
      <div class="card-art">${!item.artUrl
        ? '<img class="placeholder" src="assets/hbg.svg" alt="" aria-hidden="true">'
        : isPdf(item.artUrl)
          ? `<a class="art-zoom art-pdf" href="${esc(item.artUrl)}" target="_blank" rel="noopener">
              <span>View art (PDF)</span></a>`
          : `<button type="button" class="art-zoom" data-zoom="${esc(item.artUrl)}" data-zoom-name="${esc(item.name)}"
              aria-label="View larger art for ${esc(item.name)}">
              <img src="${esc(item.artUrl)}" alt="Art for ${esc(item.name)}" loading="lazy">
              <span class="zoom-hint" aria-hidden="true">Tap to enlarge</span>
            </button>`}</div>
      <div class="card-body">
        <div class="tags">
          ${intr ? `<span class="status interest">${done ? 'Answered' : 'Interest check'}</span>` : ''}
          ${status ? `<span class="status ${status.tone}">${esc(status.label)}</span>` : ''}
        </div>
        <h2>${esc(item.name)}</h2>
        ${status ? `<p class="sub">${esc(status.note)}</p>` : ''}
        ${intr?.note ? `<p class="sub">${esc(intr.note)}</p>` : ''}
        ${event ? `<p class="meta">${event}</p>` : ''}
        ${prices.length ? `<ul class="prices">${prices.map((p) => `<li>
          <span class="price-label">${esc(p.label)}${p.command ? '<span class="variant-tag command">Command only</span>' : p.variant ? '<span class="variant-tag">Variant</span>' : ''}</span>
          <span class="price">${esc(p.price)}</span>
        </li>`).join('')}</ul>` : '<p class="prices empty-price">Pricing to come</p>'}
        ${intr ? qtyBlock(intr) : ''}
        ${item.chipplyUrl && open
          ? `<a class="order" href="${esc(item.chipplyUrl)}" target="_blank" rel="noopener">Order now</a>`
          : item.chipplyUrl && status?.rank === 2
            ? `<a class="store-link" href="${esc(item.chipplyUrl)}" target="_blank" rel="noopener">Store link</a>`
            : ''}
      </div>
    </li>`;
}

// Public items, plus interest items the officer kept off the public list.
// Interest checks sort first so members see them without scrolling.
function allCards() {
  const byId = new Map(state.items.map((i) => [i.id, i]));
  for (const [id, it] of state.interest) {
    if (!byId.has(id)) byId.set(id, { id, name: it.name, artUrl: it.artUrl, fromInterestOnly: true });
  }
  return [...byId.values()].sort((a, b) => {
    const ia = state.interest.has(a.id) ? 0 : 1;
    const ib = state.interest.has(b.id) ? 0 : 1;
    if (ia !== ib) return ia - ib;
    if (a.fromInterestOnly || b.fromInterestOnly) return 0;
    return R.publicOrder(a, b);
  });
}

function submitBar() {
  if (!state.member || state.sent) return '';
  const left = [...state.interest.keys()].filter((id) => !state.answered.has(id));
  if (!left.length) return '';
  return `
    <div class="submit-bar">
      <p class="sub">Sending as <strong>${esc(state.member.name || `${state.member.prefix} ${state.member.id}`)}</strong>. One send, not an order.</p>
      <p class="error" id="form-error" role="alert" hidden></p>
      <button type="submit" class="primary" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Send my interest'}</button>
    </div>`;
}

// Keep anything typed across re-renders.
function snapshotInputs() {
  return Object.fromEntries([...document.querySelectorAll('.qty-input')].map((i) => [i.name, i.value]));
}

function render() {
  const keep = snapshotInputs();
  const today = R.todayISO();
  const cards = allCards();

  app.innerHTML = `${header()}
    ${state.interestError ? `<p class="error">${esc(state.interestError)}</p>` : ''}
    ${interestPanel()}
    <form id="interest-form" novalidate>
      ${cards.length
        ? `<ul class="cards">${cards.map((i) => card(i, today)).join('')}</ul>`
        : '<p class="empty">Nothing posted right now. Check back after the next approval.</p>'}
      ${submitBar()}
    </form>
    <footer class="public-footer">
      <p class="sub">Merch is sold at cost to members only, per the 501st Legion Charter. Questions go to the garrison merch officer.</p>
    </footer>`;

  for (const input of document.querySelectorAll('.qty-input:not([disabled])')) {
    if (keep[input.name]) input.value = keep[input.name];
  }
  updateTotals();
}

function readAnswers() {
  const answers = {};
  for (const input of document.querySelectorAll('.qty-input:not([disabled])')) {
    const n = Math.floor(Number(input.value));
    if (!Number.isFinite(n) || n <= 0) continue;
    const [itemId, key] = input.name.split('::');
    (answers[itemId] ||= {})[key] = Math.min(n, state.max);
  }
  return answers;
}

function updateTotals() {
  const answers = readAnswers();
  for (const el of document.querySelectorAll('[data-total]')) {
    const counts = answers[el.dataset.total];
    const t = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
    const multi = (state.interest.get(el.dataset.total)?.choices.length || 0) > 1;
    el.textContent = t && multi ? `${t} total` : '';
  }
}

async function submit(form) {
  const answers = readAnswers();
  const total = Object.values(answers).reduce((a, c) => a + Object.values(c).reduce((x, y) => x + y, 0), 0);
  const msg = total
    ? `Send interest for ${total} piece${total === 1 ? '' : 's'}? You can only send this once.`
    : "You left everything at 0. Send that you'd pass on these?";
  if (!confirm(msg)) return;

  const button = form.querySelector('.submit-bar button');
  const err = form.querySelector('#form-error');
  state.sending = true;
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const res = await fetch('/api/interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: state.member.id, answers }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Couldn't send (${res.status}).`);
    state.sending = false;
    for (const id of json.items || []) state.answered.add(id);
    state.sent = { name: state.member.name ? state.member.name.split(' ')[0] : '', any: json.any };
    render();
    document.getElementById('interest')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    state.sending = false;
    err.textContent = e.message;
    err.hidden = false;
    button.disabled = false;
    button.textContent = 'Send my interest';
  }
}

// ---------- art viewer ----------

const isPdf = (url) => /\.pdf(\?|$)/i.test(url) || /[?&]f=[^&]*\.pdf/i.test(url);

const viewer = document.createElement('dialog');
viewer.className = 'art-viewer';
viewer.setAttribute('aria-label', 'Item art');
viewer.innerHTML = `
  <div class="viewer-bar">
    <h2 class="viewer-title"></h2>
    <div class="viewer-actions">
      <a class="viewer-open" target="_blank" rel="noopener">Open full size</a>
      <button type="button" class="viewer-close" aria-label="Close">Close</button>
    </div>
  </div>
  <div class="viewer-stage"><img alt=""></div>`;
document.body.append(viewer);

function openViewer(url, name) {
  viewer.querySelector('.viewer-title').textContent = name;
  viewer.querySelector('.viewer-open').href = url;
  const img = viewer.querySelector('img');
  img.src = url;
  img.alt = `Art for ${name}`;
  viewer.showModal();
  viewer.querySelector('.viewer-close').focus();
}

viewer.addEventListener('click', (e) => {
  // Close on the X, or a click on the dark area around the art.
  if (e.target.closest('.viewer-close') || e.target === viewer || e.target.classList.contains('viewer-stage')) viewer.close();
});
viewer.addEventListener('close', () => { viewer.querySelector('img').removeAttribute('src'); });

// ---------- events ----------

app.addEventListener('input', (e) => {
  if (e.target.id === 'member-search') {
    state.results = searchRoster(state.roster, e.target.value);
    state.active = state.results.length ? 0 : -1;
    paintResults();
  } else if (e.target.classList.contains('qty-input')) {
    updateTotals();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.target.id !== 'member-search') return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!state.results.length) return;
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    state.active = (state.active + d + state.results.length) % state.results.length;
    paintResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const m = state.results[state.active];
    if (m) pickMember(m.id);
  } else if (e.key === 'Escape') {
    e.target.value = '';
    state.results = [];
    paintResults();
  }
});

app.addEventListener('click', (e) => {
  const zoom = e.target.closest('[data-zoom]');
  if (zoom) return openViewer(zoom.dataset.zoom, zoom.dataset.zoomName);
  const opt = e.target.closest('[data-member]');
  if (opt) return pickMember(opt.dataset.member);
  if (e.target.closest('[data-action]')?.dataset.action === 'change-member') {
    state.member = null;
    state.answered = new Set();
    state.results = [];
    state.sent = null;
    for (const i of document.querySelectorAll('.qty-input')) i.value = '';
    render();
    document.getElementById('member-search')?.focus();
  }
});

app.addEventListener('submit', (e) => {
  if (e.target.id !== 'interest-form') return;
  e.preventDefault();
  if (state.member && !state.sending) submit(e.target);
});

async function load() {
  app.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const [pub, intr] = await Promise.all([
      fetch('/api/public').then((r) => {
        if (!r.ok) throw new Error(`Couldn't load the merch list (${r.status}).`);
        return r.json();
      }),
      fetch('/api/interest').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`(${r.status})`))))
        .catch(() => null),
    ]);
    state.unitName = pub.unitName || state.unitName;
    state.items = pub.items || [];
    if (intr) {
      state.interest = new Map((intr.items || []).map((i) => [i.id, i]));
      state.roster = intr.roster || [];
      state.max = intr.maxPerChoice || state.max;
    } else if (pub.interestOpen) {
      state.interestError = "The interest check didn't load. Refresh to try again.";
    }
    render();
    if (location.hash === '#interest') document.getElementById('interest')?.scrollIntoView();
  } catch (err) {
    app.innerHTML = `${header()}<p class="error">${esc(err.message)} Try again in a minute.</p>`;
  }
}

load();
