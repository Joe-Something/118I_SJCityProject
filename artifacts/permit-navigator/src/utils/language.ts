import { Language } from '../copy';

const KNOWN_LANGUAGES = [
  "Spanish", "French", "Vietnamese", "Chinese", "Tagalog",
  "English", "Arabic", "Hindi", "Korean", "Japanese",
  "German", "Russian", "Italian", "Portuguese", "Punjabi", "Persian"
];

const BUNDLE_MAP: Record<string, Language> = {
  "spanish": "es",
  "french": "fr",
  "vietnamese": "vi",
  "chinese": "zh",
  "tagalog": "tl",
  "english": "en"
};

export function getLanguageBundle(input: string): Language | null {
  return BUNDLE_MAP[input.trim().toLowerCase()] ?? null;
}

const ALIASES: Record<string, string> = {
  "sapanish": "Spanish",
  "frensh": "French",
  "chiniese": "Chinese",
  "việtnamese": "Vietnamese",
  "tagolog": "Tagalog",
  "engish": "English"
};

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
  for (let i = 0; i <= a.length; i += 1) { matrix[i][0] = i; }
  for (let j = 0; j <= b.length; j += 1) { matrix[0][j] = j; }
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i][j - 1] + 1,
        matrix[i - 1][j] + 1,
        matrix[i - 1][j - 1] + indicator
      );
    }
  }
  return matrix[a.length][b.length];
}

export function checkLanguage(input: string): { original: string; corrected: string; bundle: Language | 'other' } | null {
  const normalized = input.trim().toLowerCase();
  
  const exactMatch = KNOWN_LANGUAGES.find(l => l.toLowerCase() === normalized);
  if (exactMatch) return null; 

  if (ALIASES[normalized]) {
    const corrected = ALIASES[normalized];
    return {
      original: input,
      corrected,
      bundle: BUNDLE_MAP[corrected.toLowerCase()] || 'other'
    };
  }

  let bestMatch = null;
  let minDistance = 3; 
  for (const lang of KNOWN_LANGUAGES) {
    const dist = levenshtein(normalized, lang.toLowerCase());
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = lang;
    }
  }

  if (bestMatch) {
    return {
      original: input,
      corrected: bestMatch,
      bundle: BUNDLE_MAP[bestMatch.toLowerCase()] || 'other'
    };
  }

  return null;
}
