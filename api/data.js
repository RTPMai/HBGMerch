// GET returns the whole dataset, PUT replaces it. Password protected: this is
// the officer side. The member side is api/public.js.

import { config, read, write } from './_store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'APP_PASSWORD is not set in Vercel.' });
  if (req.headers['x-app-password'] !== expected) return res.status(401).json({ error: 'Wrong password.' });

  try {
    const cfg = config();

    if (req.method === 'GET') {
      const { data } = await read(cfg);
      return res.status(200).json(data);
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.items)) {
        return res.status(400).json({ error: 'Expected { version, items, settings }.' });
      }
      const { data: current, sha } = await read(cfg);
      if ((body.version || 0) !== (current.version || 0)) {
        return res.status(409).json({ error: 'Data changed since you loaded it.', current });
      }
      const next = {
        version: (current.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        items: body.items,
        settings: body.settings || {},
      };
      const { conflict } = await write(cfg, next, sha);
      if (conflict) {
        const latest = await read(cfg);
        return res.status(409).json({ error: 'Data changed since you loaded it.', current: latest.data });
      }
      return res.status(200).json(next);
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
