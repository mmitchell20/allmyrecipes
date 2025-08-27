const cheerio = require('cheerio');

function getTypes(obj) {
  const t = obj && obj['@type'];
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

function flattenInstructions(instr) {
  const out = [];
  if (!instr) return out;

  if (typeof instr === 'string') {
    return instr.split(/\s*(?<=\.|\?|!)\s+/).map(s => s.trim()).filter(Boolean);
  }

  if (Array.isArray(instr)) {
    for (const item of instr) {
      if (!item) continue;
      if (typeof item === 'string') {
        out.push(item.trim());
      } else if (typeof item === 'object') {
        const t = item['@type'];
        if (t === 'HowToSection' && Array.isArray(item.itemListElement)) {
          out.push(...flattenInstructions(item.itemListElement));
        } else if (item.text) {
          out.push(String(item.text).trim());
        } else if (Array.isArray(item)) {
          out.push(...flattenInstructions(item));
        }
      }
    }
    return out;
  }

  if (typeof instr === 'object' && instr.text) {
    out.push(String(instr.text).trim());
  }
  return out;
}

function textList($els) {
  return $els.map((i, el) => (cheerio(el).text() || '').trim()).get()
    .filter(Boolean)
    .map(s => s.replace(/\s+/g, ' '));
}

function pickInstructionCandidates($) {
  const containers = $('*[class*="instruction"], *[id*="instruction"], *[class*="direction"], *[id*="direction"], *[class*="method"], *[id*="method"], *[class*="step"], *[id*="step"]').slice(0, 3);
  const out = [];
  containers.each((_, el) => {
    const $el = $(el);
    out.push(...textList($el.find('li')));
    if (out.length < 2) out.push(...textList($el.find('p')));
  });
  return out;
}

async function fetchHTML(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    },
  });
  if (!resp.ok) throw new Error(`Upstream fetch failed: ${resp.status}`);
  return await resp.text();
}

function parseLDJSON($) {
  const scripts = $('script[type="application/ld+json"]');
  let recipe = null;

  scripts.each((_, el) => {
    let jsonText = cheerio(el).contents().text();
    if (!jsonText) return;
    try {
      const data = JSON.parse(jsonText);
      const candidates = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      for (const obj of candidates) {
        if (!obj || typeof obj !== 'object') continue;
        const types = getTypes(obj).map(String);
        if (types.includes('Recipe') || types.includes('schema:Recipe')) {
          recipe = obj;
          return false;
        }
      }
    } catch (_) {}
  });

  if (!recipe) return null;

  const title = recipe.name || '';
  const ingredients = recipe.recipeIngredient || recipe.ingredients || [];
  const steps = flattenInstructions(recipe.recipeInstructions);

  return { title, ingredients, steps };
}

function parseFallback($) {
  const metaTitle = $('meta[property="og:title"]').attr('content')
    || $('meta[name="twitter:title"]').attr('content');
  const title = (metaTitle || $('h1').first().text() || '').trim();

  const ingSelectors = [
    "[itemprop='recipeIngredient']",
    ".ingredients li", "ul.ingredients li", "ol.ingredients li",
    "li.ingredient", ".recipe-ingredients li", ".ingredients__list li"
  ];
  let ingredients = [];
  for (const sel of ingSelectors) {
    ingredients = textList($(sel));
    if (ingredients.length >= 2) break;
  }

  let steps = pickInstructionCandidates($);
  if (steps.length < 2) {
    steps = textList($('ol li')).slice(0, 50);
  }

  return { title, ingredients, steps };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = req.query.url;
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Missing or invalid ?url' });
    }

    const html = await fetchHTML(url);
    const $ = cheerio.load(html, { decodeEntities: true });

    const fromLD = parseLDJSON($);
    const { title, ingredients, steps } = fromLD || parseFallback($);

    return res.status(200).json({
      sourceUrl: url,
      title: (title || '').trim(),
      ingredients: (ingredients || []).map(s => s.trim()).filter(Boolean).slice(0, 200),
      steps: (steps || []).map(s => s.trim()).filter(Boolean).slice(0, 200),
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Failed to parse this page.' });
  }
};
