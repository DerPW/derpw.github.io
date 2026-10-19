// UI strings for Lector Lite in German and English.

const STRINGS = {
  en: {
    'lang.switch': 'Deutsch',
    'tagline': 'Runs entirely in your browser',
    'hw.cores': '{n} cores',
    'hw.note': 'Only what the browser reveals: Safari does not name the chip, and memory is only known in Chrome and Edge (at most “8+ GB”).',
    'hero.title': 'Turn a book into an audiobook',
    'hero.lead': 'An EPUB or text in, an audiobook with chapters out. Read aloud by Kokoro, right in this browser: nothing is uploaded.',
    'drop.title': 'Drop an EPUB or text file here',
    'drop.hint': 'or tap to choose · .epub, .txt, .md',
    'drop.reading': 'Reading {name}…',
    'or': 'or',
    'paste.open': 'Paste text',
    'paste.title': 'Title',
    'paste.placeholder': 'Paste your text here. Lines like “Chapter 1” become chapters.',
    'paste.go': 'Continue',
    'book.other': 'Choose another book',
    'book.language': 'Language',
    'book.notEnglish': 'Kokoro reads English only. Text in {lang} will sound wrong; use the full Lector with Edge or Qwen3 for it.',
    'chapters': 'Chapters',
    'chapters.selected': '{n} of {total} selected',
    'chapters.all': 'All',
    'chapters.none': 'None',
    'chapters.words': '{n} words',
    'chapters.show': 'Show text',
    'voice': 'Voice',
    'voice.us': 'American',
    'voice.gb': 'British',
    'voice.female': 'female',
    'voice.male': 'male',
    'voice.best': 'best',
    'voice.play': 'Play sample',
    'voice.sample': 'Hi! This is how I sound when I read your book to you. Do you like my voice?',
    'speed': 'Speed',
    'output': 'Output',
    'format.m4b': 'M4B',
    'format.m4b.sub': 'audiobook',
    'format.mp3': 'MP3',
    'format.mp3.sub': 'per chapter',
    'quality': 'Quality',
    'runOn': 'Runs on',
    'runOn.gpu': 'Graphics chip',
    'runOn.gpu.sub': 'fast',
    'runOn.cpu': 'Processor',
    'runOn.cpu.sub': 'light',
    'runOn.note': 'Graphics chip: about 1.5 GB of memory. Processor: about 0.5 GB, but slower than real time. If the browser reloads the page in the middle of a book, memory ran out: switch to Processor, or close other tabs and apps.',
    'quality.48k': 'Compact',
    'quality.64k': 'Standard',
    'quality.96k': 'High',
    'summary': '{n} chapters · about {d} · about {s}',
    'start': 'Create audiobook',
    'model.note': 'The voice model (about {mb} MB) is loaded once and then kept by your browser.',
    'model.device.webgpu': 'Uses the graphics chip (WebGPU)',
    'model.device.wasm': 'Uses the processor (WebAssembly)',
    'keep.open': 'Keep this page open and in front: browsers pause pages in the background. The screen stays on by itself.',
    'step.loading': 'Load model',
    'step.synth': 'Read aloud',
    'step.export': 'Put together',
    'step.done': 'Done',
    'step.downloading': 'downloading {p} %',
    'time.left': 'about {d} left',
    'time.about': 'about {d}',
    'time.runningFor': 'running for {d}',
    'time.took': 'made in {d}',
    'chapter.of': 'Chapter {c} of {n}',
    'status.running': 'Reading',
    'status.pausing': 'Pausing…',
    'status.paused': 'Paused',
    'status.error': 'Failed',
    'status.done': 'Done',
    'job.pause': 'Pause',
    'job.pausing': 'stops after the passage being read',
    'status.deleting': 'Deleting…',
    'job.deleting': 'is removed after the passage being read',
    'job.resume': 'Continue',
    'job.retry': 'Try again',
    'job.delete': 'Delete',
    'job.deleteTitle': 'Delete “{title}”?',
    'job.deleteText': 'It stops, and the chapters read so far are removed from this browser.',
    'job.download': 'Download',
    'job.share': 'Share',
    'job.new': 'New audiobook',
    'job.done': 'Your audiobook is ready',
    'job.failed': 'Something went wrong: {msg}',
    'resume.title': 'Unfinished audiobook',
    'resume.text': '“{title}”: {done} of {total} chapters are done.',
    'resume.go': 'Continue',
    'resume.discard': 'Discard',
    'resume.discardTitle': 'Discard the unfinished audiobook?',
    'resume.discardText': 'The chapters read so far are removed from this browser.',
    'dialog.cancel': 'Cancel',
    'paused.hidden': 'Paused while the page was in the background; continuing.',
    'err.unsupported': 'This file type is not supported. Use EPUB, TXT or MD.',
    'err.empty': 'No readable text found.',
    'err.chapterLost': 'Chapter {n} is missing from browser storage. Delete the audiobook and start again.',
    'err.generic': 'Something went wrong: {msg}',
    'full': 'The full Lector (with Edge, Qwen3 and more) runs on your computer.',
    'tab.done': 'Done: {title}',
  },
  de: {
    'lang.switch': 'English',
    'tagline': 'Läuft komplett in deinem Browser',
    'hw.cores': '{n} Kerne',
    'hw.note': 'Nur was der Browser verrät: Safari nennt den Chip nicht, und den Arbeitsspeicher kennen nur Chrome und Edge (höchstens „8+ GB“).',
    'hero.title': 'Aus einem Buch wird ein Hörbuch',
    'hero.lead': 'EPUB oder Text rein, ein Hörbuch mit Kapiteln raus. Gelesen von Kokoro, direkt in diesem Browser: Nichts wird hochgeladen.',
    'drop.title': 'EPUB oder Textdatei hierher ziehen',
    'drop.hint': 'oder tippen zum Auswählen · .epub, .txt, .md',
    'drop.reading': '{name} wird gelesen…',
    'or': 'oder',
    'paste.open': 'Text einfügen',
    'paste.title': 'Titel',
    'paste.placeholder': 'Text hier einfügen. Zeilen wie „Chapter 1“ werden zu Kapiteln.',
    'paste.go': 'Weiter',
    'book.other': 'Anderes Buch wählen',
    'book.language': 'Sprache',
    'book.notEnglish': 'Kokoro liest nur Englisch. Text auf {lang} klingt falsch; dafür das volle Lector mit Edge oder Qwen3 nutzen.',
    'chapters': 'Kapitel',
    'chapters.selected': '{n} von {total} ausgewählt',
    'chapters.all': 'Alle',
    'chapters.none': 'Keine',
    'chapters.words': '{n} Wörter',
    'chapters.show': 'Text anzeigen',
    'voice': 'Stimme',
    'voice.us': 'amerikanisch',
    'voice.gb': 'britisch',
    'voice.female': 'weiblich',
    'voice.male': 'männlich',
    'voice.best': 'beste',
    'voice.play': 'Hörprobe abspielen',
    'voice.sample': 'Hi! This is how I sound when I read your book to you. Do you like my voice?',
    'speed': 'Tempo',
    'output': 'Ausgabe',
    'format.m4b': 'M4B',
    'format.m4b.sub': 'Hörbuch',
    'format.mp3': 'MP3',
    'format.mp3.sub': 'pro Kapitel',
    'quality': 'Qualität',
    'runOn': 'Rechnet auf',
    'runOn.gpu': 'Grafikchip',
    'runOn.gpu.sub': 'schnell',
    'runOn.cpu': 'Prozessor',
    'runOn.cpu.sub': 'sparsam',
    'runOn.note': 'Grafikchip: ca. 1,5 GB Arbeitsspeicher. Prozessor: ca. 0,5 GB, aber langsamer als Echtzeit. Lädt der Browser die Seite mitten im Buch neu, war der Speicher voll: Stell auf Prozessor um oder schließe andere Tabs und Apps.',
    'quality.48k': 'Kompakt',
    'quality.64k': 'Standard',
    'quality.96k': 'Hoch',
    'summary': '{n} Kapitel · ca. {d} · ca. {s}',
    'start': 'Hörbuch erstellen',
    'model.note': 'Das Stimmmodell (ca. {mb} MB) wird einmal geladen und dann vom Browser behalten.',
    'model.device.webgpu': 'Nutzt den Grafikchip (WebGPU)',
    'model.device.wasm': 'Nutzt den Prozessor (WebAssembly)',
    'keep.open': 'Lass die Seite offen und im Vordergrund: Browser pausieren Seiten im Hintergrund. Der Bildschirm bleibt von selbst an.',
    'step.loading': 'Modell laden',
    'step.synth': 'Vorlesen',
    'step.export': 'Zusammensetzen',
    'step.done': 'Fertig',
    'step.downloading': 'lädt herunter: {p} %',
    'time.left': 'noch ca. {d}',
    'time.about': 'ca. {d}',
    'time.runningFor': 'läuft seit {d}',
    'time.took': 'erstellt in {d}',
    'chapter.of': 'Kapitel {c} von {n}',
    'status.running': 'Liest',
    'status.pausing': 'Wird angehalten…',
    'status.paused': 'Pausiert',
    'status.error': 'Fehlgeschlagen',
    'status.done': 'Fertig',
    'job.pause': 'Pausieren',
    'job.pausing': 'hält nach dem aktuellen Abschnitt an',
    'status.deleting': 'Wird gelöscht…',
    'job.deleting': 'wird nach dem aktuellen Abschnitt gelöscht',
    'job.resume': 'Fortsetzen',
    'job.retry': 'Erneut versuchen',
    'job.delete': 'Löschen',
    'job.deleteTitle': '„{title}“ löschen?',
    'job.deleteText': 'Es wird angehalten, und die bisher gelesenen Kapitel werden aus diesem Browser gelöscht.',
    'job.download': 'Herunterladen',
    'job.share': 'Teilen',
    'job.new': 'Neues Hörbuch',
    'job.done': 'Dein Hörbuch ist fertig',
    'job.failed': 'Da ist etwas schiefgegangen: {msg}',
    'resume.title': 'Unfertiges Hörbuch',
    'resume.text': '„{title}“: {done} von {total} Kapiteln sind fertig.',
    'resume.go': 'Weitermachen',
    'resume.discard': 'Verwerfen',
    'resume.discardTitle': 'Unfertiges Hörbuch verwerfen?',
    'resume.discardText': 'Die bisher gelesenen Kapitel werden aus diesem Browser gelöscht.',
    'dialog.cancel': 'Abbrechen',
    'paused.hidden': 'Pausiert, solange die Seite im Hintergrund war; geht weiter.',
    'err.unsupported': 'Dieser Dateityp wird nicht unterstützt. EPUB, TXT oder MD verwenden.',
    'err.empty': 'Kein lesbarer Text gefunden.',
    'err.chapterLost': 'Kapitel {n} fehlt im Browserspeicher. Lösche das Hörbuch und starte es neu.',
    'err.generic': 'Da ist etwas schiefgegangen: {msg}',
    'full': 'Das volle Lector (mit Edge, Qwen3 und mehr) läuft auf deinem Computer.',
    'tab.done': 'Fertig: {title}',
  },
};

let lang = (() => {
  try {
    const saved = localStorage.getItem('lector-lite.lang');
    if (saved && STRINGS[saved]) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
})();

export const getLang = () => lang;

export function setLang(next) {
  lang = STRINGS[next] ? next : 'en';
  try { localStorage.setItem('lector-lite.lang', lang); } catch { /* ignore */ }
  document.documentElement.lang = lang;
}

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}

export function languageName(code) {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language' }).of(code);
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return code;
  }
}

export function duration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min`;
  return `${seconds} s`;
}

export function fileSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Math.max(0, bytes);
  let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1024; u += 1; }
  return `${n.toLocaleString(lang, { maximumFractionDigits: u >= 3 || n < 10 ? 1 : 0 })} ${units[u]}`;
}
