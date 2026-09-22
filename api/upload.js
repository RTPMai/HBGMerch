// Takes an image from the officer page and commits it to the data repo.
// Password protected. The file is served back through api/art.js.

import { config, writeFile } from './_store.js';

const TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

const MAX_BYTES = 4 * 1024 * 1024;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'APP_PASSWORD is not set in Vercel.' });
  if (req.headers['x-app-password'] !== expected) return res.status(401).json({ error: 'Wrong password.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ext = TYPES[body?.type];
    if (!ext) return res.status(400).json({ error: 'Use a PNG, JPG, WEBP, GIF, SVG or PDF.' });
    const base64 = String(body.data || '');
    if (!base64) return res.status(400).json({ error: 'No file data received.' });
    if (Buffer.byteLength(base64, 'base64') > MAX_BYTES) {
      return res.status(413).json({ error: 'That file is over 4 MB. Shrink it and try again.' });
    }

    const stem = String(body.name || 'art').replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'art';
    const file = `${Date.now()}-${stem}.${ext}`;
    await writeFile(config(), `art/${file}`, base64, `Add art ${file}`);
    return res.status(200).json({ url: `/api/art?f=${encodeURIComponent(file)}`, file });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
