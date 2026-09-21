// Every network call goes through here.

const PW_KEY = 'merch-tracker-password';

export function getPassword() {
  try { return localStorage.getItem(PW_KEY); } catch { return null; }
}

export function setPassword(pw) {
  try { localStorage.setItem(PW_KEY, pw); } catch { /* private mode */ }
}

export function clearPassword() {
  try { localStorage.removeItem(PW_KEY); } catch { /* private mode */ }
}

async function call(method, body) {
  const res = await fetch('/api/data', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-app-password': getPassword() || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json;
}

export const loadData = () => call('GET');
export const saveData = (data) => call('PUT', data);
