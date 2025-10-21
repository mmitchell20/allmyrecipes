// parser-better.js — browser ESM version of your current parser

const COOKING_VERBS = [
  'add','bake','beat','blend','boil','braise','broil','brown','brush','chill','chop','combine',
  'cook','cool','cream','cut','deglaze','dice','drain','drizzle','fold','fry','grate','grill',
  'heat','knead','marinate','melt','microwave','mix','peel','pour','preheat','reduce','rest',
  'roast','saute','sauté','season','sear','serve','sift','simmer','slice','stir','strain','toast','whisk','fold in'
];

const UNITS = [
  'tsp','teaspoon','teaspoons','tbsp','tablespoon','tablespoons','cup','cups','oz','ounce','ounces',
  'lb','pound','pounds','g','gram','grams','kg','kilogram','kilograms','ml','milliliter','milliliters',
  'l','liter','liters','pinch','dash','clove','cloves'
];

const COMMON_FOODS = [
  'salt','pepper','oil','olive','garlic','onion','tomato','butter','flour','sugar','egg','eggs','milk',
  'cream','buttermilk','vanilla','baking powder','baking soda','raspberries','lemon','powdered sugar',
  'kosher','granulated','all-purpose','ap flour'
];

const NOTE_PATTERNS = [
  /^\s*ad\s*$/i,
  /https?:\/\//i,
  /^\s*(see\s+the\s+recipe\s+card|see\s+(above|below)).*$/i,
  /^\s*\(?makes? ahead|make[-\s]?ahead|storage|serving suggestion|equipment|substitutions?|variations?\)?[:\-–—]?\s*$/i,
  /^[\s\-–—*•]+$/,
  /^\s*\(.*\)\s*$/,
];

const CAPTION_HINTS = /(flat lay|ingredients for|mixing bowl|whisk|batter|photo|image|shown|laid out)/i;

const HEADINGS = {
  INGREDIENTS: /^(ingredients|ingredients\s*&\s*substitution)s?$/i,
  EQUIPMENT: /^equipment needed$/i,
  VARIATIONS: /^variations$/i,
  HOWTO: /^(how to (make|cook)|method|directions)/i,
};

const strip = s => (s || '').replace(/\s+/g, ' ').trim();
const toLower = s => (s || '').toLowerCase();

function isNoteLine(line) {
  const s = line.trim();
  return NOTE_PATTERNS.some(rx => rx.test(s)) || CAPTION_HINTS.test(s);
}

function looksLikeHeading(line) {
  const s = strip(line).replace(/[:.]+$/, '');
  if (HEADINGS.INGREDIENTS.test(s)) return 'ingredients';
  if (HEADINGS.EQUIPMENT.test(s))  return 'ignore';
  if (HEADINGS.VARIATIONS.test(s)) return 'ignore';
  if (HEADINGS.HOWTO.test(s))      return 'steps';
  return null;
}

function looksLikeSectionMarker(line) {
  return /^\s*[A-Z][A-Za-z0-9\s\-,'&]+:\s*$/.test(line);
}

function looksLikeExplicitStep(line) {
  return /\bstep\s*\d+\b/i.test(line);
}

function hasVerb(line) {
  const l = toLower(line);
  return COOKING_VERBS.some(v => new RegExp(`\\b${v}\\b`, 'i').test(l));
}

function mentionsFood(line) {
  const l = toLower(line);
  const qty = /^\s*(\d+([.,]\d+)?|\d+\s*\/\s*\d+)\b/.test(l);
  const unit = new RegExp(`\\b(${UNITS.join('|')})\\b`, 'i').test(l);
  const foodish = COMMON_FOODS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(l));
  const trailingPrep = /,\s*(chopped|diced|minced|sliced|grated|melted|softened)\b/i.test(l);
  return qty || unit || foodish || trailingPrep;
}

function cleanIngredient(text) {
  let s = strip(text);
  if (/:\s+/.test(s)) {
    const left = s.split(':')[0];
    if (mentionsFood(left) || /\b(flour|sugar|salt|butter|eggs?|buttermilk|vanilla|raspberries|powdered)\b/i.test(left)) {
      s = left;
    }
  }
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = strip(s);
  s = s.replace(/^all[-\s]?purpose\b/i, 'All-purpose')
       .replace(/^baking powder\b/i, 'Baking Powder')
       .replace(/^powdered sugar\b/i, 'Powdered Sugar')
       .replace(/^granulated sugar\b/i, 'Granulated Sugar')
       .replace(/^kosher salt\b/i, 'Kosher Salt')
       .replace(/^unsalted butter\b/i, 'Unsalted Butter')
       .replace(/^eggs?\b/i, 'Eggs')
       .replace(/^vanilla extract\b/i, 'Vanilla Extract')
       .replace(/^buttermilk\b/i, 'Buttermilk')
       .replace(/^\s*fresh or frozen raspberries\b/i, 'Raspberries');
  return s;
}

function classifyLine(line, mode) {
  const raw = line;
  const s = strip(raw);
  if (!s) return { type: 'empty', mode, text: raw };

  if (isNoteLine(s)) return { type: 'ignore', mode, text: raw };

  const head = looksLikeHeading(s);
  if (head) {
    const newMode = head === 'ignore' ? 'ignore' : head;
    return { type: 'mode', mode: newMode, text: s };
  }

  if (looksLikeSectionMarker(s)) return { type: 'mode', mode: 'steps', text: s };
  if (looksLikeExplicitStep(s))  return { type: 'step', mode: 'steps', text: s };

  if (mode === 'ignore') return { type: 'ignore', mode, text: s };

  const verb = hasVerb(s);
  const food = mentionsFood(s);

  if (mode === 'ingredients') {
    if (CAPTION_HINTS.test(s)) return { type: 'ignore', mode, text: s };
    return { type: 'ingredient', mode, text: cleanIngredient(s) };
  }

  if (mode === 'steps') {
    if (verb || looksLikeExplicitStep(s)) return { type: 'step', mode: 'steps', text: s };
    if (!verb && !food) return { type: 'ignore', mode, text: s };
  }

  if (food && !verb) return { type: 'ingredient', mode, text: cleanIngredient(s) };
  if (verb) return { type: 'step', mode: 'steps', text: s };

  return { type: 'ignore', mode, text: s };
}

export function parseRecipeText(text) {
  const lines = (text || '').split(/\r?\n/);
  const ingredients = [];
  const steps = [];
  let mode = 'unknown';

  for (const line of lines) {
    const result = classifyLine(line, mode);
    if (result.type === 'mode') { mode = result.mode; continue; }
    if (result.type === 'ingredient') {
      const cleaned = cleanIngredient(result.text);
      if (cleaned && !/^(ingredients)/i.test(cleaned)) ingredients.push(cleaned);
    } else if (result.type === 'step') {
      steps.push(strip(result.text));
    }
  }

  const uniq = arr => Array.from(new Set(arr));
  return {
    title: '',       // you can keep using your title-guessing in index.html
    servings: '',    // add later if you want
    ingredients: uniq(ingredients),
    steps: uniq(steps)
  };
}

// Optional: export for debugging
export { classifyLine };


<script type="module">
  import { parseRecipeText } from './parser-better.js';

  (function () {
    const $ = (s) => document.querySelector(s);
    const form = $('#cleaner');
    const titleEl = $('#title');
    const sourceEl = $('#source');
    const rawEl = $('#raw');
    const statusEl = $('#status');
    const errorEl = $('#error');

    let titleTouched = false;
    titleEl.addEventListener('input', () => { titleTouched = true; });

    function maybeSuggest() {
      const parsed = parseRecipeText(rawEl.value || '');
      if (!titleTouched && (!titleEl.value || titleEl.value.trim() === '')) {
        if (parsed.title) titleEl.value = parsed.title;
      } else if (parsed.title) {
        titleEl.placeholder = parsed.title;
      }
    }
    rawEl.addEventListener('input', maybeSuggest);
    rawEl.addEventListener('paste', () => setTimeout(maybeSuggest, 0));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      statusEl.textContent = 'Cleaning…';
      try {
        const parsed = parseRecipeText(rawEl.value || '');
        const recipe = {
          id: 'tmp_' + Date.now(),
          title: (titleEl.value.trim() || parsed.title || '').trim(),
          source: sourceEl.value.trim(),
          ingredients: parsed.ingredients || [],
          steps: parsed.steps || [],
          servings: parsed.servings || '',
          createdAt: new Date().toISOString()
        };
        sessionStorage.setItem('amr_tmp', JSON.stringify(recipe));
        statusEl.textContent = 'Done. Opening recipe…';
        window.location.href = 'recipe.html';
      } catch (err) {
        console.error(err);
        statusEl.textContent = '';
        errorEl.textContent = 'Could not clean this text. Try a different format.';
      }
    });
  })();
</script>

