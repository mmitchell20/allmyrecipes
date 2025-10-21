// ocr.js — lightweight client-side OCR using Tesseract.js (no keys)

import Tesseract from 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

// simple image loader
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// quick preprocess: scale, grayscale, contrast bump
async function preprocess(file) {
  const img = await fileToImage(file);
  const maxSide = 2000;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.filter = 'grayscale(100%) contrast(120%) brightness(110%)';
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.92);
  });
}

// normalize OCR quirks so your parser works better
export function normalizeOcrText(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/-\n/g, '')                 // join hyphenated line breaks
    .replace(/[ \t]+\n/g, '\n')          // trim end spaces
    .replace(/\n{3,}/g, '\n\n')          // squeeze big gaps
    .replace(/[•▪◦●◆▶]/g, '•')          // unify bullets
    .replace(/\s+·\s+/g, ' • ')
    .trim();
}

/**
 * OCR all files (sequential for stability).
 * @param {File[]} files
 * @param {{onProgress?: function}} opts
 * @returns {Promise<{ text: string, pages: Array<{text:string,confidence:number}> }>}
 */
export async function ocrAll(files, opts = {}) {
  const pages = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const prep = await preprocess(file);

    const res = await Tesseract.recognize(prep, 'eng', {
      logger: (m) => {
        if (opts.onProgress && m.status === 'recognizing text') {
          const p = m.progress || 0;
          opts.onProgress({ index: i + 1, total: files.length, progress: p });
        }
      }
    });

    const text = (res.data && res.data.text) ? res.data.text : '';
    const confidence = res.data?.confidence ?? 0;
    pages.push({ text, confidence });
  }

  const combined = pages.map(p => p.text).join('\n\n--- PAGE ---\n\n');
  return { text: combined, pages };
}
