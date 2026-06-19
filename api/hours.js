export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, city, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Place name required' });

  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const place = [name, city, country].filter(Boolean).join(', ');

  const SYSTEM = `You are a travel assistant with knowledge of opening hours for cultural sites worldwide.
Return ONLY a valid JSON object — no markdown fences, no explanation.

JSON schema:
{
  "hours": "e.g. Daily 8am–5pm  or  Tue–Sun 9am–6pm",
  "closed": "e.g. Mondays, or null if open every day",
  "notes": "any important info: last entry time, prayer times, dress code, ticket required — one sentence max, or null",
  "confidence": "high|medium|low"
}

If you have no reliable information about this specific place, return:
{"hours": null, "closed": null, "notes": null, "confidence": "low"}`;

  try {
    const claude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: 'user', content: `What are the opening hours for: ${place}?` }]
      })
    });

    if (!claude.ok) {
      return res.status(502).json({ error: 'Claude API error' });
    }

    const data = await claude.json();
    const raw = data.content?.[0]?.text || '{}';
    const match = raw.match(/\{[\s\S]*\}/);
    try {
      return res.status(200).json(JSON.parse(match?.[0] || '{}'));
    } catch {
      return res.status(500).json({ error: 'Parse error' });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
