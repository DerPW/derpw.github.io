// Welche Schriftdateien braucht ein Modell? Nur laden, wenn text() vorkommt.

const FAMILIES = {
  sans: ['LiberationSans-Regular.ttf', 'LiberationSans-Bold.ttf', 'LiberationSans-Italic.ttf', 'LiberationSans-BoldItalic.ttf'],
  serif: ['LiberationSerif-Regular.ttf', 'LiberationSerif-Bold.ttf', 'LiberationSerif-Italic.ttf', 'LiberationSerif-BoldItalic.ttf'],
  mono: ['LiberationMono-Regular.ttf', 'LiberationMono-Bold.ttf', 'LiberationMono-Italic.ttf', 'LiberationMono-BoldItalic.ttf'],
};

export const FONT_NAMES = ['Liberation Sans', 'Liberation Serif', 'Liberation Mono'];

// Liefert Pfade relativ zum App-Verzeichnis
export function fontsFor(src) {
  if (!/\b(?:text|textmetrics|fontmetrics)\s*\(/.test(src)) return [];
  const want = new Set(['sans']);
  if (/serif/i.test(src)) want.add('serif');
  if (/mono/i.test(src)) want.add('mono');
  return [...want].flatMap((f) => FAMILIES[f]).map((f) => `vendor/fonts/${f}`);
}
