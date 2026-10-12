// OFF-Parser für die OpenSCAD-Ausgabe. Liest direkt aus den Bytes (kein TextDecoder,
// keine Millionen Teil-Strings) und liefert flache Dreiecksdaten für three.js.
// Flächen können eine Farbe tragen: "3 a b c r g b a" (0–255 oder 0–1).

const SP = 32, TAB = 9, LF = 10, CR = 13, HASH = 35;

export function parseOFF(bytes) {
  if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
  let p = 0;
  const n = bytes.length;

  // Ganze Zeile als Zahlenliste lesen (Farben sind optional, daher zeilenweise).
  let nums = new Float64Array(256);
  let isFloat = false;
  function readLine() {
    let count = 0;
    isFloat = false;
    for (;;) {
      while (p < n && (bytes[p] === SP || bytes[p] === TAB || bytes[p] === CR)) p++;
      if (p >= n) return count;
      const c = bytes[p];
      if (c === LF) { p++; if (count) return count; continue; }
      if (c === HASH) { while (p < n && bytes[p] !== LF) p++; continue; }
      // Zahl lesen
      let neg = false;
      if (c === 45) { neg = true; p++; } else if (c === 43) p++;
      let v = 0, d;
      while (p < n && (d = bytes[p] - 48) >= 0 && d <= 9) { v = v * 10 + d; p++; }
      if (p < n && bytes[p] === 46) {
        isFloat = true;
        p++;
        let f = 0.1;
        while (p < n && (d = bytes[p] - 48) >= 0 && d <= 9) { v += d * f; f *= 0.1; p++; }
      }
      if (p < n && (bytes[p] === 101 || bytes[p] === 69)) {
        isFloat = true;
        p++;
        let eneg = false;
        if (bytes[p] === 45) { eneg = true; p++; } else if (bytes[p] === 43) p++;
        let e = 0;
        while (p < n && (d = bytes[p] - 48) >= 0 && d <= 9) { e = e * 10 + d; p++; }
        v *= Math.pow(10, eneg ? -e : e);
      } else if (p < n && bytes[p] > SP && bytes[p] !== HASH) {
        // Unbekanntes Token (z. B. "OFF" in derselben Zeile) überspringen
        while (p < n && bytes[p] > SP) p++;
        continue;
      }
      if (count >= nums.length) { const nn = new Float64Array(nums.length * 2); nn.set(nums); nums = nn; }
      nums[count] = neg ? -v : v;
      count++;
    }
  }

  // Kopfzeile: "OFF" (evtl. mit Zählern in derselben Zeile)
  while (p < n && bytes[p] <= SP) p++;
  if (bytes[p] === 79 && bytes[p + 1] === 70 && bytes[p + 2] === 70) p += 3;
  else throw new Error('Keine OFF-Datei');
  let c = readLine();
  if (c < 2) throw new Error('OFF-Kopf unvollständig');
  const nv = nums[0], nf = nums[1];

  const verts = new Float64Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    c = readLine();
    verts[i * 3] = nums[0]; verts[i * 3 + 1] = nums[1]; verts[i * 3 + 2] = nums[2];
  }

  // Erst grob dimensionieren (Dreiecke), bei Polygonen wächst der Puffer.
  let cap = Math.max(nf, 1);
  let pos = new Float32Array(cap * 9);
  let col = new Uint8Array(cap * 4);
  let tris = 0;
  let anyColor = false, anyAlpha = false;
  const grow = () => {
    cap *= 2;
    const np = new Float32Array(cap * 9); np.set(pos); pos = np;
    const nc = new Uint8Array(cap * 4); nc.set(col); col = nc;
  };

  for (let f = 0; f < nf; f++) {
    c = readLine();
    const k = nums[0];
    if (!k || c < k + 1) continue;
    let r = 0, g = 0, b = 0, a = 0;
    const extra = c - 1 - k;
    if (extra >= 3) {
      const s = isFloat && nums[k + 1] <= 1 && nums[k + 2] <= 1 && nums[k + 3] <= 1 ? 255 : 1;
      r = Math.round(nums[k + 1] * s); g = Math.round(nums[k + 2] * s); b = Math.round(nums[k + 3] * s);
      a = extra >= 4 ? Math.round(nums[k + 4] * s) : 255;
      if (a === 0) a = 1; // 0 heißt bei uns „keine Farbe“
      // OpenSCAD schreibt für ungefärbte Teile die Standardfarben seines Farbschemas
      // (Cornfield: Gelb #f9d72c, Grün #9dcb51) – die behandeln wir als „keine Farbe“.
      if (a === 255 && ((r === 249 && g === 215 && b === 44) || (r === 157 && g === 203 && b === 81))) a = 0;
      else anyColor = true;
      if (a && a < 255) anyAlpha = true;
    }
    const i0 = nums[1];
    for (let j = 2; j < k; j++) {
      if (tris >= cap) grow();
      const o = tris * 9;
      const ia = i0 * 3, ib = nums[j] * 3, ic = nums[j + 1] * 3;
      pos[o] = verts[ia]; pos[o + 1] = verts[ia + 1]; pos[o + 2] = verts[ia + 2];
      pos[o + 3] = verts[ib]; pos[o + 4] = verts[ib + 1]; pos[o + 5] = verts[ib + 2];
      pos[o + 6] = verts[ic]; pos[o + 7] = verts[ic + 1]; pos[o + 8] = verts[ic + 2];
      const q = tris * 4;
      col[q] = r; col[q + 1] = g; col[q + 2] = b; col[q + 3] = a;
      tris++;
    }
  }

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) {
    for (let a = 0; a < 3; a++) {
      const v = verts[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }

  return {
    positions: pos.subarray(0, tris * 9).slice(),
    faceColors: anyColor ? col.subarray(0, tris * 4).slice() : null,
    triangles: tris,
    vertices: nv,
    hasAlpha: anyAlpha,
    bbox: nv ? { min, max } : null,
  };
}
