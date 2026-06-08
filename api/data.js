import Redis from 'ioredis';

let redis;
function getRedis() {
    if (!redis) {
          redis = new Redis(process.env.REDIS_URL, {
                  tls: process.env.REDIS_URL && process.env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
                  maxRetriesPerRequest: 3,
          });
    }
    return redis;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
        return res.status(200).end();
  }

  const { key } = req.method === 'GET' ? req.query : (req.body || {});

  if (!key) {
        return res.status(400).json({ error: 'key is required' });
  }

  const client = getRedis();

  if (req.method === 'GET') {
        try {
                const raw = await client.get(key);
                const value = raw ? JSON.parse(raw) : null;
                return res.status(200).json({ value });
        } catch (e) {
                return res.status(500).json({ error: e.message });
        }
  }

  if (req.method === 'POST') {
        try {
                const { value } = req.body || {};
                await client.set(key, JSON.stringify(value));
                return res.status(200).json({ ok: true });
        } catch (e) {
                return res.status(500).json({ error: e.message });
        }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
