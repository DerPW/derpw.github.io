// 3D-Ansicht mit three.js: Z zeigt nach oben wie in OpenSCAD, Rendern nur bei Bedarf.

import * as THREE from '../vendor/three/three.js';

const VIEWS = {
  iso: { dir: [1, -1.15, 0.85], label: 'Iso' },
  // Minimal geneigt, damit „oben“ (Z) als Kamera-Up eindeutig bleibt
  top: { dir: [0, -1e-4, 1], label: 'Oben' },
  bottom: { dir: [0, -1e-4, -1], label: 'Unten' },
  front: { dir: [0, -1, 0], label: 'Vorne' },
  back: { dir: [0, 1, 0], label: 'Hinten' },
  left: { dir: [-1, 0, 0], label: 'Links' },
  right: { dir: [1, 0, 0], label: 'Rechts' },
};

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Viewer extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.opts = { grid: true, axes: true, edges: true, wireframe: false, ortho: false, color: 'theme' };
    this.model = null;
    this.bounds = null;
    this.dim = 0;
    this.needsRender = true;
    // Platz rechts/unten (Parameter-Panel) – das Modell rückt in die freie Fläche
    this.inset = { r: 0, b: 0 };
    this.insetTarget = { r: 0, b: 0 };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6b6f8a, 0.9);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-0.6, -1, 1.4);
    this.camLight = key;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(1, 0.8, -0.4);
    this.scene.add(fill);

    this.persp = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const c of [this.persp, this.orthoCam]) c.up.set(0, 0, 1);
    this.camera = this.persp;
    this.persp.position.set(120, -140, 110);

    this.controls = new THREE.OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => { this.cancelTween(); this.dispatchEvent(new Event('interact')); });

    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    this.buildHelpers(100);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = () => {
      requestAnimationFrame(loop);
      let shifted = false;
      for (const k of ['r', 'b']) {
        const d = this.insetTarget[k] - this.inset[k];
        if (!d) continue;
        this.inset[k] = Math.abs(d) < 0.5 ? this.insetTarget[k] : this.inset[k] + d * 0.22;
        shifted = true;
      }
      if (shifted) this.applyProjection();
      this.stepTween();
      const moved = this.controls.update();
      if (moved || this.needsRender) this.render();
    };
    requestAnimationFrame(loop);

    new MutationObserver(() => this.refreshTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
  }

  requestRender() { this.needsRender = true; }

  render() {
    this.needsRender = false;
    // Hauptlicht folgt grob der Kamera, damit nichts im Schatten verschwindet
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    this.camLight.position.copy(dir).add(new THREE.Vector3(-0.35, -0.2, 0.6)).normalize();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const hgt = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.applyProjection();
  }

  setInsets({ right = 0, bottom = 0 } = {}) {
    this.insetTarget = { r: Math.max(0, right), b: Math.max(0, bottom) };
    this.requestRender();
  }

  // Sichtbarer Ausschnitt: Bei Insets wird ein größeres Bild berechnet und nur ein Teil gezeigt,
  // so liegt die Bildmitte in der freien Fläche neben bzw. über dem Panel.
  frame(target = false) {
    const w = Math.max(1, this.container.clientWidth);
    const hgt = Math.max(1, this.container.clientHeight);
    const src = target ? this.insetTarget : this.inset;
    const r = Math.min(src.r, w * 0.45), b = Math.min(src.b, hgt * 0.6);
    return { w, h: hgt, r, b, fullW: w + r, fullH: hgt + b };
  }

  applyProjection() {
    const { w, h, r, b, fullW, fullH } = this.frame();
    const off = r > 0.5 || b > 0.5;
    this.persp.aspect = fullW / fullH;
    // Die Höhe wächst mit dem unteren Inset → Blickwinkel anpassen, damit die Größe gleich bleibt
    this.persp.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(35 / 2)) * fullH / h));
    if (off) this.persp.setViewOffset(fullW, fullH, r, b, w, h); else this.persp.clearViewOffset();
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.requestRender();
  }

  updateOrtho() {
    const { w, h, r, b, fullW, fullH } = this.frame();
    // Ortho-Ausschnitt aus dem Abstand der Perspektivkamera ableiten
    const dist = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    const halfH = Math.tan(THREE.MathUtils.degToRad(35 / 2)) * dist * (fullH / h);
    const halfW = halfH * (fullW / fullH);
    Object.assign(this.orthoCam, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    if (r > 0.5 || b > 0.5) this.orthoCam.setViewOffset(fullW, fullH, r, b, w, h); else this.orthoCam.clearViewOffset();
    this.orthoCam.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------ Hilfslinien */

  buildHelpers(size) {
    this.helpers.clear();
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const span = Math.max(size * 2.2, 40);
    const step = Math.pow(10, Math.floor(Math.log10(span / 8)));
    const major = step * 10;
    const half = Math.ceil(span / major) * major;

    const minor = [], majorLines = [];
    for (let v = -half; v <= half + 1e-9; v += step) {
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const arr = isMajor ? majorLines : minor;
      if (Math.abs(v) < 1e-9) continue; // Achsen übernehmen die Nulllinien
      arr.push(-half, v, 0, half, v, 0, v, -half, 0, v, half, 0);
    }
    const mk = (arr, color, opacity) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      return new THREE.LineSegments(g, m);
    };
    const gridColor = theme === 'light' ? 0x3a3f66 : 0xc8ccff;
    this.grid = new THREE.Group();
    this.grid.add(mk(minor, gridColor, theme === 'light' ? 0.07 : 0.06));
    this.grid.add(mk(majorLines, gridColor, theme === 'light' ? 0.16 : 0.14));
    this.grid.add(mk([-half, 0, 0, 0, 0, 0, 0, -half, 0, 0, 0, 0], gridColor, 0.22));
    this.grid.renderOrder = -1;
    this.grid.visible = this.opts.grid;
    this.helpers.add(this.grid);

    const len = Math.max(size * 0.75, 10);
    const axes = new THREE.Group();
    const ax = (to, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...to], 3));
      return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    };
    axes.add(ax([half, 0, 0], 0xff5d7a));
    axes.add(ax([0, half, 0], 0x34d399));
    axes.add(ax([0, 0, len], 0x60a5fa));
    axes.visible = this.opts.axes;
    this.axes = axes;
    this.helpers.add(axes);
    this.gridInfo = { step, major };
    this.requestRender();
  }

  refreshTheme() {
    this.buildHelpers(this.bounds ? this.boundsSize() : 100);
    this.applyModelColor();
    this.requestRender();
  }

  /* ------------------------------------------------------------------ Modell */

  defaultColor() {
    const mode = this.opts.color;
    if (mode === 'classic') return new THREE.Color('#f9d72c');
    if (mode === 'gray') return new THREE.Color(document.documentElement.dataset.theme === 'light' ? '#c9cbd6' : '#b9bccb');
    const hue = Number(css('--accent-h')) || 262;
    return new THREE.Color().setHSL(hue / 360, 0.72, document.documentElement.dataset.theme === 'light' ? 0.66 : 0.7, THREE.SRGBColorSpace);
  }

  clearModel() {
    for (const obj of [...this.modelGroup.children]) {
      obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      this.modelGroup.remove(obj);
    }
    this.model = null;
    this.edges = null;
  }

  // mesh: { positions, faceColors, triangles, bbox } aus off.js
  setMesh(mesh, { fit = false } = {}) {
    this.clearModel();
    this.dim = 3;
    const tri = mesh.triangles;
    const pos = mesh.positions;
    const fc = mesh.faceColors;

    // Opake und transparente Flächen trennen (OpenSCAD: color(..., alpha))
    let nTrans = 0;
    if (fc) for (let i = 0; i < tri; i++) if (fc[i * 4 + 3] && fc[i * 4 + 3] < 255) nTrans++;

    const build = (filter, count) => {
      const p = new Float32Array(count * 9);
      const c = new Float32Array(count * 9);
      const custom = new Uint8Array(count);
      let k = 0;
      let alphaSum = 0;
      for (let i = 0; i < tri; i++) {
        if (!filter(i)) continue;
        p.set(pos.subarray(i * 9, i * 9 + 9), k * 9);
        if (fc && fc[i * 4 + 3]) {
          const r = srgbToLinear(fc[i * 4] / 255), g = srgbToLinear(fc[i * 4 + 1] / 255), b = srgbToLinear(fc[i * 4 + 2] / 255);
          for (let v = 0; v < 3; v++) { c[k * 9 + v * 3] = r; c[k * 9 + v * 3 + 1] = g; c[k * 9 + v * 3 + 2] = b; }
          custom[k] = 1;
          alphaSum += fc[i * 4 + 3] / 255;
        }
        k++;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      geo.userData.custom = custom;
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return { geo, alpha: count ? alphaSum / count : 1 };
    };

    const group = new THREE.Group();
    const parts = [];
    const opaque = build((i) => !(fc && fc[i * 4 + 3] && fc[i * 4 + 3] < 255), tri - nTrans);
    if (tri - nTrans > 0) parts.push({ ...opaque, transparent: false });
    if (nTrans) parts.push({ ...build((i) => fc && fc[i * 4 + 3] && fc[i * 4 + 3] < 255, nTrans), transparent: true });

    for (const part of parts) {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.52, metalness: 0.04, flatShading: true, side: THREE.DoubleSide,
        transparent: part.transparent, opacity: part.transparent ? Math.max(0.15, part.alpha) : 1,
        depthWrite: !part.transparent, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        wireframe: this.opts.wireframe,
      });
      const m = new THREE.Mesh(part.geo, mat);
      m.renderOrder = part.transparent ? 2 : 0;
      group.add(m);
    }
    this.modelGroup.add(group);
    this.model = group;
    this.triangles = tri;
    this.applyModelColor();

    const b = mesh.bbox;
    this.setBounds(b ? new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)) : null, fit);
    if (this.opts.edges) this.buildEdges();
    this.requestRender();
  }

  // 2D-Ergebnis (SVG von OpenSCAD) als flache Fläche zeigen
  setSVG(svgText, { fit = false } = {}) {
    this.clearModel();
    this.dim = 2;
    const data = new THREE.SVGLoader().parse(svgText);
    const group = new THREE.Group();
    const color = this.defaultColor();
    const fillMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const lineMat = new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(0.55) });
    const box = new THREE.Box3();
    for (const path of data.paths) {
      const shapes = THREE.SVGLoader.createShapes(path);
      for (const shape of shapes) {
        const geo = new THREE.ShapeGeometry(shape, 1);
        const mesh = new THREE.Mesh(geo, fillMat);
        group.add(mesh);
        const pts = shape.getPoints();
        const outline = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b2 = pts[(i + 1) % pts.length];
          outline.push(a.x, a.y, 0, b2.x, b2.y, 0);
        }
        for (const hole of shape.holes) {
          const hp = hole.getPoints();
          for (let i = 0; i < hp.length; i++) {
            const a = hp[i], b2 = hp[(i + 1) % hp.length];
            outline.push(a.x, a.y, 0, b2.x, b2.y, 0);
          }
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
        group.add(new THREE.LineSegments(lg, lineMat));
      }
    }
    // OpenSCAD spiegelt Y beim SVG-Export – zurückspiegeln
    group.scale.set(1, -1, 1);
    group.updateMatrixWorld(true);
    box.setFromObject(group);
    this.modelGroup.add(group);
    this.model = group;
    this.triangles = 0;
    this.is2D = true;
    this.setBounds(box.isEmpty() ? null : box, fit, true);
    this.requestRender();
  }

  applyModelColor() {
    if (!this.model || this.dim !== 3) {
      if (this.model && this.dim === 2) {
        const c = this.defaultColor();
        this.model.traverse((o) => {
          if (o.isMesh) o.material.color.copy(c);
          if (o.isLineSegments) o.material.color.copy(c.clone().multiplyScalar(0.55));
        });
        this.requestRender();
      }
      return;
    }
    const d = this.defaultColor();
    const lin = d.clone(); // Color ist intern linear
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const col = o.geometry.getAttribute('color');
      const custom = o.geometry.userData.custom;
      const arr = col.array;
      for (let t = 0; t < custom.length; t++) {
        if (custom[t]) continue;
        for (let v = 0; v < 3; v++) { arr[t * 9 + v * 3] = lin.r; arr[t * 9 + v * 3 + 1] = lin.g; arr[t * 9 + v * 3 + 2] = lin.b; }
      }
      col.needsUpdate = true;
    });
    if (this.edges) this.edges.material.color.copy(this.edgeColor());
    this.requestRender();
  }

  edgeColor() {
    return document.documentElement.dataset.theme === 'light' ? new THREE.Color(0x1d2040) : new THREE.Color(0x0b0b16);
  }

  buildEdges() {
    if (!this.model || this.dim !== 3) return;
    if (this.edges) { this.edges.geometry.dispose(); this.edges.material.dispose(); this.edges.parent?.remove(this.edges); this.edges = null; }
    if (this.triangles > 600000) return; // zu teuer
    const all = [];
    this.model.traverse((o) => { if (o.isMesh) all.push(o.geometry); });
    const segs = [];
    for (const g of all) {
      const eg = new THREE.EdgesGeometry(g, 28);
      segs.push(eg.getAttribute('position').array);
      eg.dispose();
    }
    const total = segs.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const a of segs) { merged.set(a, o); o += a.length; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    const mat = new THREE.LineBasicMaterial({ color: this.edgeColor(), transparent: true, opacity: 0.35, depthWrite: false });
    this.edges = new THREE.LineSegments(geo, mat);
    this.edges.renderOrder = 1;
    this.model.add(this.edges);
    this.requestRender();
  }

  setBounds(box, fit, flat = false) {
    const first = !this.bounds;
    this.bounds = box;
    if (box) {
      this.buildHelpers(this.boundsSize());
      if (fit || first) this.fit(flat ? 'top' : 'iso', !first);
    }
    this.dispatchEvent(new CustomEvent('bounds', { detail: box }));
  }

  boundsSize() {
    if (!this.bounds) return 100;
    const s = this.bounds.getSize(new THREE.Vector3());
    return Math.max(s.x, s.y, s.z, 1);
  }

  getSize() {
    if (!this.bounds) return null;
    const s = this.bounds.getSize(new THREE.Vector3());
    return { x: s.x, y: s.y, z: this.dim === 2 ? 0 : s.z };
  }

  /* --------------------------------------------------------------- Kamera */

  fit(view = this.lastView ?? 'iso', animate = true) {
    const v = VIEWS[view] ?? VIEWS.iso;
    this.lastView = view;
    const box = this.bounds ?? new THREE.Box3(new THREE.Vector3(-25, -25, 0), new THREE.Vector3(25, 25, 25));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    // Einpassen in die freie Fläche (ohne Panel), mit dem Grund-Blickwinkel
    const fov = THREE.MathUtils.degToRad(35);
    const fr = this.frame(true);
    const half = (px) => Math.atan(Math.tan(fov / 2) * Math.max(40, px) / fr.h);
    const fitH = r / Math.sin(half(fr.h - fr.b));
    const fitW = r / Math.sin(half(fr.w - fr.r));
    const dist = Math.max(fitH, fitW) * 1.08;
    const dir = new THREE.Vector3(...v.dir).normalize();
    const pos = sphere.center.clone().add(dir.multiplyScalar(dist));
    this.persp.near = Math.max(0.01, r / 200);
    this.persp.far = r * 400 + dist;
    this.persp.updateProjectionMatrix();
    this.orthoCam.zoom = 1;
    this.tweenTo(pos, sphere.center.clone(), animate);
  }

  view(name) { this.fit(name, true); }

  tweenTo(pos, target, animate) {
    const cam = this.camera;
    if (!animate) {
      cam.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.updateOrtho();
      this.requestRender();
      return;
    }
    this.tween = {
      t0: performance.now(), dur: 520,
      fromPos: cam.position.clone(), toPos: pos,
      fromTarget: this.controls.target.clone(), toTarget: target,
    };
  }

  stepTween() {
    const tw = this.tween;
    if (!tw) return;
    let k = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    const e = 1 - Math.pow(1 - k, 3);
    // Über die Kugel interpolieren, damit die Kamera nicht durch das Modell fährt
    const fromOff = tw.fromPos.clone().sub(tw.fromTarget);
    const toOff = tw.toPos.clone().sub(tw.toTarget);
    const fromLen = fromOff.length(), toLen = toOff.length();
    const q = new THREE.Quaternion().setFromUnitVectors(fromOff.clone().normalize(), toOff.clone().normalize());
    const qi = new THREE.Quaternion().slerp(q, e);
    const off = fromOff.normalize().applyQuaternion(qi).multiplyScalar(fromLen + (toLen - fromLen) * e);
    const target = tw.fromTarget.clone().lerp(tw.toTarget, e);
    this.camera.position.copy(target).add(off);
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    this.updateOrtho();
    this.requestRender();
    if (k >= 1) {
      this.tween = null;
      this.controls.update();
    }
  }

  cancelTween() { this.tween = null; }

  setOption(key, value) {
    this.opts[key] = value;
    switch (key) {
      case 'grid': if (this.grid) this.grid.visible = value; break;
      case 'axes': if (this.axes) this.axes.visible = value; break;
      case 'edges':
        if (value) this.buildEdges();
        else if (this.edges) { this.edges.parent?.remove(this.edges); this.edges.geometry.dispose(); this.edges = null; }
        break;
      case 'wireframe':
        this.model?.traverse((o) => { if (o.isMesh && this.dim === 3) o.material.wireframe = value; });
        break;
      case 'ortho': this.setOrtho(value); break;
      case 'color': this.applyModelColor(); break;
    }
    this.requestRender();
  }

  setOrtho(on) {
    const from = this.camera;
    const to = on ? this.orthoCam : this.persp;
    if (from === to) return;
    to.position.copy(from.position);
    to.up.copy(from.up);
    if (on) { this.camera = to; this.updateOrtho(); }
    else this.camera = to;
    to.quaternion.copy(from.quaternion);
    this.controls.object = to;
    this.controls.update();
    this.requestRender();
  }

  // Ortho-Zoom: OrbitControls ändert bei Ortho den zoom-Faktor statt des Abstands
  // – das ist gewollt, Abstand bleibt fürs Umschalten erhalten.

  screenshot() {
    this.render();
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  // Für die Vorschaubilder der Teilen-Funktion
  thumbnail(size = 320) {
    this.render();
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    const s = Math.min(src.width, src.height);
    c.width = c.height = size;
    c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/png');
  }
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
