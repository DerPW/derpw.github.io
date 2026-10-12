// Kern der OpenSCAD-Ausführung – läuft im Worker und (für Tests) in Node.
// Pro Auftrag gibt es eine frische Instanz; das kompilierte Modul wird wiederverwendet,
// deshalb kostet ein Start nur wenige Millisekunden.

import { parseOFF } from './off.js';

export function createEngine({ OpenSCAD, wasmModule, fetchFn = fetch }) {
  const fontCache = new Map();

  const FONTS_CONF = `<?xml version="1.0"?>
  <!DOCTYPE fontconfig SYSTEM "fonts.dtd">
  <fontconfig><dir>/fonts</dir><cachedir>/tmp/fontcache</cachedir></fontconfig>`;

  async function instance(logs) {
    return OpenSCAD({
      noInitialRun: true,
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(wasmModule, imports).then((inst) => done(inst, wasmModule));
        return {};
      },
      print: (s) => logs.push(s),
      printErr: (s) => logs.push(s),
    });
  }

  function mkdirp(FS, path) {
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts.slice(0, -1)) {
      cur += '/' + part;
      try { FS.mkdir(cur); } catch { /* existiert schon */ }
    }
  }

  async function loadFonts(urls) {
    const out = [];
    for (const url of urls) {
      let data = fontCache.get(url);
      if (!data) {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`Schrift nicht geladen: ${url}`);
        data = new Uint8Array(await res.arrayBuffer());
        fontCache.set(url, data);
      }
      out.push([url.split('/').pop(), data]);
    }
    return out;
  }

  // Ein einzelner OpenSCAD-Lauf mit eigener Instanz.
  async function run(job, outputs, fonts, { quietLogs = false } = {}) {
    const logs = [];
    const inst = await instance(logs);
    const { FS } = inst;
    if (fonts.length) {
      FS.mkdir('/fonts');
      for (const [name, data] of fonts) FS.writeFile('/fonts/' + name, data);
      FS.writeFile('/fonts/fonts.conf', FONTS_CONF);
    }
    for (const [path, data] of Object.entries(job.files ?? {})) {
      const p = path.startsWith('/') ? path : '/' + path;
      mkdirp(FS, p);
      FS.writeFile(p, data);
    }
    FS.writeFile('/input.scad', job.source);

    const args = ['/input.scad'];
    for (const o of outputs) args.push('-o', `/out.${o.ext}`, ...(o.format ? [`--export-format=${o.format}`] : []));
    for (const [k, v] of Object.entries(job.defines ?? {})) args.push('-D', `${k}=${v}`);
    if (job.backend) args.push(`--backend=${job.backend}`);

    const t0 = performance.now();
    let code = 0;
    try {
      code = inst.callMain(args);
    } catch (e) {
      // exit() aus dem Programm landet hier als ExitStatus
      if (typeof e?.status === 'number') code = e.status;
      else { logs.push(`ERROR: ${e?.message ?? e}`); code = 1; }
    }
    const ms = performance.now() - t0;

    const files = {};
    for (const o of outputs) {
      try { files[o.ext] = FS.readFile(`/out.${o.ext}`); } catch { /* nicht erzeugt */ }
    }
    return { code, ms, files, logs: quietLogs ? [] : logs };
  }

  async function render(job) {
    const fonts = job.fonts?.length ? await loadFonts(job.fonts) : [];
    const started = performance.now();

    if (job.export) {
      const fmt = job.export;
      const r = await run(job, [{ ext: fmt.ext, format: fmt.format }], fonts);
      const data = r.files[fmt.ext];
      return { type: 'export', ok: !!data, data, logs: r.logs, ms: r.ms };
    }

    // 1) 3D versuchen
    let r = await run(job, [{ ext: 'off' }], fonts);
    let result;
    if (r.files.off) {
      const mesh = parseOFF(r.files.off);
      result = { type: 'render', ok: true, dim: 3, mesh, off: r.files.off, logs: r.logs, ms: r.ms };
    } else if (r.logs.some((l) => /top level object is not a 3D object/i.test(l))) {
      // 2) Es ist ein 2D-Modell → als SVG holen
      r = await run(job, [{ ext: 'svg' }], fonts);
      const svg = r.files.svg ? new TextDecoder().decode(r.files.svg) : null;
      result = { type: 'render', ok: !!svg, dim: 2, svg, logs: r.logs, ms: r.ms };
    } else {
      result = { type: 'render', ok: false, dim: 0, logs: r.logs, ms: r.ms };
    }

    // 3) Customizer-Parameter (nur bei neuem Quelltext nötig)
    // Parameter stammen nur aus der Hauptdatei – Bibliotheken weglassen spart bei BOSL2 eine Sekunde.
    if (job.params) {
      const lean = { source: job.source.replace(/^[ \t]*(?:include|use)[ \t]*<[^>\n]*>.*$/gm, ''), defines: {} };
      const p = await run(lean, [{ ext: 'param' }], [], { quietLogs: true });
      try { result.params = p.files.param ? JSON.parse(new TextDecoder().decode(p.files.param)) : null; } catch { result.params = null; }
    }
    result.total = performance.now() - started;
    return result;
  }

  return { render };
}
