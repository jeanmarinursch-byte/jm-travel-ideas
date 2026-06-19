export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, image, mediaType, images } = req.body || {};
  if (!url && !image && !images) return res.status(400).json({ error: 'URL or image required' });

  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  const CATEGORIES = `Food, Drink, Culture, Activities, Shopping, Miscellaneous`;
  const COUNTRIES = `Albania, Argentina, Bolivia, Chile, China, Hong Kong, Hungary, India, Indonesia, Italy, Japan, Kyrgyzstan, Laos, Malaysia, Mexico, Morocco, New York, Norway, Peru, Poland, Portugal, Slovenia, South Korea, Spain, Taiwan, Tajikistan, Thailand, USA, Uzbekistan`;

  // ── IMAGE PATH (single or multiple) ──────────────────────────────────────
  const imageList = images || (image ? [{ data: image, mediaType: mediaType || 'image/jpeg' }] : null);

  if (imageList) {
    if (imageList.length > 20) {
      return res.status(400).json({ error: 'too_many_images', message: 'Maximum 20 screenshots per batch.' });
    }

    const SYSTEM = `You extract travel inspiration from screenshots of social media posts (Instagram, TikTok, etc).
You will receive one or more screenshots. Extract ALL distinct places, activities, restaurants, or experiences across ALL images.
Merge duplicate entries — if the same place appears in multiple screenshots, combine their details into one entry with the most complete information.
Return ONLY a valid JSON array — no markdown fences, no explanation.

Known countries: ${COUNTRIES}
Categories: ${CATEGORIES}
  Food – restaurants, cafes, food markets, bakeries, street food
  Drink – bars, coffee shops, rooftop bars, cocktail spots
  Culture – museums, temples, monuments, architecture, historical sites, galleries, religious sites
  Activities – hiking, beaches, nature, sports, wellness, tours, day trips, wildlife sanctuaries, animal experiences, rescue centres, national parks, waterfalls, viewpoints, boat trips
  Shopping – boutiques, markets, department stores, souvenirs
  Miscellaneous – anything else travel-related that doesn't fit above

Each item in the array:
{
  "name": "place name, landmark, or activity — include descriptive activities like 'Explore the Old Town', 'Night market visit', 'Sunrise hike' if no specific name is given",
  "country": "from known list or null",
  "city": "city or district or null",
  "category": "Food|Drink|Culture|Activities|Shopping|Miscellaneous",
  "details": "one concise sentence combining all relevant info"
}

Capture everything that could be a useful travel reminder — named venues, landmarks, AND descriptive experiences.
If no travel info found, return: []`;

    const imageBlocks = imageList.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data }
    }));

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
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: [
              ...imageBlocks,
              { type: 'text', text: `Extract and merge all travel places and activities from these ${imageList.length} screenshot${imageList.length > 1 ? 's' : ''}.` }
            ]
          }]
        })
      });

      if (!claude.ok) {
        const err = await claude.text();
        return res.status(502).json({ error: 'Claude API error', detail: err });
      }

      const claudeData = await claude.json();
      const raw = claudeData.content?.[0]?.text || '[]';
      const match = raw.match(/\[[\s\S]*\]/);
      let results;
      try {
        results = JSON.parse(match?.[0] || '[]');
      } catch {
        return res.status(500).json({ error: 'Analysis failed', detail: 'JSON parse error', raw });
      }

      // ── Semantic deduplication pass ───────────────────────────────────────
      if (results.length > 1) {
        const DEDUP_SYSTEM = `You are a travel data deduplicator.
You will receive a JSON array of travel places. Some entries may refer to the same physical place but be described differently (e.g. "Mount Phousi Sunset Viewpoint" and "Hike Phousi Hill" are the same place).
Merge any entries that refer to the same physical location or experience into a single entry with:
- The most descriptive name
- Combined details from all merged entries (one concise sentence)
- The correct category, country, city
Return ONLY the deduplicated JSON array — no markdown, no explanation.`;

        try {
          const dedup = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 2000,
              system: DEDUP_SYSTEM,
              messages: [{ role: 'user', content: JSON.stringify(results) }]
            })
          });
          if (dedup.ok) {
            const dedupData = await dedup.json();
            const dedupRaw = dedupData.content?.[0]?.text || '[]';
            const dedupMatch = dedupRaw.match(/\[[\s\S]*\]/);
            if (dedupMatch) {
              try { results = JSON.parse(dedupMatch[0]); } catch (_) {}
            }
          }
        } catch (_) {}
      }

      return res.status(200).json({ results });
    } catch (e) {
      return res.status(500).json({ error: 'Analysis failed', detail: e.message });
    }
  }

  // ── URL PATH ──────────────────────────────────────────────────────────────
  let metadata = `Source URL: ${url}\n`;
  let metadataFields = 0;
  let fetchFailed = false;

  try {
    if (url.includes('tiktok.com')) {
      const oembed = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      if (oembed) {
        metadata += `Title: ${oembed.title || ''}\n`;
        metadata += `Author: ${oembed.author_name || ''}\n`;
        metadataFields += 2;
      }
    }

    const page = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    }).catch(() => { fetchFailed = true; return null; });

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
      if (title)       { metadata += `Title: ${title}\n`; metadataFields++; }
      if (description) { metadata += `Description: ${description}\n`; metadataFields++; }
      if (siteName)    { metadata += `Platform: ${siteName}\n`; metadataFields++; }
    } else if (page && !page.ok) {
      return res.status(422).json({
        error: 'url_blocked',
        message: `This link is blocked by ${new URL(url).hostname} (${page.status}). Try uploading a screenshot instead.`
      });
    } else if (fetchFailed) {
      return res.status(422).json({
        error: 'url_unreachable',
        message: 'Could not reach this URL. It may be a short link or private post. Try uploading a screenshot instead.'
      });
    }
  } catch (_) {}

  if (metadataFields === 0) {
    return res.status(422).json({
      error: 'no_metadata',
      message: 'No readable content found at this URL — it may be a short link, private post, or app-only link. Try uploading a screenshot instead.'
    });
  }

  const SYSTEM = `You extract travel inspiration data from social media post metadata.
Return ONLY a valid JSON object — no markdown fences, no explanation.

Known countries: ${COUNTRIES}
Categories: ${CATEGORIES}

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
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
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
    const match = raw.match(/\{[\s\S]*\}/);
    try {
      const extracted = JSON.parse(match?.[0] || '{}');
      if (extracted.error === 'no travel info found') {
        return res.status(422).json({
          error: 'no_travel_info',
          message: 'No travel information found in this post. The content may not be travel-related. Try uploading a screenshot instead.'
        });
      }
      return res.status(200).json(extracted);
    } catch {
      return res.status(500).json({
        error: 'parse_failed',
        message: 'Unexpected response from AI. Please try again.'
      });
    }
  } catch (e) {
    return res.status(500).json({ error: 'request_failed', message: 'Request failed. Check your connection and try again.' });
  }
}
