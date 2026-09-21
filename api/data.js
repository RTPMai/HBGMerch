// GET returns the whole dataset, PUT replaces it. The dataset is small (a few
// dozen items a year) so it lives as one JSON value in Upstash Redis. Talks to
// Upstash over its REST API with fetch, so there are no dependencies.

const KEY = process.env.MERCH_DATA_KEY || 'merch-tracker:data';
const EMPTY = { version: 0, items: [], settings: {} };

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Storage is not configured. Connect an Upstash Redis database to this project in Vercel.');
  }
  return { url, token };
}

async function redis(command) {
  const { url, token } = creds();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Storage request failed (${res.status})`);
  return json.result;
}

async function read() {
  const raw = await redis(['GET', KEY]);
  return raw ? JSON.parse(raw) : { ...EMPTY };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const expected = process.env.APP_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'APP_PASSWORD is not set in Vercel.' });
  if (req.headers['x-app-password'] !== expected) return res.status(401).json({ error: 'Wrong password.' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await read());
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.items)) {
        return res.status(400).json({ error: 'Expected { version, items, settings }.' });
      }
      const current = await read();
      if ((body.version || 0) !== (current.version || 0)) {
        return res.status(409).json({ error: 'Data changed since you loaded it.', current });
      }
      const next = {
        version: (current.version || 0) + 1,
        updatedAt: new Date().toISOString(),
        items: body.items,
        settings: body.settings || {},
      };
      // Keep the previous copy around as a one-step undo.
      await redis(['SET', `${KEY}:previous`, JSON.stringify(current)]);
      await redis(['SET', KEY, JSON.stringify(next)]);
      return res.status(200).json(next);
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
