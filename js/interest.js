// Member interest survey logic. No DOM, no fetches, so the browser, the Vercel
// function and node tests all share it.
//
// Interest is a gauge, not an order. Each member (by Legion ID) answers each
// open item once. An officer can clear an answer so the member can redo it.

import { deriveStatus, priceLines } from './rules.js';
import { DEFAULT_ROSTER_TEXT } from './roster.js';

export const MAX_PER_CHOICE = 25; // keeps a fat-fingered 500 from wrecking the totals
export const EMPTY_INTEREST = { version: 0, roster: null, responses: {} };

// ---------- roster ----------

// One member per line: "TK 5107 Jason L Schuett". Prefix and name are
// optional; the number is the Legion ID and is what we key on.
export function parseRoster(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z]{1,3})?[\s-]*(\d{1,6})\b[\s,:-]*(.*)$/);
    if (!m) continue;
    const id = String(Number(m[2]));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, prefix: (m[1] || '').toUpperCase(), name: m[3].trim() });
  }
  return out;
}

export function rosterToText(roster) {
  return roster.map((m) => [m.prefix, m.id, m.name].filter(Boolean).join(' ')).join('\n');
}

export function activeRoster(interest) {
  return Array.isArray(interest?.roster) && interest.roster.length
    ? interest.roster
    : parseRoster(DEFAULT_ROSTER_TEXT);
}

export function memberLabel(m) {
  if (!m) return '';
  const id = `${m.prefix ? `${m.prefix} ` : ''}${m.id}`;
  return m.name ? `${m.name} (${id})` : `Private member (${id})`;
}

// Loose match on name, number, or prefix+number ("tk5107", "TK 5107").
export function searchRoster(roster, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const compact = q.replace(/\s+/g, '');
  const words = q.split(/\s+/);
  return roster
    .map((m) => {
      const name = m.name.toLowerCase();
      const tag = `${m.prefix}${m.id}`.toLowerCase();
      let score = 0;
      if (m.id === compact || tag === compact) score = 100;
      else if (m.id.startsWith(compact) || tag.startsWith(compact)) score = 60;
      else if (words.every((w) => name.includes(w))) score = name.startsWith(words[0]) ? 50 : 40;
      return { m, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name))
    .slice(0, limit)
    .map((r) => r.m);
}

// ---------- items ----------

export function parseSizes(text) {
  return String(text || '')
    .split(/[,/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, a) => a.indexOf(s) === i);
}

// Interest is on by default until an item is produced. An officer's explicit
// choice (collectInterest true or false) always wins, except that denied and
// withdrawn items never collect.
const DEFAULT_ON = new Set(['draft', 'co_approved', 'submitted', 'approved']);

export function isCollecting(item) {
  if (!item) return false;
  const st = deriveStatus(item);
  if (st === 'denied' || st === 'withdrawn') return false;
  if (typeof item.collectInterest === 'boolean') return item.collectInterest;
  return DEFAULT_ON.has(st);
}

// Every combination a member can put a number on. Key is "variant|size",
// either side blank when the item has no variant or no sizes.
export function choices(item) {
  const variants = item.variant ? ['Standard', item.variant] : [''];
  const sizes = parseSizes(item.interestSizes);
  const sizeList = sizes.length ? sizes : [''];
  const out = [];
  for (const v of variants) for (const s of sizeList) out.push({ key: `${v}|${s}`, variant: v, size: s });
  return out;
}

export function choiceLabel(key) {
  const [v, s] = String(key).split('|');
  return [v, s].filter(Boolean).join(', ') || 'Quantity';
}

// What the member form gets. No vendor, notes, emails or anything officer-only.
export function publicInterestItem(item) {
  return {
    id: item.id,
    name: item.name,
    artUrl: item.artUrl || '',
    prices: priceLines(item),
    variant: item.variant || '',
    sizes: parseSizes(item.interestSizes),
    choices: choices(item),
    note: item.interestNote || '',
  };
}

// ---------- submissions ----------

function cleanCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PER_CHOICE) : 0;
}

// Checks a member submission and returns the entries to store, or an error.
// Blank answers are stored as zero so "not interested" still counts as a
// response. Items this member already answered are refused.
export function validateSubmission({ roster, items, responses, memberId, answers, now = new Date() }) {
  const id = String(Number(memberId));
  if (!memberId || !roster.some((m) => m.id === id)) {
    return { error: "That Legion ID isn't on the garrison roster. Ask the merch officer to add you." };
  }
  const open = items.filter(isCollecting);
  if (!open.length) return { error: 'Nothing is collecting interest right now.' };

  const already = responses[id] || {};
  const todo = open.filter((it) => !already[it.id]);
  if (!todo.length) return { error: "You've already answered for every open item. Ask the merch officer if you need to change something." };

  const at = now.toISOString();
  const entries = {};
  let any = false;
  for (const it of todo) {
    const given = (answers && answers[it.id]) || {};
    const counts = {};
    for (const c of choices(it)) {
      const n = cleanCount(given[c.key]);
      if (n) { counts[c.key] = n; any = true; }
    }
    entries[it.id] = { at, counts };
  }
  const skipped = Object.keys(answers || {}).filter((k) => already[k]);
  return { memberId: id, entries, any, skipped };
}

export function answeredItemIds(responses, memberId) {
  return Object.keys(responses[String(Number(memberId))] || {});
}

// ---------- tallies ----------

export function entryTotal(entry) {
  return Object.values(entry?.counts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

// Per item: how many members answered, how many want at least one, total
// pieces, and pieces per choice (in the item's own choice order).
export function tally(items, responses) {
  return items.map((it) => {
    const byChoice = Object.fromEntries(choices(it).map((c) => [c.key, 0]));
    let answered = 0;
    let wanting = 0;
    let total = 0;
    for (const perMember of Object.values(responses || {})) {
      const entry = perMember[it.id];
      if (!entry) continue;
      answered += 1;
      const t = entryTotal(entry);
      if (t > 0) wanting += 1;
      total += t;
      for (const [k, n] of Object.entries(entry.counts || {})) byChoice[k] = (byChoice[k] || 0) + n;
    }
    return { item: it, answered, wanting, total, byChoice };
  });
}

// ---------- export ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(items, responses, roster) {
  const byId = Object.fromEntries(roster.map((m) => [m.id, m]));
  const names = Object.fromEntries(items.map((i) => [i.id, i.name]));
  const rows = [['Legion ID', 'Prefix', 'Name', 'Item', 'Variant', 'Size', 'Quantity', 'Answered']];
  const ids = Object.keys(responses || {}).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const m = byId[id] || { id, prefix: '', name: '' };
    for (const [itemId, entry] of Object.entries(responses[id])) {
      const counts = Object.entries(entry.counts || {});
      const base = [id, m.prefix, m.name || 'Private member', names[itemId] || '(deleted item)'];
      if (!counts.length) rows.push([...base, '', '', 0, entry.at]);
      for (const [k, n] of counts) {
        const [v, s] = k.split('|');
        rows.push([...base, v, s, n, entry.at]);
      }
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
