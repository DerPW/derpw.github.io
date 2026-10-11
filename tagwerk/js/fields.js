// Felddefinitionen, Tabellenspalten und Formatierer.

export const FIELDS = {
  title: { label: 'Titel' },
  artist: { label: 'Interpret' },
  album: { label: 'Album' },
  albumartist: { label: 'Album-Interpret' },
  track: { label: 'Track', numeric: true },
  tracktotal: { label: 'Tracks gesamt', numeric: true },
  disc: { label: 'Disc', numeric: true },
  disctotal: { label: 'Discs gesamt', numeric: true },
  year: { label: 'Jahr' },
  genre: { label: 'Genre' },
  composer: { label: 'Komponist' },
  bpm: { label: 'BPM', numeric: true },
  comment: { label: 'Kommentar', multiline: true },
  lyrics: { label: 'Liedtext', multiline: true },
};

export const FIELD_KEYS = Object.keys(FIELDS);
export const TEXT_FIELDS = ['title', 'artist', 'album', 'albumartist', 'genre', 'composer', 'comment'];
export const label = (key) => FIELDS[key]?.label ?? key;

// Spalten der Dateiliste. "min" = Breite, ab der die Spalte eingeblendet wird.
export const COLUMNS = [
  { key: 'cover', label: '', width: '44px' },
  { key: 'track', label: '#', width: '50px', align: 'end' },
  { key: 'title', label: 'Titel', width: 'minmax(150px, 2fr)' },
  { key: 'artist', label: 'Interpret', width: 'minmax(110px, 1.3fr)' },
  { key: 'album', label: 'Album', width: 'minmax(110px, 1.3fr)', min: 620 },
  { key: 'year', label: 'Jahr', width: '62px', min: 760 },
  { key: 'genre', label: 'Genre', width: 'minmax(80px, .8fr)', min: 1040 },
  { key: 'duration', label: 'Dauer', width: '62px', align: 'end', min: 860 },
  { key: 'name', label: 'Datei', width: 'minmax(130px, 1.3fr)', min: 940 },
  { key: 'format', label: 'Format', width: '70px', min: 700 },
];

export function formatDuration(sec) {
  if (!sec || !Number.isFinite(sec)) return '–';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

export function formatLongDuration(sec) {
  const s = Math.round(sec || 0);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60);
  if (hh) return `${hh} Std. ${mm} Min.`;
  if (mm) return `${mm} Min. ${s % 60} Sek.`;
  return `${s} Sek.`;
}

export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('de-DE', { maximumFractionDigits: n < 10 && i ? 1 : 0 })} ${units[i]}`;
}

export const formatRate = (hz) => (hz ? `${(hz / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} kHz` : '');
export const formatChannels = (n) => ({ 1: 'Mono', 2: 'Stereo' })[n] ?? (n ? `${n} Kanäle` : '');
export const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;
