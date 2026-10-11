// Online-Metadaten: MusicBrainz (+ Cover Art Archive) und iTunes.
// Suchen, Release wählen, Tracks automatisch den Dateien zuordnen, fehlende Felder übernehmen.
import { formatDuration, label, plural } from './fields.js';
import { changeCase, stripTrackPrefix } from './patterns.js';
import { pendingCover, selectedFiles, setCover, setTags, state, value } from './state.js';
import { imageInfo } from './tags/bytes.js';
import { $, $$, esc, h, icon, load, openModal, store, toast } from './ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COUNTRY = (navigator.language.split('-')[1] || (navigator.language.startsWith('de') ? 'DE' : 'US')).toUpperCase();

/* ------------------------------------------------------------------ HTTP */

// MusicBrainz erlaubt eine Anfrage pro Sekunde – alle Aufrufe laufen durch eine Warteschlange.
let mbLast = 0;
let mbChain = Promise.resolve();
function mbFetch(path) {
  const url = `https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`;
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = mbLast + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      mbLast = Date.now();
      const res = await fetch(url);
      if (res.status === 503 || res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`MusicBrainz antwortet mit Fehler ${res.status}`);
      return res.json();
    }
    throw new Error('MusicBrainz ist gerade ausgelastet – bitte gleich noch einmal versuchen');
  };
  const p = mbChain.then(run, run);
  mbChain = p.catch(() => {});
  return p;
}

async function itFetch(path) {
  const res = await fetch(`https://itunes.apple.com/${path}`);
  if (!res.ok) throw new Error(`iTunes antwortet mit Fehler ${res.status}`);
  return res.json();
}

/* --------------------------------------------------------------- Quellen */

const credit = (ac) => (ac ?? []).map((a) => a.name + (a.joinphrase ?? '')).join('').trim();
const phrase = (s) => `"${s.replace(/["\\]/g, '\\$&')}"`;
const terms = (s) => s.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim();
const cleanItunesTitle = (s) => (s ?? '').replace(/\s+-\s+(Single|EP)$/i, '');

function mbRelease(r) {
  const formats = [...new Set((r.media ?? []).map((m) => m.format).filter(Boolean))];
  return {
    source: 'mb', id: r.id, rgid: r['release-group']?.id,
    title: r.title, artist: credit(r['artist-credit']), year: (r.date ?? '').slice(0, 4),
    country: r.country ?? '', format: formats.join(' + '), trackCount: r['track-count'] ?? 0, media: (r.media ?? []).length || 1,
    type: r['release-group']?.['primary-type'] ?? '', status: r.status ?? '',
    secondary: r['release-group']?.['secondary-types'] ?? [],
    label: r['label-info']?.[0]?.label?.name ?? '',
    thumbs: [`https://coverartarchive.org/release/${r.id}/front-250`, r['release-group'] && `https://coverartarchive.org/release-group/${r['release-group'].id}/front-250`].filter(Boolean),
  };
}

const SOURCES = {
  mb: {
    name: 'MusicBrainz',
    async search(mode, artist, query) {
      const field = mode === 'album' ? 'release' : 'recording';
      const build = (fn) => [`${field}:${fn(query)}`, artist && `artist:${fn(artist)}`].filter(Boolean).join(' AND ');
      const run = async (q) => {
        if (mode === 'album') {
          const data = await mbFetch(`release/?query=${encodeURIComponent(q)}&limit=15`);
          return (data.releases ?? []).map(mbRelease);
        }
        const data = await mbFetch(`recording/?query=${encodeURIComponent(q)}&limit=15`);
        const out = [];
        for (const rec of data.recordings ?? []) {
          for (const rel of (rec.releases ?? []).slice(0, 10)) {
            out.push({ ...mbRelease(rel), artist: credit(rel['artist-credit']) || credit(rec['artist-credit']), hint: rec.title });
          }
        }
        return out;
      };
      let results = await run(build(phrase));
      if (!results.length) results = await run(build((s) => `(${terms(s)})`));
      const seen = new Set();
      return results.filter((r) => !seen.has(r.id) && seen.add(r.id));
    },
    async release(result) {
      const r = await mbFetch(`release/${result.id}?inc=recordings+artist-credits+release-groups+genres+labels`);
      const genreCounts = new Map();
      for (const g of [...(r.genres ?? []), ...(r['release-group']?.genres ?? [])]) genreCounts.set(g.name, (genreCounts.get(g.name) ?? 0) + (g.count || 1));
      const genre = [...genreCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const discs = (r.media ?? []).length;
      const rgid = r['release-group']?.id;
      const hasFront = r['cover-art-archive']?.front;
      return {
        title: r.title,
        artist: credit(r['artist-credit']),
        year: (r['release-group']?.['first-release-date'] || r.date || '').slice(0, 4),
        genre: genre ? changeCase(genre, 'title') : '',
        label: r['label-info']?.[0]?.label?.name ?? '',
        tracks: (r.media ?? []).flatMap((m) => (m.tracks ?? []).map((t) => ({
          disc: m.position ?? 1, discs, track: t.position, trackTotal: m['track-count'] ?? m.tracks.length,
          title: t.title, artist: credit(t['artist-credit']) || credit(r['artist-credit']),
          duration: (t.length ?? t.recording?.length ?? 0) / 1000,
        }))),
        coverUrls: (size) => [
          hasFront !== false && `https://coverartarchive.org/release/${result.id}/front-${size >= 1000 ? 1200 : 500}`,
          rgid && `https://coverartarchive.org/release-group/${rgid}/front-${size >= 1000 ? 1200 : 500}`,
        ].filter(Boolean),
        thumb: result.thumbs?.[0],
      };
    },
  },
  itunes: {
    name: 'iTunes',
    async search(mode, artist, query) {
      const term = encodeURIComponent([artist, query].filter(Boolean).join(' '));
      const data = await itFetch(`search?term=${term}&entity=${mode === 'album' ? 'album' : 'song'}&limit=20&country=${COUNTRY}`);
      const seen = new Set();
      return (data.results ?? []).filter((r) => r.collectionId && !seen.has(r.collectionId) && seen.add(r.collectionId)).map((r) => ({
        source: 'itunes', id: r.collectionId,
        title: cleanItunesTitle(r.collectionName), artist: r.collectionArtistName || r.artistName,
        year: (r.releaseDate ?? '').slice(0, 4), country: r.country ?? '', trackCount: r.trackCount ?? 0,
        format: r.collectionType ?? (mode === 'album' ? 'Album' : ''), genre: r.primaryGenreName ?? '',
        type: /\s-\s(Single|EP)$/i.test(r.collectionName ?? '') ? 'Single' : /compilation/i.test(r.collectionType ?? '') ? 'Compilation' : 'Album',
        thumbs: [r.artworkUrl100?.replace('100x100bb', '200x200bb')].filter(Boolean), art: r.artworkUrl100,
        hint: mode === 'title' ? r.trackName : '',
      }));
    },
    async release(result) {
      const data = await itFetch(`lookup?id=${result.id}&entity=song&country=${COUNTRY}`);
      const coll = data.results?.find((r) => r.wrapperType === 'collection') ?? {};
      const songs = (data.results ?? []).filter((r) => r.wrapperType === 'track');
      const art = coll.artworkUrl100 ?? result.art;
      return {
        title: cleanItunesTitle(coll.collectionName ?? result.title),
        artist: coll.artistName ?? result.artist,
        year: (coll.releaseDate ?? '').slice(0, 4),
        genre: coll.primaryGenreName ?? '',
        label: (coll.copyright ?? '').replace(/^[℗©]\s*\d{4}\s*/, ''),
        tracks: songs.map((s) => ({
          disc: s.discNumber ?? 1, discs: s.discCount ?? 1, track: s.trackNumber, trackTotal: s.trackCount,
          title: s.trackName, artist: s.artistName, duration: (s.trackTimeMillis ?? 0) / 1000,
        })),
        coverUrls: (size) => (art ? [art.replace('100x100bb', size >= 1000 ? '1200x1200bb' : '600x600bb')] : []),
        thumb: result.thumbs?.[0],
      };
    },
  },
};

/* ------------------------------------------------------------ Zuordnung */

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[([].*?[)\]]/g, ' ').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function dice(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); } return m; };
  const A = grams(a), B = grams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}

// Titel aus Tag oder Dateiname ("01 - Artist - Titel.mp3" → "Titel")
function fileTitle(file) {
  const t = value(file, 'title');
  if (t) return t;
  const base = stripTrackPrefix(file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
  return base.includes(' - ') ? base.split(' - ').pop() : base;
}
function fileArtist(file) {
  const a = value(file, 'artist');
  if (a) return a;
  const base = stripTrackPrefix(file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' '));
  const parts = base.split(' - ');
  return parts.length > 1 ? parts[0] : '';
}

function pairScore(file, t) {
  let s = dice(fileTitle(file), t.title) * 0.6;
  const n = parseInt(value(file, 'track'), 10);
  const d = parseInt(value(file, 'disc'), 10) || 1;
  if (n && n === t.track && d === t.disc) s += 0.3;
  const fd = file.info?.duration;
  if (fd && t.duration) {
    const diff = Math.abs(fd - t.duration);
    s += diff < 2.5 ? 0.25 : diff < 6 ? 0.1 : diff > 25 ? -0.25 : 0;
  }
  return s;
}

export function matchTracks(files, tracks) {
  const pairs = [];
  files.forEach((f, fi) => tracks.forEach((t, ti) => pairs.push({ fi, ti, s: pairScore(f, t) })));
  pairs.sort((a, b) => b.s - a.s);
  const byFile = new Map();
  const used = new Set();
  for (const p of pairs) {
    if (p.s < 0.32 || byFile.has(p.fi) || used.has(p.ti)) continue;
    byFile.set(p.fi, p);
    used.add(p.ti);
  }
  // Nichts erkannt, aber gleiche Anzahl: nach Dateinamen der Reihe nach zuordnen.
  if (!byFile.size && files.length === tracks.length) {
    const order = files.map((f, i) => i).sort((a, b) => files[a].name.localeCompare(files[b].name, 'de', { numeric: true }));
    order.forEach((fi, i) => byFile.set(fi, { fi, ti: i, s: 0.2 }));
  }
  return files.map((f, fi) => {
    const p = byFile.get(fi);
    return { file: f, ti: p ? p.ti : -1, confidence: p ? (p.s >= 0.7 ? 'ok' : 'weak') : 'none' };
  });
}

function resultQuality(r, group) {
  // Album-Modus vergleicht den Albumnamen, Titel-Modus den gefundenen Songtitel.
  const name = group.mode === 'album' ? r.title : r.hint || r.title;
  let s = dice(name, group.mode === 'album' ? group.query.album : group.query.title) * 55 + dice(r.artist, group.query.artist) * 25;
  if (!group.query.artist) s += 12;
  if (group.mode === 'album') {
    const n = group.files.length;
    s += r.trackCount === n ? 15 : r.trackCount > n ? 5 : -10;
  } else {
    // Einzeltitel lieber dem Originalalbum zuordnen als einer Single oder Compilation
    s += r.type === 'Album' ? 6 : r.type === 'Single' || r.type === 'EP' ? -4 : r.type === 'Compilation' ? -3 : 0;
  }
  s += { Official: 3, Bootleg: -10, Promotion: -3, 'Pseudo-Release': -4 }[r.status] ?? 0;
  if (r.type === 'Album') s += 2;
  if (r.secondary?.some((t) => /Live|Compilation|DJ-mix|Remix|Mixtape|Soundtrack/i.test(t))) s -= group.mode === 'album' ? 2 : 7;
  if (!r.year) s -= 3;
  if (/DVD|Blu-ray|VHS|Video|UMD/i.test(r.format)) s -= 10;
  else if (/CD|Digital/i.test(r.format)) s += 4;
  else if (/Vinyl|Cassette|"/i.test(r.format)) s -= 5;
  if (r.media > 1 && !group.files.some((f) => value(f, 'disc'))) s -= 4;
  return s;
}

// Sortiert Treffer nach Qualität; bei Gleichstand gewinnt die frühere Veröffentlichung.
function rankResults(results, group) {
  const years = results.map((r) => +r.year).filter(Boolean);
  const first = years.length ? Math.min(...years) : 0;
  for (const r of results) r.quality = resultQuality(r, group) - (first && +r.year ? Math.min(8, (+r.year - first) * 0.5) : 0);
  return results.sort((a, b) => b.quality - a.quality).slice(0, 25);
}

/* ----------------------------------------------------------- Änderungen */

const DEFAULTS = { source: 'mb', onlyEmpty: true, bigCover: false, fields: ['title', 'artist', 'album', 'albumartist', 'year', 'track', 'disc', 'genre', 'cover'] };

function changesFor(file, t, rel, o) {
  const next = {};
  const f = new Set(o.fields);
  const put = (k, v) => {
    if (v == null || v === '' || v === 0) return;
    if (o.onlyEmpty && value(file, k)) return;
    if (String(v) !== value(file, k)) next[k] = String(v);
  };
  if (f.has('album')) put('album', rel.title);
  if (f.has('albumartist')) put('albumartist', rel.artist);
  if (f.has('year')) put('year', rel.year);
  if (f.has('genre')) put('genre', rel.genre);
  if (t) {
    if (f.has('title')) put('title', t.title);
    if (f.has('artist')) put('artist', t.artist);
    if (f.has('track')) { put('track', t.track); put('tracktotal', t.trackTotal); }
    if (f.has('disc') && t.discs > 1) { put('disc', t.disc); put('disctotal', t.discs); }
  }
  return next;
}

const hasCoverNow = (file) => { const pc = pendingCover(file); return pc === undefined ? file.hasCover : pc !== null; };

async function fetchCover(rel, big) {
  for (const url of rel.coverUrls(big ? 1200 : 600)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = new Uint8Array(await res.arrayBuffer());
      const info = imageInfo(data);
      if (['image/jpeg', 'image/png'].includes(info.mime)) return { mime: info.mime, data };
    } catch { /* nächste Quelle */ }
  }
  return null;
}

/* -------------------------------------------------------------- Gruppen */

function buildGroups(files) {
  const groups = [];
  const albums = new Map();
  for (const f of files) {
    const album = value(f, 'album');
    if (!album) { groups.push({ files: [f], mode: 'title' }); continue; }
    const key = `${f.dir}|${album}`;
    if (!albums.has(key)) { albums.set(key, { files: [], mode: 'album' }); groups.push(albums.get(key)); }
    albums.get(key).files.push(f);
  }
  for (const g of groups) {
    const first = g.files[0];
    if (g.mode === 'album') {
      const counts = new Map();
      for (const f of g.files) { const a = value(f, 'albumartist') || value(f, 'artist'); if (a) counts.set(a, (counts.get(a) ?? 0) + 1); }
      const artist = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      g.query = { artist: /^various/i.test(artist) ? '' : artist, album: value(first, 'album'), title: '' };
      g.name = value(first, 'album');
    } else {
      g.query = { artist: fileArtist(first), album: '', title: fileTitle(first) };
      g.name = g.query.title || first.name;
    }
    g.status = 'open';
    g.results = null;
  }
  return groups;
}

/* --------------------------------------------------------------- Dialog */

export function openLookup(ctx = {}) {
  if (!state.files.length) { toast('Öffne zuerst einen Ordner mit Musik.'); return; }
  const scopeFiles = selectedFiles().length ? selectedFiles() : state.view;
  const groups = buildGroups(scopeFiles);
  const o = { ...DEFAULTS, ...load('lookup', {}) };
  let current = 0;
  let release = null;   // { result, data, mapping }
  let busy = false;
  let searchSeq = 0;

  const fieldChip = (k, text) => `<label class="check pill"><input type="checkbox" name="lf" value="${k}" ${o.fields.includes(k) ? 'checked' : ''}><span class="box">${icon('check')}</span><span>${text}</span></label>`;
  const body = h(`
    <div class="lookup">
      <div class="lk-side">
        <div class="lk-groups"></div>
        <div class="seg lk-source">
          <label><input type="radio" name="source" value="mb" ${o.source === 'mb' ? 'checked' : ''}><span>MusicBrainz</span></label>
          <label><input type="radio" name="source" value="itunes" ${o.source === 'itunes' ? 'checked' : ''}><span>iTunes</span></label>
        </div>
        <form class="lk-search">
          <div class="seg lk-mode">
            <label><input type="radio" name="mode" value="album"><span>${icon('disc')}Album</span></label>
            <label><input type="radio" name="mode" value="title"><span>${icon('music')}Einzelner Titel</span></label>
          </div>
          <input class="input" name="artist" placeholder="Interpret" autocomplete="off" spellcheck="false">
          <div class="lk-query">
            <input class="input" name="query" placeholder="Album" autocomplete="off" spellcheck="false">
            <button class="btn primary" type="submit">${icon('search')}</button>
          </div>
        </form>
        <div class="lk-results"></div>
      </div>
      <div class="lk-main">
        <div class="lk-release"></div>
        <div class="lk-options">
          <div class="check-grid">
            ${fieldChip('title', 'Titel')}${fieldChip('artist', 'Interpret')}${fieldChip('album', 'Album')}${fieldChip('albumartist', 'Album-Interpret')}
            ${fieldChip('year', 'Jahr')}${fieldChip('track', 'Track-Nr.')}${fieldChip('disc', 'Disc-Nr.')}${fieldChip('genre', 'Genre')}${fieldChip('cover', 'Cover')}
          </div>
          <div class="lk-switches">
            <label class="check"><input type="checkbox" name="onlyEmpty" ${o.onlyEmpty ? 'checked' : ''}><span class="box">${icon('check')}</span><span>Nur leere Felder füllen</span></label>
            <label class="check"><input type="checkbox" name="bigCover" ${o.bigCover ? 'checked' : ''}><span class="box">${icon('check')}</span><span>Cover in hoher Auflösung</span></label>
          </div>
        </div>
        <div class="lk-map"></div>
      </div>
    </div>`);
  const footer = h(`<div class="foot-wrap">
      <span class="foot-info"><span class="note">${icon('shield')}Nur Suchbegriffe werden gesendet – deine Dateien bleiben lokal.</span></span>
      <div class="foot-spacer"></div>
      ${groups.length > 1 ? `<button class="btn ghost" data-act="auto" title="Für jedes Album den besten Treffer automatisch übernehmen">${icon('zap')}<span>Alle automatisch</span></button>` : ''}
      <button class="btn ghost" data-act="cancel">Schließen</button>
      <button class="btn primary" data-act="apply" disabled>${icon('check')}<span>Übernehmen</span></button>
    </div>`);
  const modal = openModal({ title: 'Online nachschlagen', subtitle: 'Fehlende Metadaten und Cover von MusicBrainz oder iTunes übernehmen', iconName: 'search', body, footer, className: 'modal-action modal-lookup' });

  const form = $('.lk-search', body);
  const resultsEl = $('.lk-results', body);
  const releaseEl = $('.lk-release', body);
  const mapEl = $('.lk-map', body);
  const applyBtn = $('[data-act=apply]', footer);

  const readOptions = () => {
    o.source = $('[name=source]:checked', body).value;
    o.onlyEmpty = $('[name=onlyEmpty]', body).checked;
    o.bigCover = $('[name=bigCover]', body).checked;
    o.fields = $$('[name=lf]:checked', body).map((el) => el.value);
    store('lookup', o);
  };

  function renderGroups() {
    const el = $('.lk-groups', body);
    if (groups.length < 2) { el.hidden = true; return; }
    el.innerHTML = `<div class="lbl">${plural(groups.length, 'Gruppe', 'Gruppen')}</div><div class="lk-chips">${groups.map((g, i) => `
      <button class="lk-chip ${i === current ? 'active' : ''} st-${g.status}" data-g="${i}" title="${esc(g.name)}">
        <i>${g.status === 'done' ? icon('check') : g.status === 'miss' ? icon('x') : g.status === 'busy' ? icon('refresh') : icon(g.mode === 'album' ? 'disc' : 'music')}</i>
        <span>${esc(g.name)}</span>${g.files.length > 1 ? `<b>${g.files.length}</b>` : ''}
      </button>`).join('')}</div>`;
  }

  function loadGroup(i) {
    current = i;
    release = null;
    const g = groups[i];
    $(`[name=mode][value=${g.mode}]`, form).checked = true;
    form.artist.value = g.query.artist;
    form.query.value = g.mode === 'album' ? g.query.album : g.query.title;
    form.query.placeholder = g.mode === 'album' ? 'Album' : 'Titel';
    renderGroups();
    renderRelease();
    if (g.results) renderResults(g.results); else search();
  }

  async function search() {
    readOptions();
    const g = groups[current];
    g.mode = $('[name=mode]:checked', form).value;
    g.query = { artist: form.artist.value.trim(), album: g.mode === 'album' ? form.query.value.trim() : '', title: g.mode === 'title' ? form.query.value.trim() : '' };
    const q = g.mode === 'album' ? g.query.album : g.query.title;
    if (!q) { resultsEl.innerHTML = `<div class="pv-empty">${icon('search')}<span>${g.mode === 'album' ? 'Albumname' : 'Titel'} eingeben</span></div>`; return; }
    const my = ++searchSeq;
    resultsEl.innerHTML = `<div class="lk-loading">${'<div class="lk-skel"></div>'.repeat(5)}</div>`;
    try {
      const results = await SOURCES[o.source].search(g.mode, g.query.artist, q);
      if (my !== searchSeq) return;
      g.results = rankResults(results, g);
      renderResults(g.results);
      if (g.results.length && g.results[0].quality >= 70) pick(g.results[0]);
    } catch (err) {
      if (my !== searchSeq) return;
      resultsEl.innerHTML = `<div class="pv-empty error">${icon('alert')}<span>${esc(err.message === 'Failed to fetch' ? 'Keine Verbindung zum Dienst' : err.message)}</span></div>`;
    }
  }

  function renderResults(results) {
    const g = groups[current];
    if (!results.length) {
      resultsEl.innerHTML = `<div class="pv-empty">${icon('search')}<span>Keine Treffer bei ${SOURCES[o.source].name}.<br>Suchbegriffe anpassen oder andere Quelle wählen.</span></div>`;
      return;
    }
    resultsEl.innerHTML = results.map((r, i) => {
      const fit = g.mode === 'album' && r.trackCount === g.files.length;
      const meta = [r.year, r.country, r.format, r.trackCount ? `${r.trackCount} Tracks` : ''].filter(Boolean).join(' · ');
      return `<button class="lk-result ${release?.result === r ? 'active' : ''}" data-r="${i}">
        <span class="lk-thumb" data-thumbs="${esc(r.thumbs.join(' '))}">${icon('disc')}</span>
        <span class="lk-rtext">
          <b>${esc(r.title)}</b>
          <span>${esc(r.artist || 'Unbekannt')}${r.hint && g.mode === 'title' ? ` · <em>${esc(r.hint)}</em>` : ''}</span>
          <small>${esc(meta)}${fit ? ` <i class="fit">${icon('check')}passt</i>` : ''}</small>
        </span>
      </button>`;
    }).join('');
    $$('.lk-thumb', resultsEl).forEach((el) => {
      const urls = el.dataset.thumbs.split(' ').filter(Boolean);
      const tryNext = () => {
        const url = urls.shift();
        if (!url) return;
        const img = new Image();
        img.onload = () => { el.innerHTML = ''; el.appendChild(img); };
        img.onerror = tryNext;
        img.src = url;
      };
      tryNext();
    });
  }

  async function pick(result) {
    const g = groups[current];
    $$('.lk-result', resultsEl).forEach((b) => b.classList.toggle('active', g.results?.[+b.dataset.r] === result));
    releaseEl.innerHTML = `<div class="lk-rel-loading"><div class="loading-disc small"></div><span>Lade Trackliste …</span></div>`;
    mapEl.innerHTML = '';
    applyBtn.disabled = true;
    try {
      const data = await SOURCES[result.source].release(result);
      if (groups[current] !== g) return;
      release = { result, data, mapping: matchTracks(g.files, data.tracks) };
      renderRelease();
    } catch (err) {
      releaseEl.innerHTML = `<div class="pv-empty error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
    }
  }

  function renderRelease() {
    if (!release) {
      releaseEl.innerHTML = `<div class="lk-placeholder">${icon('disc')}<span>Wähle links einen Treffer – die Zuordnung zu deinen Dateien erscheint hier.</span></div>`;
      mapEl.innerHTML = '';
      applyBtn.disabled = true;
      return;
    }
    const { data, result } = release;
    releaseEl.innerHTML = `
      <div class="lk-rel">
        <div class="lk-rel-cover">${icon('disc')}</div>
        <div class="lk-rel-text">
          <b>${esc(data.title)}</b>
          <span>${esc(data.artist)}</span>
          <small>${esc([data.year, data.genre, data.label, plural(data.tracks.length, 'Track', 'Tracks')].filter(Boolean).join(' · '))}</small>
        </div>
        <span class="lk-src">${SOURCES[result.source].name}</span>
      </div>`;
    const coverEl = $('.lk-rel-cover', releaseEl);
    const urls = [...(data.thumb ? [data.thumb] : []), ...data.coverUrls(600)];
    const tryNext = () => {
      const url = urls.shift();
      if (!url) return;
      const img = new Image();
      img.onload = () => { coverEl.innerHTML = ''; coverEl.appendChild(img); };
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();
    renderMapping();
  }

  function renderMapping() {
    if (!release) return;
    readOptions();
    const { data, mapping } = release;
    const options = data.tracks.map((t, i) => `<option value="${i}">${t.discs > 1 ? `${t.disc}-` : ''}${String(t.track).padStart(2, '0')} · ${esc(t.title)}${t.duration ? ` (${formatDuration(t.duration)})` : ''}</option>`).join('');
    let count = 0;
    mapEl.innerHTML = mapping.map((m, i) => {
      const t = data.tracks[m.ti];
      const changes = changesFor(m.file, t, data, o);
      const cover = o.fields.includes('cover') && (!o.onlyEmpty || !hasCoverNow(m.file));
      if (Object.keys(changes).length || cover) count++;
      return `<div class="lk-row conf-${m.confidence}">
        <div class="lk-row-head">
          <span class="lk-conf" title="${{ ok: 'Sichere Zuordnung', weak: 'Unsichere Zuordnung – bitte prüfen', none: 'Nicht zugeordnet' }[m.confidence]}"></span>
          <span class="lk-file mono" title="${esc(m.file.path)}">${esc(m.file.name)}</span>
          <select class="input lk-select" data-m="${i}"><option value="-1">— nicht zuordnen —</option>${options}</select>
        </div>
        <div class="pv-changes">${Object.entries(changes).map(([k, v]) => {
          const old = value(m.file, k);
          return `<span class="chg"><em>${label(k)}</em>${old ? `<s>${esc(old)}</s>` : '<s class="empty">leer</s>'}${icon('arrowRight')}<ins>${esc(v)}</ins></span>`;
        }).join('')}${cover ? `<span class="chg"><em>Cover</em><ins>${hasCoverNow(m.file) ? 'ersetzen' : 'hinzufügen'}</ins></span>` : ''}
        ${!Object.keys(changes).length && !cover ? '<span class="chg"><em>Keine Änderungen</em></span>' : ''}</div>
      </div>`;
    }).join('');
    $$('.lk-select', mapEl).forEach((sel) => { sel.value = String(mapping[+sel.dataset.m].ti); });
    applyBtn.disabled = count === 0 || busy;
    applyBtn.querySelector('span').textContent = count ? `Übernehmen (${count})` : 'Übernehmen';
  }

  async function applyRelease(g, rel, { record = true } = {}) {
    const rows = [];
    for (const m of rel.mapping) {
      const changes = changesFor(m.file, rel.data.tracks[m.ti], rel.data, o);
      if (Object.keys(changes).length) rows.push({ id: m.file.id, tags: changes });
    }
    const coverIds = o.fields.includes('cover') ? g.files.filter((f) => !o.onlyEmpty || !hasCoverNow(f)).map((f) => f.id) : [];
    if (rows.length) setTags(rows, { record });
    let coverOk = true;
    if (coverIds.length) {
      const cover = await fetchCover(rel.data, o.bigCover);
      if (cover) setCover(coverIds, cover, { record: record && !rows.length });
      else coverOk = false;
    }
    const touched = new Set([...rows.map((r) => r.id), ...(coverOk ? coverIds : [])]);
    return { files: touched.size, coverMissing: !coverOk && coverIds.length > 0 };
  }

  function nextOpen() {
    const i = groups.findIndex((g, idx) => idx > current && g.status === 'open');
    return i >= 0 ? i : groups.findIndex((g) => g.status === 'open');
  }

  async function apply() {
    if (!release || busy) return;
    busy = true;
    applyBtn.disabled = true;
    applyBtn.querySelector('span').textContent = 'Übernehme …';
    const g = groups[current];
    try {
      const r = await applyRelease(g, release);
      g.status = 'done';
      toast(`${release.data.title}: ${plural(r.files, 'Titel', 'Titel')} ergänzt – noch nicht gespeichert`, {
        type: r.coverMissing ? 'warning' : 'success', detail: r.coverMissing ? 'Kein Cover bei dieser Quelle gefunden' : undefined,
        action: ctx.save, actionLabel: 'Speichern',
      });
    } finally { busy = false; }
    const next = nextOpen();
    if (next >= 0) loadGroup(next); else modal.close();
  }

  async function autoAll() {
    if (busy) return;
    busy = true;
    readOptions();
    const autoBtn = $('[data-act=auto]', footer);
    autoBtn.disabled = applyBtn.disabled = true;
    let done = 0, miss = 0, first = true;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.status !== 'open') continue;
      current = i;
      g.status = 'busy';
      renderGroups();
      try {
        const q = g.mode === 'album' ? g.query.album : g.query.title;
        const results = q ? await SOURCES[o.source].search(g.mode, g.query.artist, q) : [];
        g.results = rankResults(results, g);
        const best = g.results[0]?.quality >= 70 ? g.results[0] : null;
        if (!best) { g.status = 'miss'; miss++; continue; }
        const data = await SOURCES[o.source].release(best);
        const mapping = matchTracks(g.files, data.tracks);
        const solid = mapping.filter((m) => m.confidence === 'ok').length;
        if (g.mode === 'album' && solid < Math.ceil(g.files.length / 2)) { g.status = 'miss'; miss++; continue; }
        await applyRelease(g, { result: best, data, mapping }, { record: first });
        first = false;
        g.status = 'done';
        done++;
      } catch {
        g.status = 'miss';
        miss++;
      }
      renderGroups();
    }
    busy = false;
    autoBtn.disabled = false;
    renderGroups();
    toast(`${plural(done, 'Gruppe', 'Gruppen')} automatisch ergänzt${miss ? `, ${miss} ohne sicheren Treffer` : ''}`, {
      type: done ? 'success' : 'warning', duration: 7000, action: done ? ctx.save : undefined, actionLabel: 'Speichern',
      detail: miss ? 'Die markierten Gruppen kannst du einzeln von Hand zuordnen.' : undefined,
    });
    const next = groups.findIndex((g) => g.status === 'miss' || g.status === 'open');
    if (next >= 0) loadGroup(next); else modal.close();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); search(); });
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'mode') return;
    const g = groups[current];
    form.query.placeholder = e.target.value === 'album' ? 'Album' : 'Titel';
    form.query.value = e.target.value === 'album' ? value(g.files[0], 'album') : fileTitle(g.files[0]);
    g.results = null;
    search();
  });
  $('.lk-source', body).addEventListener('change', () => { groups.forEach((g) => { g.results = null; }); release = null; renderRelease(); search(); });
  $('.lk-options', body).addEventListener('change', renderMapping);
  resultsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.lk-result');
    if (b) pick(groups[current].results[+b.dataset.r]);
  });
  mapEl.addEventListener('change', (e) => {
    const sel = e.target.closest('.lk-select');
    if (!sel || !release) return;
    const m = release.mapping[+sel.dataset.m];
    m.ti = +sel.value;
    m.confidence = m.ti < 0 ? 'none' : 'ok';
    renderMapping();
  });
  $('.lk-groups', body).addEventListener('click', (e) => {
    const chip = e.target.closest('.lk-chip');
    if (chip && !busy) loadGroup(+chip.dataset.g);
  });
  footer.querySelector('[data-act=cancel]').onclick = () => modal.close();
  footer.querySelector('[data-act=auto]')?.addEventListener('click', autoAll);
  applyBtn.onclick = apply;

  loadGroup(0);
}
