import { loadData, saveData, uploadArt, getPassword, setPassword, clearPassword } from './api.js';
import * as R from './rules.js';

const app = document.getElementById('app');
const itemDialog = document.getElementById('item-dialog');
const settingsDialog = document.getElementById('settings-dialog');
const importDialog = document.getElementById('import-dialog');

const state = { data: null, year: null };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const options = (map, current) => Object.entries(map)
  .map(([k, label]) => `<option value="${esc(k)}"${String(k) === String(current) ? ' selected' : ''}>${esc(label)}</option>`)
  .join('');

function toast(message, undo = null) {
  document.querySelectorAll('.toast').forEach((el) => el.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  t.append(text);
  if (undo) {
    const b = document.createElement('button');
    b.className = 'toast-undo';
    b.textContent = 'Undo';
    b.addEventListener('click', () => { t.remove(); undo(); });
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), undo ? 8000 : 4500);
}

// One click moves an item to its next step, dated today.
async function advance(id, button) {
  const it = state.data.items.find((i) => i.id === id);
  const act = it && R.nextAction(it);
  if (!act) return;
  if (button) button.disabled = true;
  const setField = (value) => persist((d) => {
    const target = d.items.find((i) => i.id === id);
    if (target) target[act.field] = value;
  });
  if (await setField(R.todayISO())) {
    toast(`${it.name}: ${act.done}.`, async () => {
      if (await setField('')) toast(`Undid ${act.done} on ${it.name}.`);
    });
  } else if (button) {
    button.disabled = false;
  }
}

function normalize(data) {
  return {
    version: data.version || 0,
    items: Array.isArray(data.items) ? data.items : [],
    settings: { ...R.DEFAULT_SETTINGS, ...(data.settings || {}) },
  };
}

// ---------- loading and saving ----------

async function boot() {
  if (!getPassword()) return renderLogin();
  app.innerHTML = '<p class="loading">Loading…</p>';
  try {
    state.data = normalize(await loadData());
    state.year ??= R.legionYearOf(R.todayISO());
    render();
  } catch (err) {
    if (err.status === 401) {
      clearPassword();
      renderLogin("That password didn't work.");
    } else {
      app.innerHTML = `<div class="login"><h1>Can't load data</h1><p class="error">${esc(err.message)}</p><button class="primary" data-action="retry">Try again</button></div>`;
    }
  }
}

async function persist(mutate) {
  const next = structuredClone(state.data);
  mutate(next);
  try {
    state.data = normalize(await saveData(next));
    render();
    return true;
  } catch (err) {
    if (err.status === 401) {
      clearPassword();
      itemDialog.close();
      settingsDialog.close();
      importDialog.close();
      renderLogin('Signed out. Enter the password again.');
    } else if (err.status === 409 && err.data?.current) {
      state.data = normalize(err.data.current);
      render();
      toast('This changed somewhere else. Loaded the latest copy, make your edit again.');
    } else {
      toast(err.message);
    }
    return false;
  }
}

// ---------- screens ----------

function renderLogin(message = '') {
  app.innerHTML = `
    <form class="login" id="login-form">
      <img class="login-logo" src="assets/hbg.svg" alt="Hawkbat Garrison logo">
      <h1>Merch tracker</h1>
      <p class="sub">Enter the password set in Vercel.</p>
      ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
      <label>Password <input type="password" name="pw" required autocomplete="current-password" autofocus></label>
      <button class="primary" type="submit">Sign in</button>
    </form>`;
}

function render() {
  const { items, settings } = state.data;
  const today = R.todayISO();
  const limit = Number(settings.slotsPerYear) || R.DEFAULT_SETTINGS.slotsPerYear;
  const current = R.legionYearOf(today);

  const years = new Set([current, state.year]);
  items.forEach((i) => { const y = R.legionYearOf(R.slotDate(i)); if (y !== null) years.add(y); });
  const yearOptions = Object.fromEntries([...years].sort((a, b) => b - a).map((y) => [y, R.legionYearLabel(y)]));

  const range = R.legionYearRange(state.year);
  const summary = R.slotSummary(items, state.year, limit);
  const flags = R.attention(items, settings, today);
  const yearItems = items
    .filter((i) => R.legionYearOf(R.slotDate(i)) === state.year)
    .sort(R.workOrder);

  const freeze = R.inFreeze(today)
    ? `<p class="banner">Election freeze. The LMBO isn't taking new merch submissions until the new term's officers are ratified, around ${R.formatDate(R.termStart(Number(today.slice(0, 4))))}.</p>`
    : '';

  const cells = summary.cells.map((c, i) => {
    const num = `<span class="bay-num">Slot ${i + 1}${c.over ? ', over limit' : ''}</span>`;
    if (c.kind === 'empty') {
      return `<li><div class="bay open">${num}<span class="bay-name">Open</span></div></li>`;
    }
    const tag = c.kind === 'planned' ? 'Planned' : c.part;
    return `<li><button class="bay ${c.kind}${c.over ? ' over' : ''}" data-edit="${esc(c.itemId)}">
      ${num}<span class="bay-name">${esc(c.name)}</span>${tag ? `<span class="bay-tag">${esc(tag)}</span>` : ''}
    </button></li>`;
  }).join('');

  const flagList = flags.length
    ? `<ul class="flags">${flags.map((f) => {
        const item = f.itemId && items.find((i) => i.id === f.itemId);
        const act = item && R.nextAction(item);
        return `<li class="flag ${f.level}">
          ${item ? `<button class="flag-body" data-edit="${esc(f.itemId)}">` : '<div class="flag-body">'}
            <span class="flag-name">${esc(f.name)}</span><span>${esc(f.message)}</span>
          ${item ? '</button>' : '</div>'}
          ${act ? `<button class="step" data-advance="${esc(f.itemId)}">${act.label}</button>` : ''}
        </li>`;
      }).join('')}</ul>`
    : '<p class="empty">Nothing open. Receipts are in and no deadlines are close.</p>';

  const rows = yearItems.map((it) => {
    const st = R.deriveStatus(it);
    const detail = it.type === 'event' && it.eventDate ? `<small>${esc(it.eventName || 'Event')}, ${R.formatDate(it.eventDate)}</small>`
      : it.type === 'memorial' && it.honoree ? `<small>${esc(it.honoree)}</small>` : '';
    return `<tr>
      <td><button class="row-link" data-edit="${esc(it.id)}">${esc(it.name)}</button>${it.variant ? `<small>Variant: ${esc(it.variant)}</small>` : ''}${(it.options || []).length ? `<small>${it.options.length} priced options</small>` : ''}</td>
      <td>${esc(R.TYPES[it.type] || it.type)}${detail}</td>
      <td class="num">${R.slotCost(it) || '<span class="muted">None</span>'}</td>
      <td><span class="pill ${st}">${R.STATUS_LABELS[st]}</span></td>
      <td>${R.nextAction(it)
        ? `<button class="step" data-advance="${esc(it.id)}" title="${esc(R.NEXT_STEP[st])}">${R.nextAction(it).label}</button>`
        : `<span class="muted">${R.NEXT_STEP[st]}</span>`}</td>
    </tr>`;
  }).join('');

  const table = yearItems.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Item</th><th>Type</th><th class="num">Slots</th><th>Status</th><th>Next step</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
    : '<p class="empty">No items logged for this Legion year. Add one when a design starts moving.</p>';

  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <img src="assets/hbg.svg" alt="" width="84" height="84">
        <div>
          <p class="legion">501st Legion</p>
          <h1>${esc(settings.unitName)}</h1>
          <p class="sub">Merch tracker. Legion year ${R.legionYearLabel(state.year)}: ${R.formatDate(range.start)} to ${R.formatDate(range.end)}</p>
        </div>
      </div>
      <div class="top-actions">
        <label class="inline">Year <select id="year-select">${options(yearOptions, state.year)}</select></label>
        <button data-action="settings">Settings</button>
        <button data-action="import">Import email</button>
        <button class="primary" data-action="add">Add item</button>
      </div>
    </header>
    <div class="stripe" aria-hidden="true"></div>
    ${freeze}
    <section>
      <div class="section-head">
        <h2>General merch slots</h2>
        <p class="count"><strong>${summary.used}</strong> of ${summary.limit} used${summary.planned ? `, ${summary.planned} planned` : ''}</p>
      </div>
      <ol class="rail">${cells}</ol>
    </section>
    <section>
      <h2>Needs attention</h2>
      ${flagList}
    </section>
    <section>
      <h2>Items this Legion year</h2>
      ${table}
    </section>
    <footer>
      <a class="link" href="/" target="_blank" rel="noopener">View member page</a>
      <button class="link" data-action="export">Download backup</button>
      <button class="link" data-action="logout">Sign out</button>
    </footer>`;
}

// ---------- item form ----------

function optionRow(option = {}) {
  return `<div class="option-row">
    <input name="optLabel" value="${esc(option.label || '')}" placeholder="Hoodie, 2XL, navy">
    <input name="optPrice" inputmode="decimal" value="${esc(option.price || '')}" placeholder="29.36">
    <button type="button" class="link remove-option" aria-label="Remove this option">Remove</button>
  </div>`;
}

function optionRows(item) {
  const rows = (item.options || []).filter((o) => o && (o.label || o.price));
  return (rows.length ? rows : []).map(optionRow).join('');
}

function dateField(item, key, label) {
  return `<label>${label}<input type="date" name="${key}" value="${esc(item[key] || '')}"></label>`;
}

function openItem(id, prefill = null) {
  const existing = id ? state.data.items.find((i) => i.id === id) : null;
  if (id && !existing) return;
  const it = prefill || existing || { type: 'general', setSize: 1, slotOwner: 'ours', created: R.todayISO() };
  const title = existing ? (prefill ? 'Update item from email' : 'Edit item') : (prefill ? 'Add item from email' : 'Add item');
  const v = (k) => esc(it[k] ?? '');

  itemDialog.innerHTML = `
    <form id="item-form">
      <h2>${title}</h2>
      ${prefill ? '<p class="hint">Filled in from the email. Check the type and dates, then save.</p>' : ''}
      <div class="grid">
        <label class="full">Item name <input name="name" required value="${v('name')}" placeholder="2026 racing shirt"></label>
        <label>Type <select name="type">${options(R.TYPES, it.type)}</select></label>
        <label>Outcome <select name="outcome">${options({ '': 'Active', denied: 'Denied', withdrawn: 'Withdrawn' }, it.outcome || '')}</select></label>

        <label data-for="general">Items in set <input name="setSize" type="number" min="1" step="1" value="${v('setSize') || 1}">
          <span class="hint">Each item in a set uses its own slot.</span></label>
        <label data-for="general">Whose slot <select name="slotOwner">${options({ ours: 'Ours', partner: "Partner unit's" }, it.slotOwner || 'ours')}</select>
          <span class="hint">Multi-unit items use one unit's slot.</span></label>
        <label data-for="general" class="full">Partner units <input name="partners" value="${v('partners')}" placeholder="Only for multi-unit items"></label>

        <label data-for="event">Event name <input name="eventName" value="${v('eventName')}"></label>
        <label data-for="event">Event date <input name="eventDate" type="date" value="${v('eventDate')}"></label>
        <label data-for="memorial" class="full">Honoree name or TK ID <input name="honoree" value="${v('honoree')}"></label>

        <label>Design variant <input name="variant" value="${v('variant')}" placeholder="One allowed per item"></label>
        <label>Quantity <input name="quantity" type="number" min="0" step="1" value="${v('quantity')}"></label>
        <label>Vendor <input name="vendor" value="${v('vendor')}"></label>
        <label>Price per piece <input name="price" inputmode="decimal" value="${v('price')}" placeholder="Leave blank if you list options below"></label>
        <fieldset class="full">
          <legend>Options priced separately</legend>
          <div id="option-rows">${optionRows(it)}</div>
          <button type="button" class="link" id="add-option">Add an option</button>
          <p class="hint">For sizes or styles that cost different amounts, like a tee and a hoodie. Members see each line with its own price.</p>
        </fieldset>
        <label class="full">Email subject <input name="emailSubject" value="${v('emailSubject')}" placeholder="So the approval thread is easy to find"></label>
        <label>CO email <input name="coEmail" type="email" value="${v('coEmail')}"></label>
        <label>Art link <input name="artUrl" type="text" value="${v('artUrl')}" placeholder="Pasted from the email, or uploaded below"></label>
        <div class="full">
          <span class="field-label">Upload art</span>
          <div class="drop" id="art-drop">
            <p class="drop-line">Drag art here, or <button type="button" class="link" id="art-pick">choose a file</button></p>
            <p class="hint" id="art-status">PNG, JPG, WEBP, GIF, SVG or PDF. Large images are shrunk first.</p>
          </div>
          <input type="file" id="art-file" class="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf">
        </div>
        <label class="full">Chipply store link <input name="chipplyUrl" type="url" value="${v('chipplyUrl')}" placeholder="Shown to members when ordering is open"></label>
        <label class="check full"><input type="checkbox" name="isPublic" ${it.isPublic === false ? '' : 'checked'}> Show this item on the member page</label>
        <label>Sale opens <input name="saleStart" type="date" value="${v('saleStart')}"></label>
        <label>Sale closes <input name="saleEnd" type="date" value="${v('saleEnd')}"></label>
        ${it.artUrl ? `<a class="art full" href="${v('artUrl')}" target="_blank" rel="noopener"><img src="${v('artUrl')}" alt="Submitted art for ${v('name')}"></a>` : ''}

        <fieldset class="full">
          <legend>Dates, fill in as they happen</legend>
          <div class="dates">
            ${dateField(it, 'coApproved', 'CO approved')}
            ${dateField(it, 'submitted', 'Sent to LMBO')}
            ${dateField(it, 'approved', 'LMBO approved')}
            ${dateField(it, 'produced', 'Produced and paid')}
            ${dateField(it, 'receiptSent', 'Receipt sent')}
          </div>
        </fieldset>

        <label class="full">Notes <textarea name="notes" rows="3">${v('notes')}</textarea></label>
      </div>
      <div class="form-actions">
        ${existing ? '<button type="button" class="danger" data-action="delete-item">Delete</button>' : '<span></span>'}
        <div>
          <button type="button" data-action="close-dialog">Cancel</button>
          <button type="submit" class="primary">Save item</button>
        </div>
      </div>
    </form>`;

  const form = itemDialog.querySelector('form');
  wireUpload(form);
  wireOptions(form);
  const typeSelect = form.elements.namedItem('type');
  const sync = () => form.querySelectorAll('[data-for]').forEach((el) => { el.hidden = el.dataset.for !== typeSelect.value; });
  typeSelect.addEventListener('change', sync);
  sync();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const labels = data.getAll('optLabel');
    const prices = data.getAll('optPrice');
    const options = labels
      .map((label, i) => ({ label: label.trim(), price: String(prices[i] ?? '').trim() }))
      .filter((o) => o.label || o.price);
    const fields = Object.fromEntries(data);
    delete fields.optLabel;
    delete fields.optPrice;
    const item = { ...it, ...fields, options, id: it.id || crypto.randomUUID(), name: fields.name.trim(), isPublic: 'isPublic' in fields };
    if (item.type !== 'general') { item.setSize = ''; item.slotOwner = 'ours'; item.partners = ''; }
    const saved = await persist((d) => {
      const i = d.items.findIndex((x) => x.id === item.id);
      if (i >= 0) d.items[i] = item; else d.items.push(item);
    });
    if (saved) {
      const y = R.legionYearOf(R.slotDate(item));
      if (y !== null && y !== state.year) { state.year = y; render(); }
      itemDialog.close();
      toast(`Saved ${item.name}.`);
    }
  });

  form.querySelector('[data-action="delete-item"]')?.addEventListener('click', async () => {
    if (!confirm(`Delete ${it.name}? This can't be undone from here.`)) return;
    if (await persist((d) => { d.items = d.items.filter((x) => x.id !== it.id); })) {
      itemDialog.close();
      toast(`Deleted ${it.name}.`);
    }
  });

  itemDialog.showModal();
}

// ---------- option rows ----------

function wireOptions(form) {
  const rows = form.querySelector('#option-rows');
  if (!rows) return;
  form.querySelector('#add-option').addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', optionRow());
    rows.lastElementChild.querySelector('input').focus();
  });
  rows.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-option')) e.target.closest('.option-row').remove();
  });
}

// ---------- art upload ----------

// Shrinks anything big so the data repo doesn't fill up with 12 MB photos.
function shrink(file) {
  const skip = file.type === 'image/svg+xml' || file.type === 'application/pdf' || file.type === 'image/gif';
  if (skip || file.size < 900 * 1024) return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(img.src);
        resolve(blob && blob.size < file.size ? new File([blob], file.name, { type: 'image/jpeg' }) : file);
      }, 'image/jpeg', 0.86);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error("Couldn't read that file."));
  reader.readAsDataURL(file);
});

function wireUpload(form) {
  const input = form.querySelector('#art-file');
  const drop = form.querySelector('#art-drop');
  const status = form.querySelector('#art-status');
  if (!input || !drop) return;

  async function send(file) {
    if (!file || input.disabled) return;
    input.disabled = true;
    drop.classList.remove('over');
    drop.classList.add('busy');
    status.textContent = `Uploading ${file.name}…`;
    try {
      const ready = await shrink(file);
      const { url } = await uploadArt({ name: ready.name, type: ready.type, data: await toBase64(ready) });
      form.elements.namedItem('artUrl').value = url;
      const preview = form.querySelector('.art img');
      if (preview) preview.src = url;
      status.textContent = 'Uploaded. Save the item to keep it.';
      drop.classList.add('done');
    } catch (err) {
      status.textContent = err.message;
      drop.classList.remove('done');
    } finally {
      input.value = '';
      input.disabled = false;
      drop.classList.remove('busy');
    }
  }

  form.querySelector('#art-pick').addEventListener('click', () => input.click());
  input.addEventListener('change', () => send(input.files[0]));

  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    send(e.dataTransfer.files[0]);
  });

  // Paste a screenshot straight in while the dialog is open.
  form.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files || [])][0];
    if (file) { e.preventDefault(); send(file); }
  });
}

// ---------- import from the LMBO confirmation email ----------

function openImport() {
  importDialog.innerHTML = `
    <form id="import-form">
      <h2>Import approval email</h2>
      <p class="hint">Copy the whole confirmation email and paste it here. Nothing saves until you review the item.</p>
      <label class="full">Email text <textarea name="text" rows="12" required></textarea></label>
      <p class="error" id="import-error" hidden></p>
      <div class="form-actions">
        <span></span>
        <div>
          <button type="button" data-action="close-dialog">Cancel</button>
          <button type="submit" class="primary">Read email</button>
        </div>
      </div>
    </form>`;

  importDialog.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = R.parseApprovalEmail(new FormData(e.target).get('text'));
    if (!parsed) {
      const err = importDialog.querySelector('#import-error');
      err.textContent = "Couldn't find a merchandise project name. Paste the full confirmation email.";
      err.hidden = false;
      return;
    }
    const match = state.data.items.find((i) => i.name.trim().toLowerCase() === parsed.name.toLowerCase());
    importDialog.close();
    if (match) openItem(match.id, R.mergeImport(match, parsed));
    else openItem(null, { setSize: 1, slotOwner: 'ours', created: R.todayISO(), ...parsed });
  });

  importDialog.showModal();
}

// ---------- settings ----------

function openSettings() {
  const s = state.data.settings;
  settingsDialog.innerHTML = `
    <form id="settings-form">
      <h2>Settings</h2>
      <div class="grid">
        <label class="full">Unit name <input name="unitName" required value="${esc(s.unitName)}"></label>
        <label>General slots per Legion year <input name="slotsPerYear" type="number" min="1" step="1" required value="${esc(s.slotsPerYear)}">
          <span class="hint">The Operating Protocols give Garrisons five.</span></label>
        <label>LFL quantity threshold <input name="lflThreshold" type="number" min="0" step="1" value="${esc(s.lflThreshold)}">
          <span class="hint">From the LFL Merchandise Guidelines thread. Blank turns the check off.</span></label>
        <label>Warn this many days before an event <input name="eventWarnDays" type="number" min="1" step="1" value="${esc(s.eventWarnDays)}"></label>
      </div>
      <div class="form-actions">
        <span></span>
        <div>
          <button type="button" data-action="close-dialog">Cancel</button>
          <button type="submit" class="primary">Save settings</button>
        </div>
      </div>
    </form>`;

  settingsDialog.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const settings = {
      unitName: f.unitName.trim(),
      slotsPerYear: Math.max(1, parseInt(f.slotsPerYear, 10) || R.DEFAULT_SETTINGS.slotsPerYear),
      lflThreshold: f.lflThreshold === '' ? '' : Math.max(0, parseInt(f.lflThreshold, 10) || 0),
      eventWarnDays: Math.max(1, parseInt(f.eventWarnDays, 10) || R.DEFAULT_SETTINGS.eventWarnDays),
    };
    if (await persist((d) => { d.settings = settings; })) {
      settingsDialog.close();
      toast('Saved settings.');
    }
  });

  settingsDialog.showModal();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `merch-backup-${R.todayISO()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- events ----------

document.addEventListener('click', (e) => {
  const adv = e.target.closest('[data-advance]');
  if (adv) return advance(adv.dataset.advance, adv);

  const edit = e.target.closest('[data-edit]');
  if (edit) return openItem(edit.dataset.edit);

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'add') openItem(null);
  else if (action === 'settings') openSettings();
  else if (action === 'import') openImport();
  else if (action === 'export') exportData();
  else if (action === 'retry') boot();
  else if (action === 'close-dialog') e.target.closest('dialog')?.close();
  else if (action === 'logout') { clearPassword(); state.data = null; renderLogin(); }
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'year-select') {
    state.year = Number(e.target.value);
    render();
  }
});

app.addEventListener('submit', (e) => {
  if (e.target.id === 'login-form') {
    e.preventDefault();
    setPassword(new FormData(e.target).get('pw'));
    boot();
  }
});

boot();
