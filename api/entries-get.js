import { list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Storage not configured' });

  try {
    const { blobs } = await list({ prefix: 'travel-entries.json', token });
    if (!blobs.length) return res.status(200).json({ entries: [] });

    // Fetch private blob content server-side using the token for auth
    const dataRes = await fetch(blobs[0].url, {
      headers: { 'authorization': `Bearer ${token}` },
    });
    if (!dataRes.ok) return res.status(200).json({ entries: [] });
    const entries = await dataRes.json();
    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
