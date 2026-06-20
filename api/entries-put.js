import { put } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

  // Strip to only allowed travel fields — no PII, no financial data, ever
  const safe = entries.map(e => ({
    name:     String(e.name     || '').slice(0, 200),
    country:  String(e.country  || '').slice(0, 100),
    city:     String(e.city     || '').slice(0, 100),
    category: String(e.category || '').slice(0, 50),
    details:  String(e.details  || '').slice(0, 500),
  }));

  try {
    await put('travel-entries.json', JSON.stringify(safe), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
