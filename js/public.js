// Member-facing page. Read only, no password, no officer data.

import * as R from './rules.js';

const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function header(unitName) {
  return `
    <header class="top public-top">
      <div class="brand">
        <img src="assets/hbg.svg" alt="" width="84" height="84">
        <div>
          <p class="legion">501st Legion</p>
          <h1>${esc(unitName)} merch</h1>
          <p class="sub">What's running, what's coming, and where each item stands.</p>
        </div>
      </div>
      <a class="officer" href="/admin">Officer login</a>
    </header>
    <div class="stripe" aria-hidden="true"></div>`;
}

function card(item, today) {
  const status = R.publicStatus(item, today);
  const open = status.label === 'Ordering open';
  const money = Number(item.price);
  const bits = [
    item.price ? `$${Number.isFinite(money) ? money.toFixed(2) : esc(item.price)} each` : '',
    item.type === 'event' && item.eventDate ? `For ${esc(item.eventName || 'event')}, ${R.formatDate(item.eventDate)}` : '',
  ].filter(Boolean);

  return `
    <li class="card">
      <div class="card-art">${item.artUrl
        ? `<img src="${esc(item.artUrl)}" alt="Art for ${esc(item.name)}" loading="lazy">`
        : '<img class="placeholder" src="assets/hbg.svg" alt="" aria-hidden="true">'}</div>
      <div class="card-body">
        <span class="status ${status.tone}">${esc(status.label)}</span>
        <h2>${esc(item.name)}</h2>
        <p class="sub">${esc(status.note)}</p>
        ${item.variant ? `<p class="variant"><span class="variant-tag">Variant</span> ${esc(item.variant)}</p>` : ''}
        ${bits.length ? `<p class="meta">${bits.join(' &middot; ')}</p>` : ''}
        ${item.chipplyUrl && open
          ? `<a class="order" href="${esc(item.chipplyUrl)}" target="_blank" rel="noopener">Order on Chipply</a>`
          : item.chipplyUrl && status.rank === 2
            ? `<a class="link" href="${esc(item.chipplyUrl)}" target="_blank" rel="noopener">Store link</a>`
            : ''}
      </div>
    </li>`;
}

async function load() {
  app.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const res = await fetch('/api/public');
    if (!res.ok) throw new Error(`Couldn't load the merch list (${res.status}).`);
    const { unitName, items } = await res.json();
    const today = R.todayISO();
    const sorted = [...items].sort(R.publicOrder);

    app.innerHTML = `${header(unitName)}
      ${sorted.length
        ? `<ul class="cards">${sorted.map((i) => card(i, today)).join('')}</ul>`
        : '<p class="empty">Nothing posted right now. Check back after the next approval.</p>'}
      <footer class="public-footer">
        <p class="sub">Merch is sold at cost to members only, per the 501st Legion Charter. Questions go to the garrison merch officer.</p>
      </footer>`;
  } catch (err) {
    app.innerHTML = `${header('Hawkbat Garrison')}<p class="error">${esc(err.message)} Try again in a minute.</p>`;
  }
}

load();
