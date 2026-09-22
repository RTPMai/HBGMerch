// Read-only endpoint for the member page. No password, and it never sends the
// fields members shouldn't see.

import { config, read } from './_store.js';
import { publicItem } from '../js/rules.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  try {
    const { data } = await read(config());
    const items = (data.items || []).map(publicItem).filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ unitName: data.settings?.unitName || 'Hawkbat Garrison', items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
