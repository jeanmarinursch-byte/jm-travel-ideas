export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, image, mediaType, images } = req.body || {};
  if (!url && !image && !images) return res.status(400).json({ error: 'URL or image required' });

  const apiKey = process.env.ANTHROPIC_API_KEY || '';

  const CATEGORIES = `Food, Drink, Culture, Activities, Shopping, Stays, Miscellaneous`;
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
  Culture – museums, temples, monuments, architecture, historical sites, galleries, religious sites, musicals, theater, plays, opera, concerts, live music, DJ sets, festivals, performing arts venues
  Activities – hiking, beaches, nature, sports, wellness, tours, day trips, wildlife sanctuaries, animal experiences, rescue centres, national parks, regional parks, nature reserves, protected areas, waterfalls, viewpoints, boat trips, water parks, amusement parks, theme parks, casinos, entertainment complexes
  Shopping – boutiques, markets, department stores, souvenirs
  Stays – hotels, guesthouses, hostels, ryokans, riads, resorts, lodges, villas, homestays
  Miscellaneous – anything else travel-related that doesn't fit above

Each item in the array:
{
  "name": "place name, landmark, or activity — include descriptive activities like 'Explore the Old Town', 'Night market visit', 'Sunrise hike' if no specific name is given",
  "country": "from known list or null",
  "city": "the actual city or town name (nearest real city, not an activity or route name) or null",
  "category": "Food|Drink|Culture|Activities|Shopping|Stays|Miscellaneous",
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
      if (results.length === 0) {
        return res.status(200).json({ results: [], _debug: { raw: raw.slice(0, 500), imageCount: imageList.length } });
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
  let content = `Source URL: ${url}\n`;
  let contentFields = 0;
  let fetchFailed = false;
  const isSocial = /tiktok\.com|instagram\.com|facebook\.com/.test(url);

  try {
    if (url.includes('tiktok.com')) {
      const oembed = await fetch(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
      ).then(r => r.ok ? r.json() : null).catch(() => null);
      if (oembed) {
        content += `Title: ${oembed.title || ''}\n`;
        content += `Author: ${oembed.author_name || ''}\n`;
        contentFields += 2;
      }
    }

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    // Try direct fetch first, then Jina Reader as fallback for non-social URLs
    let page = await fetch(url, { headers: fetchHeaders, redirect: 'follow' })
      .catch(() => null);

    let usedJina = false;
    if (!isSocial && (!page || !page.ok)) {
      page = await fetch(`https://r.jina.ai/${url}`, { headers: fetchHeaders, redirect: 'follow' })
        .catch(() => null);
      usedJina = true;
    }

    if (!page) { fetchFailed = true; }

    if (page && page.ok) {
      const text = await page.text();
      if (isSocial || !usedJina) {
        const get = (pattern) => text.match(pattern)?.[1]?.trim() || '';
        const title       = get(/property="og:title"\s+content="([^"]+)"/i)
                         || get(/content="([^"]+)"\s+property="og:title"/i)
                         || get(/<title>([^<]+)<\/title>/i);
        const description = get(/property="og:description"\s+content="([^"]+)"/i)
                         || get(/content="([^"]+)"\s+property="og:description"/i)
                         || get(/name="description"\s+content="([^"]+)"/i);
        const siteName    = get(/property="og:site_name"\s+content="([^"]+)"/i);
        if (title)       { content += `Title: ${title}\n`; contentFields++; }
        if (description) { content += `Description: ${description}\n`; contentFields++; }
        if (siteName)    { content += `Site: ${siteName}\n`; contentFields++; }
        if (!isSocial) {
          const bodyText = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
          const excerpt = bodyText.split(' ').slice(0, 4000).join(' ');
          if (excerpt.length > 200) { content += `\nPage content:\n${excerpt}\n`; contentFields++; }
        }
      } else {
        // Jina Reader returns clean markdown text
        const excerpt = text.slice(0, 16000);
        if (excerpt.length > 200) { content += `\nPage content:\n${excerpt}\n`; contentFields++; }
      }
    } else if (fetchFailed) {
      return res.status(422).json({
        error: 'url_unreachable',
        message: 'Could not reach this URL. It may be a short link or private post. Try uploading a screenshot instead.'
      });
    }
  } catch (_) {}

  if (contentFields === 0) {
    return res.status(422).json({
      error: 'no_metadata',
      message: 'No readable content found at this URL — it may be a short link, private post, or app-only link. Try uploading a screenshot instead.'
    });
  }

  const SYSTEM = `You extract travel inspiration from web pages — including social media posts, travel blogs, and travel journals.
Extract ALL distinct places, restaurants, activities, or experiences mentioned. For a blog post this may be many places; for a social post it may be just one.
Return ONLY a valid JSON array — no markdown fences, no explanation.

Known countries: ${COUNTRIES}
Categories: ${CATEGORIES}
  Food – restaurants, cafes, food markets, bakeries, street food
  Drink – bars, coffee shops, rooftop bars, cocktail spots
  Culture – museums, temples, monuments, architecture, historical sites, galleries, religious sites, musicals, theater, plays, opera, concerts, live music, DJ sets, festivals, performing arts venues
  Activities – hiking, beaches, nature, sports, wellness, tours, day trips, wildlife sanctuaries, animal experiences, rescue centres, national parks, regional parks, nature reserves, protected areas, waterfalls, viewpoints, boat trips, water parks, amusement parks, theme parks, casinos, entertainment complexes
  Shopping – boutiques, markets, department stores, souvenirs
  Stays – hotels, guesthouses, hostels, resorts, lodges, villas, homestays, riads, ryokans — anything the blog recommends sleeping at
  Miscellaneous – anything else travel-related

Each item:
{
  "name":     "specific place name or activity",
  "country":  "from known list or null",
  "city":     "the actual city or town name (e.g. 'Thakhek', not 'Thakhek Loop'; 'Champasak', not 'Champasak Province') — use the nearest real city, or null if unknown",
  "category": "Food|Drink|Culture|Activities|Shopping|Stays|Miscellaneous",
  "details":  "one concise sentence with the most useful info"
}

If no travel information found, return: []`;

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
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `Extract all travel places and activities from:\n\n${content}` }]
      })
    });

    if (!claude.ok) {
      const err = await claude.text();
      return res.status(502).json({ error: 'Claude API error', detail: err });
    }

    const claudeData = await claude.json();
    const raw = claudeData.content?.[0]?.text || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    try {
      const results = JSON.parse(match?.[0] || '[]');
      if (!Array.isArray(results) || results.length === 0) {
        return res.status(422).json({
          error: 'no_travel_info',
          message: 'No travel information found at this URL. The content may not be travel-related. Try uploading a screenshot instead.'
        });
      }
      return res.status(200).json({ results });
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
