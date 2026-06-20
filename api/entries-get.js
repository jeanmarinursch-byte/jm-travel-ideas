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

    const blob = blobs[0];
    // Try downloadUrl first, fall back to url with auth header
    const urls = [blob.downloadUrl, blob.url].filter(Boolean);

    for (const url of urls) {
      const dataRes = await fetch(url, {
        headers: { 'authorization': `Bearer ${token}` },
      });
      if (dataRes.ok) {
        const text = await dataRes.text();
        try {
          const entries = JSON.parse(text);
          return res.status(200).json({ entries });
        } catch {
          continue;
        }
      }
    }

    // Debug: return blob metadata so we can diagnose
    return res.status(200).json({
      entries: [],
      _debug: { url: blob.url, hasDownloadUrl: !!blob.downloadUrl }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
