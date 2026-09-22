// Serves an uploaded art file out of the private data repo so the member page
// can show it without the repo being public.

import { config, readFile } from './_store.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const name = String(req.query.f || '');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
    return res.status(400).json({ error: 'Bad file name.' });
  }
  const type = MIME[name.split('.').pop().toLowerCase()];
  if (!type) return res.status(400).json({ error: 'Unsupported file type.' });

  try {
    const bytes = await readFile(config(), `art/${name}`);
    if (!bytes) return res.status(404).json({ error: 'Not found.' });
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(bytes);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
