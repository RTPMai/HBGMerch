// GET returns the whole dataset, PUT replaces it. The dataset is small (a few
// dozen items a year) so it lives as one JSON file in a private GitHub repo.
// Every save is a commit, so the repo history is the audit trail and the undo.
// Keep the data in its own repo, not this one, or every save triggers a redeploy.

const API = 'https://api.github.com';
const EMPTY = { version: 0, items: [], settings: {} };

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) throw new Error('Storage is not configured. Set GITHUB_TOKEN and GITHUB_REPO in Vercel.');
  return {
    token,
    repo,
    branch: process.env.GITHUB_BRANCH || 'main',
    path: process.env.DATA_PATH || 'merch.json',
  };
}

function contentsUrl({ repo, path }) {
  return `${API}/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function gh(cfg, method, url, body) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'merch-tracker',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function read(cfg) {
  const res = await gh(cfg, 'GET', `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { data: { ...EMPTY }, sha: null };
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}). Check GITHUB_REPO and the token's access.`);
  const file = await res.json();
  const text = Buffer.from(file.content || '', 'base64').toString('utf8');
  return { data: text.trim() ? JSON.parse(text) : { ...EMPTY }, sha: file.sha };
}

async function write(cfg, data, sha) {
  const res = await gh(cfg, 'PUT', contentsUrl(cfg), {
    message: `Update merch data (v${data.version})`,
    content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
    branch: cfg.branch,
    ...(sha ? { sha } : {}),
  });
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}). The token needs Contents read and write.`);
  return { conflict: false };
}

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
