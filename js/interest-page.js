// Member interest form. Pick yourself from the roster, put a number on each
// open item, send once. Not an order.

import { searchRoster, memberLabel } from './interest.js';

const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const state = {
  unitName: 'Hawkbat Garrison',
  items: [],
  roster: [],
  max: 25,
  member: null,
  answered: new Set(),
  results: [],
  active: -1,
  sending: false,
};

function header() {
  return `
    <header class="top public-top">
      <div class="brand">
        <img src="assets/hbg.svg" alt="" width="84" height="84">
        <div>
          <p class="legion">501st Legion</p>
          <h1>${esc(state.unitName)} merch interest</h1>
          <p class="sub">How many would you likely buy?</p>
        </div>
      </div>
      <a class="officer" href="/">All merch</a>
    </header>
    <div class="stripe" aria-hidden="true"></div>`;
}

const notice = `
  <p class="banner"><strong>This is not an order.</strong> Nothing is charged and you aren't held to these numbers.
  The merch officer uses them to set an upper limit on how many to make. When an item is approved, you'll order it on Chipply like always.</p>`;

// ---------- step 1: who are you ----------

function whoStep() {
  if (state.member) {
    return `
      <section class="who">
        <h2>1. You</h2>
        <div class="who-picked">
          <span class="who-name">${esc(memberLabel(state.member))}</span>
          <button class="link" data-action="change-member">Not you?</button>
        </div>
      </section>`;
  }
  return `
    <section class="who">
      <h2>1. Find yourself on the roster</h2>
      <div class="who-search">
        <label for="member-search">Name or Legion ID</label>
        <input id="member-search" type="search" autocomplete="off" spellcheck="false"
          placeholder="Start typing, like Henkel or TK 61472"
          role="combobox" aria-expanded="false" aria-controls="member-results" aria-autocomplete="list">
        <ul id="member-results" class="who-results" role="listbox" aria-label="Matching members" hidden></ul>
        <p class="hint muted">Not listed? Ask the merch officer to add you.</p>
      </div>
    </section>`;
}

function paintResults() {
  const list = document.getElementById('member-results');
  const input = document.getElementById('member-search');
  if (!list || !input) return;
  const q = input.value.trim();
  if (!q) {
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
  if (state.active >= 0 && state.results[state.active]) {
    input.setAttribute('aria-activedescendant', `opt-${state.results[state.active].id}`);
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

async function pickMember(id) {
  const m = state.roster.find((x) => x.id === id);
  if (!m) return;
  state.member = m;
  state.answered = new Set();
  render();
  try {
    const res = await fetch(`/api/interest?member=${encodeURIComponent(m.id)}`);
    const json = await res.json();
    state.answered = new Set(json.answered || []);
  } catch { /* the server checks again on submit */ }
  render();
  document.querySelector('.qty-input:not([disabled])')?.focus();
}

// ---------- step 2: numbers ----------

function itemCard(it) {
  const done = state.answered.has(it.id);
  const prices = it.prices?.length
    ? `<ul class="prices">${it.prices.map((p) => `<li><span class="price-label">${esc(p.label)}</span><span class="price">${esc(p.price)}</span></li>`).join('')}</ul>`
    : '<p class="prices empty-price">Price not set yet</p>';

  // Sizes and a variant: one box per variant. Otherwise one flat row.
  const grouped = {};
  if (it.sizes.length) for (const c of it.choices) (grouped[c.variant] ||= []).push(c);
  else grouped[''] = it.choices;

  const inputs = Object.entries(grouped).map(([variant, list]) => `
    <fieldset class="qty-group">
      ${variant ? `<legend>${esc(variant)}</legend>` : `<legend class="sr-only">Quantity</legend>`}
      <div class="qty-grid${it.sizes.length ? '' : ' wide'}">
        ${list.map((c) => `
          <label class="qty">
            <span>${esc(c.size || c.variant || 'How many')}</span>
            <input class="qty-input" type="number" inputmode="numeric" min="0" max="${state.max}" step="1"
              name="${esc(it.id)}::${esc(c.key)}" placeholder="0" ${done ? 'disabled' : ''}>
          </label>`).join('')}
      </div>
    </fieldset>`).join('');

  return `
    <li class="card interest-card${done ? ' is-done' : ''}">
      <div class="card-art">${it.artUrl
        ? `<img src="${esc(it.artUrl)}" alt="Art for ${esc(it.name)}" loading="lazy">`
        : '<img class="placeholder" src="assets/hbg.svg" alt="" aria-hidden="true">'}</div>
      <div class="card-body">
        ${done ? '<span class="status done">Already answered</span>' : ''}
        <h2>${esc(it.name)}</h2>
        ${it.note ? `<p class="sub">${esc(it.note)}</p>` : ''}
        ${prices}
        ${done ? '<p class="meta">Your answer is in. Ask the merch officer if you need to change it.</p>' : inputs}
        <p class="item-total" data-total="${esc(it.id)}" aria-live="polite"></p>
      </div>
    </li>`;
}

function itemsStep() {
  if (!state.member) return '';
  const open = state.items.filter((it) => !state.answered.has(it.id));
  return `
    <section>
      <h2>2. How many of each?</h2>
      <p class="sub">Leave it blank or 0 if you'd pass. Up to ${state.max} per box.</p>
      <form id="interest-form" novalidate>
        <ul class="cards interest-cards">${state.items.map(itemCard).join('')}</ul>
        ${open.length
          ? `<div class="submit-bar">
              <p class="sub">You can send this once. Numbers are a gauge, not a purchase.</p>
              <p class="error" id="form-error" role="alert" hidden></p>
              <button type="submit" class="primary" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Send my interest'}</button>
            </div>`
          : '<p class="empty">You\'ve answered every open item. Thanks.</p>'}
      </form>
    </section>`;
}

function render() {
  if (!state.items.length) {
    app.innerHTML = `${header()}
      <p class="empty">Nothing is collecting interest right now. Check back when the next design is in the works.</p>`;
    return;
  }
  app.innerHTML = `${header()}${notice}${whoStep()}${itemsStep()}
    <footer class="public-footer">
      <p class="sub">Merch is sold at cost to members only, per the 501st Legion Charter. Questions go to the garrison merch officer.</p>
    </footer>`;
  updateTotals();
}

function readAnswers(form) {
  const answers = {};
  for (const input of form.querySelectorAll('.qty-input:not([disabled])')) {
    const n = Math.floor(Number(input.value));
    if (!Number.isFinite(n) || n <= 0) continue;
    const [itemId, key] = input.name.split('::');
    (answers[itemId] ||= {})[key] = Math.min(n, state.max);
  }
  return answers;
}

function updateTotals() {
  const form = document.getElementById('interest-form');
  if (!form) return;
  const answers = readAnswers(form);
  for (const el of form.querySelectorAll('[data-total]')) {
    const counts = answers[el.dataset.total];
    const t = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
    const multi = state.items.find((i) => i.id === el.dataset.total)?.choices.length > 1;
    el.textContent = t && multi ? `${t} total` : '';
  }
}

function thanks(any) {
  app.innerHTML = `${header()}
    <section class="thanks">
      <h2>Got it, ${esc(state.member.name ? state.member.name.split(' ')[0] : 'trooper')}.</h2>
      <p class="sub">${any
        ? "Your numbers are in. They help set how many get made. You'll still order on Chipply once an item is approved."
        : "Recorded that you'd pass on these. Thanks for answering, it helps just as much."}</p>
      <p><button data-action="start-over">Answer for someone else</button></p>
    </section>`;
}

async function submit(form) {
  const answers = readAnswers(form);
  const err = form.querySelector('#form-error');
  const total = Object.values(answers).reduce((a, c) => a + Object.values(c).reduce((x, y) => x + y, 0), 0);
  const msg = total
    ? `Send interest for ${total} piece${total === 1 ? '' : 's'}? You can only send this once.`
    : "You left everything at 0. Send that you'd pass on all of these?";
  if (!confirm(msg)) return;

  state.sending = true;
  form.querySelector('button[type="submit"]').disabled = true;
  form.querySelector('button[type="submit"]').textContent = 'Sending…';
  try {
    const res = await fetch('/api/interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: state.member.id, answers }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Couldn't send (${res.status}).`);
    state.sending = false;
    thanks(json.any);
  } catch (e) {
    state.sending = false;
    err.textContent = e.message;
    err.hidden = false;
    const b = form.querySelector('button[type="submit"]');
    b.disabled = false;
    b.textContent = 'Send my interest';
  }
}

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
  const opt = e.target.closest('[data-member]');
  if (opt) return pickMember(opt.dataset.member);
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'change-member' || action === 'start-over') {
    state.member = null;
    state.answered = new Set();
    state.results = [];
    render();
    document.getElementById('member-search')?.focus();
  }
});

app.addEventListener('submit', (e) => {
  if (e.target.id === 'interest-form') {
    e.preventDefault();
    if (!state.sending) submit(e.target);
  }
});

async function load() {
  app.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch('/api/interest');
    if (!res.ok) throw new Error(`Couldn't load the form (${res.status}).`);
    const json = await res.json();
    state.unitName = json.unitName || state.unitName;
    state.items = json.items || [];
    state.roster = json.roster || [];
    state.max = json.maxPerChoice || state.max;
    render();
  } catch (err) {
    app.innerHTML = `${header()}<p class="error">${esc(err.message)} Try again in a minute.</p>`;
  }
}

load();
