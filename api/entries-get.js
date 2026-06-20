export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'Storage not configured' });

  try {
    // List blobs to find travel-entries.json
    const listRes = await fetch(
      'https://blob.vercel-storage.com/?prefix=travel-entries.json&limit=1',
      {
        headers: {
          'authorization': `Bearer ${token}`,
          'x-api-version': '7',
        },
      }
    );

    if (!listRes.ok) {
      const detail = await listRes.text();
      return res.status(500).json({ error: 'Blob list failed', detail });
    }

    const listData = await listRes.json();
    const blobs = listData.blobs || [];
    if (!blobs.length) return res.status(200).json({ entries: [] });

    // Fetch the blob content using its download URL (works for both public and private)
    const blob = blobs[0];
    const downloadUrl = blob.downloadUrl || blob.url;
    const dataRes = await fetch(downloadUrl, {
      headers: blob.downloadUrl ? {} : { 'authorization': `Bearer ${token}` },
    });

    if (!dataRes.ok) return res.status(200).json({ entries: [] });
    const entries = await dataRes.json();
    return res.status(200).json({ entries });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
