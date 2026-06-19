export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Blob not configured' });

  try {
    // List blobs to find our entries file
    const listRes = await fetch(
      `https://blob.vercel-storage.com?prefix=travel-entries.json`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const blob = listData.blobs?.[0];

    if (!blob) return res.status(200).json({ entries: [] });

    const dataRes = await fetch(blob.url);
    const entries = await dataRes.json();
    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
