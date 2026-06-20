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

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Storage not configured' });

  try {
    const body = JSON.stringify(safe);
    const blobRes = await fetch('https://blob.vercel-storage.com/travel-entries.json', {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${token}`,
        'x-api-version': '7',
        'content-type': 'application/json',
        'x-vercel-blob-access': 'private',
        'x-cache-control-max-age': '0',
      },
      body,
    });

    if (!blobRes.ok) {
      const detail = await blobRes.text();
      return res.status(500).json({ error: 'Blob write failed', detail });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
