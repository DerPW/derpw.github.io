// ViewCube wie in Fusion: zeigt die Ausrichtung der Kamera und schaltet per Klick
// auf Fläche, Kante oder Ecke in die passende Ansicht. Ziehen am Würfel dreht die Kamera.
// Reines CSS-3D – scharfe Beschriftung, Klickflächen sind normale Elemente.

import { t } from './i18n.js';

const FACES = [
  // ex = Textrichtung rechts, ey = Textrichtung unten, ez = Außennormale (Welt, Z oben, vorne = −Y)
  { label: t('Oben'), ex: [1, 0, 0], ey: [0, -1, 0], ez: [0, 0, 1] },
  { label: t('Unten'), ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, -1] },
  { label: t('Vorne'), ex: [1, 0, 0], ey: [0, 0, -1], ez: [0, -1, 0] },
  { label: t('Hinten'), ex: [-1, 0, 0], ey: [0, 0, -1], ez: [0, 1, 0] },
  { label: t('Rechts'), ex: [0, 1, 0], ey: [0, 0, -1], ez: [1, 0, 0] },
  { label: t('Links'), ex: [0, -1, 0], ey: [0, 0, -1], ez: [-1, 0, 0] },
];

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const key = (v) => v.map((x) => Math.round(x)).join(',');

export class ViewCube {
  constructor(host, viewer, { size = 70 } = {}) {
    this.viewer = viewer;
    this.size = size;
    const h = size / 2;
    const el = document.createElement('div');
    el.className = 'viewcube';
    el.innerHTML = '<div class="vc-scene"><div class="vc-cube"></div></div>';
    const cube = el.querySelector('.vc-cube');
    for (const f of FACES) {
      const face = document.createElement('div');
      face.className = 'vc-face';
      face.style.width = face.style.height = `${size}px`;
      face.style.left = face.style.top = `${-h}px`;
      const [ex, ey, ez] = [f.ex, f.ey, f.ez];
      face.style.transform = `matrix3d(${ex.join(',')},0,${ey.join(',')},0,${ez.join(',')},0,${ez[0] * h},${ez[1] * h},${ez[2] * h},1)`;
      // 3×3 Klickflächen: Mitte = Fläche, Ränder = Kanten, Ecken = Ecken
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const dir = add(add(ez, ex, c - 1), ey, r - 1);
          const cell = document.createElement('div');
          cell.className = `vc-cell ${r === 1 && c === 1 ? 'center' : (r === 1 || c === 1 ? 'edge' : 'corner')}`;
          cell.dataset.dir = key(dir);
          face.appendChild(cell);
        }
      }
      const label = document.createElement('span');
      label.className = 'vc-label';
      label.textContent = f.label;
      face.appendChild(label);
      cube.appendChild(face);
    }
    host.appendChild(el);
    this.el = el;
    this.cube = cube;

    // Hover: dieselbe Ansicht auf allen angrenzenden Flächen markieren
    el.addEventListener('pointerover', (e) => this.highlight(e.target.closest('.vc-cell')?.dataset.dir));
    el.addEventListener('pointerleave', () => this.highlight(null));

    // Klick = Ansicht, Ziehen = drehen
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, cell: e.target.closest('.vc-cell') };
      el.classList.add('pressed');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.moved = true;
      el.classList.add('dragging');
      viewer.orbitBy(e.clientX - drag.lx, e.clientY - drag.ly);
      drag.lx = e.clientX;
      drag.ly = e.clientY;
    });
    const end = () => {
      if (!drag) return;
      if (!drag.moved && drag.cell) viewer.viewDirection(drag.cell.dataset.dir.split(',').map(Number));
      drag = null;
      el.classList.remove('pressed', 'dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    viewer.addEventListener('render', () => this.update());
    this.update();
  }

  highlight(dir) {
    if (dir === this.hot) return;
    this.hot = dir;
    for (const c of this.cube.querySelectorAll('.vc-cell.hot')) c.classList.remove('hot');
    if (dir) for (const c of this.cube.querySelectorAll(`.vc-cell[data-dir="${dir}"]`)) c.classList.add('hot');
  }

  // Würfel so drehen, wie die Kamera die Welt sieht (CSS: y nach unten → Y-Spiegelung)
  update() {
    const m = this.viewer.camera.matrixWorldInverse.elements;
    const t = `matrix3d(${m[0]},${-m[1]},${m[2]},0,${m[4]},${-m[5]},${m[6]},0,${m[8]},${-m[9]},${m[10]},0,0,0,0,1)`;
    if (t !== this.last) {
      this.cube.style.transform = t;
      this.last = t;
    }
  }
}
