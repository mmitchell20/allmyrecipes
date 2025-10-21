// parser-better.js — robust paste/OCR parser (ES module)

/* =========================
   0) Normalization (for OCR & paste)
   ========================= */
export function normalizeRecipeText(text){
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00AD/g, '')                 // soft hyphen
    .replace(/-\n/g, '')                    // join hyphenated breaks
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    // remove boilerplate symbols
    .replace(/[®©™]/g, '')
    // unify quotes/dashes/ligatures
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl')
    // normalize bullets and dot separators
    .replace(/^[ \t]*[•·▪◦●◆▶][ \t]*/gm, '• ')
    .replace(/\s+·\s+/g, ' • ')
    // step number OCR confusions: I./l. -> 1.
    .replace(/(^|\n)\s*[Il]\s*[.)-]\s+/g, '$1 1. ')
    .trim();
}

/* =========================
   1) Dictionaries / regex helpers
   ========================= */
const COOKING_VERBS = [
  'add','bake','beat','blend','boil','braise','broil','brown','brush','chill','chop','combine',
  'cook','cool','cream','cut','deglaze','dice','drain','drizzle','fold','fry','grate','grill',
  'heat','knead','marinate','melt','microwave','mix','peel','pour','preheat','reduce','rest',
  'roast','saute','sauté','season','sear','serve','sift','simmer','slice','stir','strain','toast','whisk','fold in'
];

const UNIT_WORDS = [
  'tsp','teaspoon','teaspoons','tbsp','tablespoon','tablespoons','cup','cups','c',
  'oz','ounce','ounces','lb','pound','pounds',
  'g','gram','grams','kg','kilogram','kilograms',
  'ml','milliliter','milliliters','l','liter','liters',
  'pinch','dash','clove','cloves','slice','slices','can','cans','package','packages','pkt'
];

const FRACS = '¼|½|¾|⅓|⅔|⅛|⅜|⅝|⅞';
const QTY_RE = new RegExp(String.raw`(^|\s)(\d+(?:[\/.-]\d+)?|\d+\s+\d\/\d|${FRACS})\b`);
const UNIT_RE = new RegExp(String.raw`\b(?:${UNIT_WORDS.join('|')})\b`, 'i');

// bullets and step numbers (tolerate OCR variants)
const STEP_START_RE     = /^\s*(?:\(?(\d+|[IiLl])\)?\s*[.)-]|[*•\-–—])\s+/;
const BULLET_OR_NUM_RE  = /^\s*(?:[*•\-–—]\s+|\(?\d{1,3}\)?\s*[.)-]\s+)/;

// fuzzy headers to survive OCR errors
const HDR_ING   = /^(?:ingr[eai]d[i|l]ents?)\b/i;         // Ingredients / Ingredlents / lngredients
const HDR_STEPS = /^(?:instructions?|directions?|method|preparation|steps?)\b/i;
const HDR_NOTES = /^(?:notes?)\b/i;

// misc helpers
const strip = (s) => (s || '').replace(/\s+/g, ' ').trim();
const toLines = (t) => (t || '').split('\n');

/* =========================
   2) Title + Servings heuristics
   ========================= */
function cleanSiteSuffix(s){
  return (s || '')
    .replace(/\s*[-–—|]\s*(?:Allrecipes|Food Network|Bon App[ée]tit|NYT Cooking|Serious Eats|Epicurious|The Kitchn|Delish|BBC Good Food|Taste of Home|Tasty|Simply Recipes|King Arthur Baking)[^]*$/i, '')
    .replace(/\s*[-–—|]\s*[A-Za-z0-9 .&'!]+$/, '')
    .trim();
}
function titleCase(s){
  return (s || '').replace(/\w\S*/g, w =>
    /^(and|or|the|a|an|of|with|for|to|in|on|by)$/i.test(w) ? w.toLowerCase()
      : w[0].toUpperCase() + w.slice(1).toLowerCase()
  ).replace(/^./, c => c.toUpperCase());
}
function guessTitle(text){
  if (!text) return '';
  // if pasted HTML
  const m = text.match(/<title[^>]*>([^<]{3,100})<\/title>/i);
  if (m) {
    const t = cleanSiteSuffix(m[1]).replace(/\brecipe\b\s*$/i,'').trim();
    if (t) return titleCase(t).slice(0, 80);
  }
  const lines = normalizeRecipeText(text).split('\n').map(s=>s.trim()).filter(Boolean).slice(0, 40);
  const BAD = new RegExp(`${HDR_ING.source}|${HDR_STEPS.source}|${HDR_NOTES.source}|^(nutrition|yield|servings?)\\b`, 'i');
  const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
  for (const l of lines){
    if (BAD.test(l)) break;
    if (BULLET.test(l)) continue;
    const words = l.split(/\s+/).length;
    const manyNums = (l.match(/\d/g)||[]).length > 3;
    if (words >= 2 && words <= 12 && !manyNums) {
      const t = cleanSiteSuffix(l).replace(/\brecipe\b\s*$/i,'').replace(/^[“"']|[”"']$/g,'').trim();
      if (t.length >= 3) return titleCase(t).slice(0,80);
    }
  }
  return '';
}

function detectServings(text){
  const lines = toLines(text).map(s => s.trim()).filter(Boolean);
  const isStepLine = (l) => STEP_START_RE.test(l);
  const scan = (arr) => {
    for (const line of arr) {
      if (isStepLine(line)) continue;
      const L = line.replace(/\s+/g, ' ');
      let m;
      m = L.match(/^\s*servings?\b\s*[:\-]?\s*(.+)$/i); if (m && m[1]) return m[1].trim();
      m = L.match(/^\s*serves?\b\s*[:\-]?\s*(.+)$/i);   if (m && m[1]) return m[1].trim();
      m = L.match(/^\s*makes?\b\s*[:\-]?\s*(.+)$/i);    if (m && m[1]) return m[1].trim();
      m = L.match(/\byield\s*[:\-]?\s*(.+)$/i);         if (m && m[1]) return m[1].trim();
    }
    return '';
  };
  return scan(lines.slice(0, 50)) || scan(lines.slice(-50));
}

/* =========================
   3) Ingredient detection
   ========================= */
function isIngredientLine(line){
  const l = (line || '').trim();
  if (!l) return false;
  if (HDR_ING.test(l)) return false;
  // bullets/numbers OR qty+unit (as fallback)
  const qtyUnit = QTY_RE.test(l) && UNIT_RE.test(l);
  return BULLET_OR_NUM_RE.test(l) || qtyUnit;
}

function cleanIngredient(line){
  let s = (line || '')
    // strip leading bullets, numbers, and stray symbols
    .replace(BULLET_OR_NUM_RE, '')
    .replace(/^\s*[-\[\(]*\s*[*•\-–—]\s*\]?\s*/, '')
    .replace(/^\s*(?:[Il]|\d+)\s*[.)-]\s+/, '')
    .replace(/[®©™]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // OCR unit fixes
  s = s.replace(/\b0z\b/ig, 'oz').replace(/\b1b\b/ig, 'lb');

  // tidy trailing punctuation
  s = s.replace(/\s*[.;,:]\s*$/, '');

  return s;
}

function extractIngredients(text){
  const lines = toLines(text);
  const out = [];

  // If there is a clear Ingredients section, prefer it
  let inIng = false;
  for (const raw of lines){
    const l = raw.trim();
    if (!l) continue;

    if (HDR_ING.test(l)) { inIng = true; continue; }
    if (HDR_STEPS.test(l) || HDR_NOTES.test(l)) {
      if (inIng) break;
    }
    if (!inIng) continue;

    if (isIngredientLine(l)) out.push(cleanIngredient(l));
  }

  // Fallback: scan whole text if section wasn’t found or too short
  if (out.length < 2){
    for (const raw of lines){
      const l = raw.trim();
      if (!l || HDR_STEPS.test(l) || HDR_NOTES.test(l)) continue;
      if (isIngredientLine(l)) out.push(cleanIngredient(l));
    }
  }

  // de-dupe conservatively
  const seen = new Set();
  const uniq = [];
  for (const x of out){
    const k = x.toLowerCase();
    if (!k) continue;
    if (!seen.has(k)) { seen.add(k); uniq.push(x); }
  }
  return uniq;
}

/* =========================
   4) Step extraction
   ========================= */
function extractSteps(text){
  const lines = toLines(text).map(s => s.trim()).filter(Boolean);

  // If there’s an explicit Steps/Instructions header, start after it
  let sliceIndex = 0;
  for (let i = 0; i < lines.length; i++){
    if (HDR_STEPS.test(lines[i])) { sliceIndex = i + 1; break; }
  }
  const L = lines.slice(sliceIndex);

  const steps = [];
  let cur = '';

  for (const raw of L){
    const l = raw
      .replace(/^\[-\]\s*/, '')       // stray checkbox
      .replace(/[®©™]/g, '');

    if (HDR_NOTES.test(l)) break;           // stop at Notes
    if (HDR_ING.test(l)) continue;          // skip Ingredients header

    if (STEP_START_RE.test(l)) {
      if (cur) steps.push(cur.trim());
      cur = l.replace(STEP_START_RE, '');
    } else {
      // same step, continue
      cur += (cur ? ' ' : '') + l;
    }
  }
  if (cur) steps.push(cur.trim());

  // clean endings & spaces
  return steps
    .map(s => s.replace(/\s*\.\s*$/, '').replace(/\s{2,}/g, ' '))
    .filter(Boolean);
}

/* =========================
   5) Main orchestrator
   ========================= */
export function parseRecipeText(input){
  // normalize first (important for OCR)
  const text = normalizeRecipeText(input || '');

  const title    = guessTitle(text);
  const servings = detectServings(text);
  const ingredients = extractIngredients(text);
  const steps       = extractSteps(text);

  return { title, servings, ingredients, steps };
}
