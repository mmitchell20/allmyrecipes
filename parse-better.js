/* ---------- allmyrecipes: score-based recipe parser ---------- */
const FRACTIONS = {
  '¼': '1/4', '½': '1/2', '¾': '3/4',
  '⅐': '1/7','⅑':'1/9','⅒':'1/10',
  '⅓': '1/3', '⅔': '2/3',
  '⅕': '1/5', '⅖':'2/5','⅗':'3/5','⅘':'4/5',
  '⅙': '1/6', '⅚':'5/6',
  '⅛': '1/8', '⅜':'3/8','⅝':'5/8','⅞':'7/8'
};

function normalizeText(t){
  return (t||'')
    .replace(/\r\n/g, '\n')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\u2022\u25CF\u25A0\u2219]/g, '•')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(new RegExp(`[${Object.keys(FRACTIONS).join('')}]`, 'g'), m => FRACTIONS[m])
    .trim();
}

const RE = {
  qty: /(?:^|\s)(?:\d+(?:\.\d+)?(?:\s+\d\/\d)?|\d+\s?\d?\/\d|(?:1\/\d+))(?!\S)/, // 1, 1.5, 1 1/2, 1/2
  unit: new RegExp(String.raw`\b(?:teaspoons?|tsp|tablespoons?|tbsp|cups?|c|pints?|pint|quarts?|qt|liters?|l|milliliters?|ml|grams?|g|kilograms?|kg|ounces?|oz|pounds?|lb|sticks?|cloves?|pinch|dash|slice|slices|can|cans|package|packages|packet|pkt)\b`, 'i'),
  bullet: /^\s*(?:[-*•]|\d{1,3}[.)])\s+/,
  headingIng: /^\s*(?:ingredients?|for the (?:dough|sauce|filling|topping|salad|cake|glaze))/i,
  headingSteps: /^\s*(?:instructions?|directions?|method|preparation|prep|steps?)\s*:?\s*$/i,
  headingOther: /^\s*(?:notes?|tips?|nutrition|equipment|tools?)\b/i,
  servingsLine: /^\s*(?:servings?|serves|yield|makes)\b[:\-\s]*([^\n]+)$/i,
  timeNoise: /\b(prep|cook|total)\s*time\b/i,
  cookVerbs: /\b(preheat|heat|saute|sauté|bake|boil|simmer|stir|whisk|fold|mix|combine|beat|cream|knead|rest|chill|marinate|grill|roast|fry|broil|transfer|drain|season|serve|garnish|slice|add|reduce|increase|cover|uncover|let|cool|bring)\b/i
};

function guessTitleFromText(text){
  const lines = text.split('\n').map(s=>s.trim()).filter(Boolean).slice(0, 40);
  const BAD = /^(ingredients?|directions?|instructions?|method|preparation|steps?|notes?|nutrition|servings?|yield|prep time|cook time|total time|course|cuisine)\b/i;
  const BULLET = RE.bullet;
  for (const l of lines){
    if (BAD.test(l)) break;
    if (BULLET.test(l)) continue;
    const words = l.split(/\s+/).length;
    if (words>=2 && words<=12 && (l.match(/\d/g)||[]).length<=3) {
      return l.replace(/\s*[-–—|].*$/,'').replace(/\brecipe\b\s*$/i,'').replace(/^[“"']|[”"']$/g,'').trim();
    }
  }
  return lines[0] || '';
}

function detectServings(text){
  const lines = text.split('\n').map(s=>s.trim()).filter(Boolean);
  const scan = arr => {
    for (const line of arr) {
      const m = line.match(RE.servingsLine);
      if (m) return m[1].replace(/\s*\(.*?\)\s*/g,'').trim();
    }
    return '';
  };
  return scan(lines.slice(0,50)) || scan(lines.slice(-50));
}

/* score a line for ingredient vs step vs heading vs noise */
function scoreLine(line){
  const l = line.trim();
  if (!l) return {type:'blank', sIng:0, sStep:0, sHead:0};

  // normalize bullets/numbering away for scoring
  const unbul = l.replace(RE.bullet,'').trim();

  // heading detection
  if (RE.headingIng.test(l))  return {type:'heading-ing', sIng:0, sStep:0, sHead:2};
  if (RE.headingSteps.test(l))return {type:'heading-steps', sIng:0, sStep:0, sHead:2};
  if (RE.headingOther.test(l))return {type:'heading-other', sIng:0, sStep:0, sHead:1};

  let sIng = 0, sStep = 0;

  // features for ingredient
  if (RE.qty.test(unbul))  sIng += 2.0;
  if (RE.unit.test(unbul)) sIng += 2.0;
  if (/,\s*(divided|softened|melted|minced|chopped|diced|room\s*temperature)/i.test(unbul)) sIng += 0.7;
  if (/^\d{1,2}\s*x\s*/i.test(unbul)) sIng += 0.5; // e.g., 2x 14oz cans
  if (/salt|pepper|oil|butter|flour|sugar|garlic|onion|egg|eggs|milk|cream|yeast|vanilla|tomato/i.test(unbul)) sIng += 0.6;
  if (RE.bullet.test(l)) sIng += 0.6;

  // features for step
  if (RE.cookVerbs.test(unbul)) sStep += 1.6;
  if (RE.bullet.test(l)) sStep += 0.8;          // numbered/bulleted instructions
  if (/[.!?]$/.test(unbul)) sStep += 0.4;
  if (/\bminutes?\b|\bhours?\b|\b°F\b|\bdegrees\b/i.test(unbul)) sStep += 0.5;
  if (RE.timeNoise.test(unbul)) sStep -= 0.5;    // “prep time” headings → not a step

  // de-bias: both present (e.g., “Add 2 cups milk”) → still a step if a verb starts the line
  if (/^(?:add|stir|mix|whisk|beat|combine|fold|pour|place|preheat|cook|bake|simmer|boil)\b/i.test(unbul)) {
    sStep += 0.5;
  }

  return {type:'content', sIng, sStep, sHead:0};
}

function splitSentences(text){
  const ABBR = ['min','mins','sec','secs','tsp','tbsp','oz','approx','pkg','pt','qt','vs','mr','mrs','dr'];
  const out = []; let buf = '';
  const isEOS = (p,n,w)=>{ if(/\d/.test(p)&&/\d/.test(n)) return false; if(w&&ABBR.includes(w.toLowerCase())) return false; return /[A-Z0-9]/.test(n||'A'); };
  for(let i=0;i<text.length;i++){
    const ch=text[i]; buf+=ch;
    if(/[.!?]/.test(ch)){
      let j=i+1; while(j<text.length && /\s/.test(text[j])) j++;
      let k=i-1; while(k>=0 && text[k]===' ') k--;
      let wEnd=k; while(k>=0 && /[A-Za-z]/.test(text[k])) k--;
      const prevWord = text.slice(k+1, wEnd+1);
      if(isEOS(text[i-1]||'', text[j]||'', prevWord)){ out.push(buf.trim()); buf=''; i=j-1; }
    }
  }
  if(buf.trim()) out.push(buf.trim());
  return out;
}

function chunkLongStep(s){
  const MAX = 220;
  if (s.length <= MAX) return [s.trim()];
  let parts = s.split(/;|\.\s+(?=(?:Then|Next|Meanwhile|After|Before|Once|When|Return|Stir|Add|Bake|Cook|Transfer|Let|Serve|Season|Reduce|Increase|Whisk|Simmer|Boil|Drain)\b)/gi).map(t=>t.trim()).filter(Boolean);
  if (parts.length === 1 && parts[0].length > MAX) {
    parts = s.split(/\s+(?:and\s+then|then|after that)\s+/gi).map(t=>t.trim()).filter(Boolean);
  }
  if (parts.some(p=>p.length>MAX)) parts = splitSentences(s);
  return parts.map(t=>t.replace(/\s*\.\s*$/,''));
}

export function parseRecipeText(rawInput){
  const raw = normalizeText(rawInput);

  // Optional: title + servings before we mutate lines
  const titleGuess = guessTitleFromText(raw);
  const servings = detectServings(raw);

  // Tokenize
  const lines = raw.split('\n');

  // First, find likely sections to bias classification
  let inIng = false, inSteps = false;
  const tokens = lines.map((line, idx) => {
    const sc = scoreLine(line);
    if (RE.headingIng.test(line)) { inIng = true; inSteps = false; return {idx, line, ...sc}; }
    if (RE.headingSteps.test(line)) { inSteps = true; inIng = false; return {idx, line, ...sc}; }
    return {idx, line, inIng, inSteps, ...sc};
  });

  // Classify with thresholds + section bias
  const itemsIng = [];
  const itemsStep = [];
  const headings = [];

  tokens.forEach(t => {
    if (t.type?.startsWith('heading')) { headings.push(t.line.trim()); return; }
    if (!t.line.trim()) return;

    let sIng = t.sIng, sStep = t.sStep;
    if (t.inIng) sIng += 0.8;
    if (t.inSteps) sStep += 0.8;

    if (sIng >= 1.8 && sIng >= sStep) {
      // Clean ingredient line
      let s = t.line.trim()
        .replace(RE.bullet,'')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*\.\s*$/, '')
        .replace(/\b(tsp|tbsp|oz)\.\b/ig, (m,p)=>p);
      itemsIng.push(s);
    } else if (sStep >= 1.6) {
      itemsStep.push(t.line.trim());
    } else {
      // soft fallbacks: if something looks like a bullet list but scores low, try ingredients first
      if (RE.bullet.test(t.line)) {
        itemsIng.push(t.line.replace(RE.bullet,'').trim());
      }
    }
  });

  // If ingredients too short, scan whole text once more
  let ingredients = itemsIng.length >= 2 ? itemsIng : lines.filter(l => {
    const sc = scoreLine(l);
    return sc.sIng >= 1.8 && sc.sIng >= sc.sStep;
  }).map(l => l.replace(RE.bullet,'').trim());

  // Build steps:
  let steps;
  if (itemsStep.length >= 2) {
    // Collapse/merge small trailing lines, then chunk long ones
    const merged = [];
    let cur = '';
    const starts = l => RE.bullet.test(l) || /^\s*step\s*\d+/i.test(l) || /^\d{1,3}\s*[.)]\s+/.test(l);
    for (const l of itemsStep){
      const clean = l.replace(RE.bullet,'').replace(/^step\s*\d+\s*[:.)-]?\s*/i,'').trim();
      if (starts(l)) {
        if (cur.trim()) merged.push(cur.trim());
        cur = clean;
      } else {
        cur = (cur ? cur + ' ' : '') + clean;
      }
    }
    if (cur.trim()) merged.push(cur.trim());
    steps = [];
    merged.forEach(s => steps.push(...chunkLongStep(s)));
  } else {
    // Paragraph/sentence fallback
    const body = raw.split(/\bingredients?\b/i)[1] ? raw.split(/\bingredients?\b/i)[1] : raw;
    const paras = body.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    steps = [];
    paras.forEach(p => {
      if (scoreLine(p).sStep >= 1.0 || /[.!?]$/.test(p)) {
        steps.push(...chunkLongStep(p));
      }
    });
    steps = steps.filter(s => s.length>2);
  }
  steps = steps.map(s => s.replace(/^\d{1,3}\s*[.)]\s+/, '').replace(/\s*\.\s*$/, ''));

  // Deduplicate & tidy ingredients
  const seen = new Set();
  ingredients = ingredients
    .map(s => s.replace(/\s{2,}/g,' ').trim())
    .filter(Boolean)
    .filter(s => { const k=s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  // Return
  return {
    title: titleGuess,
    servings,
    ingredients,
    steps,
    notes: '',
    debug: { headings, counts:{ingredients:ingredients.length, steps:steps.length} }
  };
}
