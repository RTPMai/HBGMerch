// Shared GitHub storage helpers. The leading underscore keeps Vercel from
// routing this file as an endpoint.

const API = 'https://api.github.com';
const EMPTY = { version: 0, items: [], settings: {} };

export function config() {
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

export async function read(cfg) {
  const res = await gh(cfg, 'GET', `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return { data: { ...EMPTY }, sha: null };
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}). Check GITHUB_REPO and the token's access.`);
  const file = await res.json();
  const text = Buffer.from(file.content || '', 'base64').toString('utf8');
  return { data: text.trim() ? JSON.parse(text) : { ...EMPTY }, sha: file.sha };
}

export async function write(cfg, data, sha) {
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


// ---------- binary files (art) ----------

export async function readFile(cfg, filePath) {
  const url = `${contentsUrl({ repo: cfg.repo, path: filePath })}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github.raw',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'merch-tracker',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

export async function writeFile(cfg, filePath, base64, message) {
  const res = await gh(cfg, 'PUT', contentsUrl({ repo: cfg.repo, path: filePath }), {
    message,
    content: base64,
    branch: cfg.branch,
  });
  if (!res.ok) throw new Error(`GitHub upload failed (${res.status}). The token needs Contents read and write.`);
  return res.json();
}
