// All 501st merch rule logic lives here. No DOM, no fetches, so it runs in the
// browser and in node tests. Dates are ISO strings (YYYY-MM-DD) handled in UTC.

export const TYPES = {
  general: 'General',
  basic: 'Basic',
  event: 'Special event',
  memorial: 'Memorial',
  pr: 'PR material',
};

export const STATUS_LABELS = {
  draft: 'Planning',
  co_approved: 'CO approved',
  submitted: 'Sent to LMBO',
  approved: 'Approved',
  produced: 'Produced',
  receipt_sent: 'Receipt sent',
  denied: 'Denied',
  withdrawn: 'Withdrawn',
};

export const NEXT_STEP = {
  draft: 'Get CO approval',
  co_approved: 'Submit to LMBO',
  submitted: 'Waiting on LMBO',
  approved: 'Produce and pay',
  produced: 'Reply to approval with receipt',
  receipt_sent: 'Done',
  denied: 'None',
  withdrawn: 'None',
};

export const DEFAULT_SETTINGS = {
  unitName: 'Hawkbat Garrison',
  slotsPerYear: 5, // OP Section 4: Garrisons get five General slots per Legion year
  lflThreshold: '',
  eventWarnDays: 21,
};

const DAY = 86400000;

export function parseISO(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d) {
  return d.toISOString().slice(0, 10);
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function formatDate(value) {
  const d = typeof value === 'string' ? parseISO(value) : value;
  if (!d) return '';
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

export function addDays(d, n) {
  return new Date(d.getTime() + n * DAY);
}

export function addMonths(d, n) {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / DAY);
}

// Legion year. Elections start on the first Saturday of February (Day 1) and the
// new term takes office on Day 17. Merch submissions freeze from Day 1 until
// officers are ratified; we treat Day 1 through Day 16 as the freeze.
export function electionDay1(year) {
  const feb1 = new Date(Date.UTC(year, 1, 1));
  return addDays(feb1, (6 - feb1.getUTCDay() + 7) % 7);
}

export function termStart(year) {
  return addDays(electionDay1(year), 16);
}

export function legionYearOf(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  const y = d.getUTCFullYear();
  return d >= termStart(y) ? y : y - 1;
}

export function legionYearRange(y) {
  return { start: termStart(y), end: addDays(termStart(y + 1), -1) };
}

export function legionYearLabel(y) {
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function inFreeze(iso) {
  const d = parseISO(iso);
  if (!d) return false;
  const y = d.getUTCFullYear();
  return d >= electionDay1(y) && d < termStart(y);
}

// Status comes from the dates filled in, so there is only one thing to update.
export function deriveStatus(item) {
  if (item.outcome === 'denied') return 'denied';
  if (item.outcome === 'withdrawn') return 'withdrawn';
  if (item.receiptSent) return 'receipt_sent';
  if (item.produced) return 'produced';
  if (item.approved) return 'approved';
  if (item.submitted) return 'submitted';
  if (item.coApproved) return 'co_approved';
  return 'draft';
}

// Which Legion year an item belongs to.
export function slotDate(item) {
  return item.submitted || item.coApproved || item.created;
}

// Only General items use slots. Each item in a set is its own slot. Multi-unit
// items can use a partner unit's slot instead of ours.
export function slotCost(item) {
  if (item.type !== 'general' || item.slotOwner === 'partner') return 0;
  return Math.max(1, Math.floor(Number(item.setSize)) || 1);
}

export function slotSummary(items, year, limit) {
  let used = 0;
  let planned = 0;
  const usedCells = [];
  const plannedCells = [];

  for (const it of items) {
    if (legionYearOf(slotDate(it)) !== year) continue;
    const cost = slotCost(it);
    if (!cost) continue;
    const st = deriveStatus(it);
    if (st === 'denied' || st === 'withdrawn') continue;
    const target = st === 'draft' ? plannedCells : usedCells;
    for (let i = 0; i < cost; i++) {
      target.push({ itemId: it.id, name: it.name, part: cost > 1 ? `${i + 1} of ${cost}` : '' });
    }
    if (st === 'draft') planned += cost;
    else used += cost;
  }

  const cells = [
    ...usedCells.map((c) => ({ ...c, kind: 'used' })),
    ...plannedCells.map((c) => ({ ...c, kind: 'planned' })),
  ];
  cells.forEach((c, i) => { c.over = i >= limit; });
  while (cells.length < limit) cells.push({ kind: 'empty', over: false });

  return { used, planned, limit, remaining: limit - used - planned, cells };
}

export function attention(items, settings, todayIso) {
  const today = parseISO(todayIso);
  const warnDays = Number(settings.eventWarnDays) || 21;
  const lfl = Number(settings.lflThreshold) || 0;
  const limit = Number(settings.slotsPerYear) || DEFAULT_SETTINGS.slotsPerYear;
  const out = [];
  const add = (item, level, message) => out.push({ itemId: item.id, name: item.name, level, message });

  for (const it of items) {
    const st = deriveStatus(it);
    if (st === 'denied' || st === 'withdrawn') continue;

    if (st === 'produced') {
      add(it, 'danger', "Produced, but the receipt hasn't gone back to the LMBO yet.");
    }
    if (['submitted', 'approved', 'produced', 'receipt_sent'].includes(st) && !it.coApproved) {
      add(it, 'warn', 'No CO approval date recorded.');
    }
    if (it.submitted && inFreeze(it.submitted) && !it.approved) {
      add(it, 'warn', "Submitted during the election freeze. The LMBO won't consider it, so resubmit after ratification.");
    }
    if (lfl && Number(it.quantity) > lfl && it.type !== 'pr') {
      add(it, 'warn', `Quantity ${it.quantity} is over the LFL threshold of ${lfl} and needs LFL approval.`);
    }

    if (it.type === 'event') {
      const ev = parseISO(it.eventDate);
      if (!ev) {
        add(it, 'warn', 'Event item has no event date.');
      } else {
        const done = st === 'produced' || st === 'receipt_sent';
        const opens = addMonths(ev, -6);
        const left = daysBetween(today, ev);
        if (!done && left < 0) {
          add(it, 'danger', 'The event has passed. Event merch has to be produced before the event.');
        } else if (!done && left <= warnDays) {
          const when = left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`;
          add(it, 'warn', `Event is ${when} and this isn't produced yet.`);
        }
        const sub = parseISO(it.submitted);
        if (sub && sub < opens) {
          add(it, 'warn', `Submitted before the 6-month window opened on ${formatDate(opens)}.`);
        } else if (!sub && today < opens) {
          add(it, 'info', `Can be submitted starting ${formatDate(opens)}.`);
        }
      }
    }

    if (it.type === 'memorial' && !String(it.honoree || '').trim()) {
      add(it, 'warn', 'Memorial items need the name or TK ID of the person honored.');
    }
  }

  const years = new Set(items.map((i) => legionYearOf(slotDate(i))).filter((y) => y !== null));
  for (const y of years) {
    const s = slotSummary(items, y, limit);
    const name = `Legion year ${legionYearLabel(y)}`;
    if (s.used > s.limit) {
      out.push({ itemId: null, name, level: 'danger', message: `${s.used} slots used, the limit is ${s.limit}.` });
    } else if (s.used + s.planned > s.limit) {
      out.push({ itemId: null, name, level: 'warn', message: `Planned items would bring this year to ${s.used + s.planned} of ${s.limit} slots.` });
    }
  }

  const order = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
