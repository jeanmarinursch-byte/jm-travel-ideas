export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // ── Step 1: Fetch public metadata from the social media URL ──────────────
  let metadata = `Source URL: ${url}\n`;

  try {
    // TikTok has a public oEmbed endpoint
    if (url.includes('tiktok.com')) {
      const oembed = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      if (oembed) {
        metadata += `Title: ${oembed.title || ''}\n`;
        metadata += `Author: ${oembed.author_name || ''}\n`;
      }
    }

    // Fetch the page and parse Open Graph / meta tags
    const page = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    }).catch(() => null);

    if (page && page.ok) {
      const html = await page.text();
      const get = (pattern) => html.match(pattern)?.[1]?.trim() || '';

      const title       = get(/property="og:title"\s+content="([^"]+)"/i)
                       || get(/content="([^"]+)"\s+property="og:title"/i)
                       || get(/<title>([^<]+)<\/title>/i);
      const description = get(/property="og:description"\s+content="([^"]+)"/i)
                       || get(/content="([^"]+)"\s+property="og:description"/i)
                       || get(/name="description"\s+content="([^"]+)"/i);
      const siteName    = get(/property="og:site_name"\s+content="([^"]+)"/i);

      if (title)       metadata += `Title: ${title}\n`;
      if (description) metadata += `Description: ${description}\n`;
      if (siteName)    metadata += `Platform: ${siteName}\n`;
    }
  } catch (_) {
    // best-effort — proceed with whatever we have
  }

  // ── Step 2: Send to Claude Haiku for structured extraction ────────────────
  const SYSTEM = `You extract travel inspiration data from social media post metadata.
Return ONLY a valid JSON object — no markdown fences, no explanation.

Known countries: Albania, Argentina, Bolivia, Chile, China, Hong Kong, Hungary, India, Indonesia, Italy, Japan, Kyrgyzstan, Laos, Malaysia, Mexico, Morocco, New York, Norway, Peru, Poland, Portugal, Slovenia, South Korea, Spain, Taiwan, Tajikistan, Thailand, USA, Uzbekistan.

Categories:
  Food       – restaurants, cafes, food markets, bakeries, street food, ice cream
  Drink      – bars, coffee shops, rooftop bars, cocktail spots
  Culture    – museums, temples, monuments, architecture, historical sites, galleries
  Activities – hiking, beaches, nature, sports, wellness, tours, day trips
  Shopping   – boutiques, markets, department stores, souvenirs
  Miscellaneous – anything that doesn't fit above

JSON schema:
{
  "name":       "specific place name, dish, or activity title",
  "country":    "country from the known list, or null",
  "city":       "city or district, or null",
  "category":   "Food|Drink|Culture|Activities|Shopping|Miscellaneous",
  "details":    "one concise sentence describing what was featured",
  "confidence": "high|medium|low"
}

If no travel information can be found, return: {"error": "no travel info found"}`;

  try {
    const claude = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Extract travel info from:\n\n${metadata}` }]
      })
    });

    if (!claude.ok) {
      const err = await claude.text();
      return res.status(502).json({ error: 'Claude API error', detail: err });
    }

    const claudeData = await claude.json();
    const raw = claudeData.content?.[0]?.text || '{}';

    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const extracted = JSON.parse(clean);
    return res.status(200).json(extracted);

  } catch (e) {
    return res.status(500).json({ error: 'Analysis failed', detail: e.message });
  }
}
