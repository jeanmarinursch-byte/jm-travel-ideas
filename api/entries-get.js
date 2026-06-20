import { list, head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { blobs } = await list({ prefix: 'travel-entries.json' });
    if (!blobs.length) return res.status(200).json({ entries: [] });

    // For private blobs, get a signed download URL via head()
    const blobInfo = await head(blobs[0].url);
    const dataRes = await fetch(blobInfo.downloadUrl);
    if (!dataRes.ok) return res.status(200).json({ entries: [] });
    const entries = await dataRes.json();
    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
