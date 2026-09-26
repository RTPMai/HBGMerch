// Member interest survey.
//
// No password:
//   GET  /api/interest                open items + roster for the form
//   GET  /api/interest?member=5107    which open items that member already answered
//   POST /api/interest                { memberId, answers: { itemId: { "variant|size": n } } }
//
// Officer password (x-app-password):
//   GET    /api/interest?view=admin               every response and the roster
//   DELETE /api/interest?member=5107[&item=<id>]  clear an answer so they can redo it
//   PUT    /api/interest                          { rosterText } replaces the roster
//
// Responses live in interest.json in the data repo, apart from merch.json, so
// a member submitting never bumps the tracker's version out from under an
// officer mid-edit.

import { config, interestConfig, read, write } from './_store.js';
import * as I from '../js/interest.js';

const isOfficer = (req) => {
  const expected = process.env.APP_PASSWORD;
  return Boolean(expected) && req.headers['x-app-password'] === expected;
};

function normalize(data) {
  return {
    version: data.version || 0,
    roster: Array.isArray(data.roster) ? data.roster : null,
    responses: data.responses && typeof data.responses === 'object' ? data.responses : {},
  };
}

async function loadItems() {
  const { data } = await read(config());
  return { items: data.items || [], unitName: data.settings?.unitName || 'Hawkbat Garrison' };
}

async function loadInterest() {
  const { data, sha } = await read(interestConfig());
  return { interest: normalize(data), sha };
}

// Read, change, write, and retry if someone else wrote in between.
async function update(mutate, message) {
  const cfg = interestConfig();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { interest, sha } = await loadInterest();
    const result = mutate(interest);
    if (result?.error) return result;
    interest.version += 1;
    interest.updatedAt = new Date().toISOString();
    const { conflict } = await write(cfg, interest, sha, message);
    if (!conflict) return { interest, result };
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
  }
  return { error: 'Too many people saving at once. Try again in a few seconds.', status: 503 };
}

const body = (req) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // ---------- officer ----------
    if (req.query.view === 'admin' || req.method === 'DELETE' || req.method === 'PUT') {
      if (!process.env.APP_PASSWORD) return res.status(500).json({ error: 'APP_PASSWORD is not set in Vercel.' });
      if (!isOfficer(req)) return res.status(401).json({ error: 'Wrong password.' });

      if (req.method === 'GET') {
        const { interest } = await loadInterest();
        return res.status(200).json({ ...interest, roster: I.activeRoster(interest), customRoster: Boolean(interest.roster) });
      }

      if (req.method === 'DELETE') {
        const member = String(Number(req.query.member || ''));
        const item = req.query.item ? String(req.query.item) : '';
        if (!member || member === 'NaN') return res.status(400).json({ error: 'Which member?' });
        const out = await update((d) => {
          if (!d.responses[member]) return { error: 'That member has no answers to clear.', status: 404 };
          if (item) delete d.responses[member][item];
          if (!item || !Object.keys(d.responses[member]).length) delete d.responses[member];
          return null;
        }, `Clear interest for ${member}${item ? ' on one item' : ''}`);
        if (out.error) return res.status(out.status || 400).json({ error: out.error });
        return res.status(200).json({ ...out.interest, roster: I.activeRoster(out.interest), customRoster: Boolean(out.interest.roster) });
      }

      if (req.method === 'PUT') {
        const { rosterText, reset } = body(req);
        const roster = reset ? null : I.parseRoster(rosterText);
        if (!reset && !roster.length) return res.status(400).json({ error: 'No members found. Use one per line, like "TK 5107 Jason L Schuett".' });
        const out = await update((d) => { d.roster = roster; return null; }, reset ? 'Reset interest roster' : `Update interest roster (${roster.length} members)`);
        if (out.error) return res.status(out.status || 400).json({ error: out.error });
        return res.status(200).json({ ...out.interest, roster: I.activeRoster(out.interest), customRoster: Boolean(out.interest.roster) });
      }
    }

    // ---------- member ----------
    if (req.method === 'GET') {
      if (req.query.member) {
        const { interest } = await loadInterest();
        return res.status(200).json({ answered: I.answeredItemIds(interest.responses, req.query.member) });
      }
      const [{ items, unitName }, { interest }] = await Promise.all([loadItems(), loadInterest()]);
      return res.status(200).json({
        unitName,
        items: items.filter(I.isCollecting).map(I.publicInterestItem),
        roster: I.activeRoster(interest),
        maxPerChoice: I.MAX_PER_CHOICE,
      });
    }

    if (req.method === 'POST') {
      const { memberId, answers } = body(req);
      const { items } = await loadItems();
      let saved = null;
      const out = await update((d) => {
        const v = I.validateSubmission({ roster: I.activeRoster(d), items, responses: d.responses, memberId, answers });
        if (v.error) return { error: v.error, status: 409 };
        d.responses[v.memberId] = { ...(d.responses[v.memberId] || {}), ...v.entries };
        saved = v;
        return null;
      }, `Interest from ${String(Number(memberId))}`);
      if (out.error) return res.status(out.status || 400).json({ error: out.error });
      return res.status(200).json({ ok: true, items: Object.keys(saved.entries), any: saved.any });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
