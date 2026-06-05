import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  // Allow CORS for same-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { key } = req.method === 'GET' ? req.query : req.body;

  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }

  if (req.method === 'GET') {
    try {
      const value = await kv.get(key);
      return res.status(200).json({ value: value ?? null });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { value } = req.body;
      await kv.set(key, value);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
