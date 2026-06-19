export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Blob not configured' });

  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

  try {
    const putRes = await fetch(
      `https://blob.vercel-storage.com/travel-entries.json`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-content-type': 'application/json',
          'x-allow-overwrite': 'true',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(entries)
      }
    );

    if (!putRes.ok) {
      const err = await putRes.text();
      return res.status(502).json({ error: 'Blob write failed', detail: err });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
