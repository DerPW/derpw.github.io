// Verhalten der Oberfläche „Apple“: Federn statt fester Animationen, das Modell rückt
// in die freie Fläche zwischen den schwebenden Panels, auf dem Handy ein ziehbares Blatt.

import { Spring, VelocityTracker, project, rubberband, nearest, tick } from './motion.js';

export const isApple = () => document.documentElement.dataset.ui === 'apple';

const GAP = 10;
const TOOLBAR = 52;

export function createAppleUI({ viewer, viewerPane, editorPane, paramsPanel, splitter, isMobile, paramsVisible, onSidebar }) {
  /* --------------------------------------------- Segmentierte Steuerung */
  const gliders = new WeakMap();
  function glide(seg, glider, x, w, immediate) {
    let s = gliders.get(seg);
    if (!s) {
      const state = { x, w };
      const paint = () => { glider.style.transform = `translateX(${state.x}px)`; glider.style.width = `${state.w}px`; };
      s = {
        x: new Spring(x, { damping: 1, response: 0.32, onUpdate: (v) => { state.x = v; paint(); } }),
        w: new Spring(w, { damping: 1, response: 0.32, onUpdate: (v) => { state.w = v; paint(); } }),
      };
      gliders.set(seg, s);
      paint();
    }
    if (immediate) { s.x.set(x); s.w.set(w); } else { s.x.to(x); s.w.to(w); }
  }

  /* -------------------------------------------------------- Inspektor */
  const closedX = () => paramsPanel.offsetWidth + GAP + 30;
  let inspectorOpen = true;
  const inspector = new Spring(0, {
    damping: 1, response: 0.38,
    onUpdate: (x) => {
      if (!isApple() || isMobile()) return;
      paramsPanel.style.transform = x ? `translateX(${x}px)` : '';
      layout(true);
    },
    onRest: (x) => { paramsPanel.style.visibility = x > 1 ? 'hidden' : ''; },
  });
  function setInspector(open, { immediate = false } = {}) {
    inspectorOpen = open;
    paramsPanel.style.visibility = '';
    const target = open ? 0 : closedX();
    if (immediate) inspector.set(target); else inspector.to(target);
    if (immediate && !open) paramsPanel.style.visibility = 'hidden';
  }

  /* --------------------------------------------------- Seitenleiste */
  let sidebarOpen = true;
  const sidebar = new Spring(0, {
    damping: 1, response: 0.4,
    onUpdate: (x) => {
      if (!isApple() || isMobile()) return;
      editorPane.style.transform = x ? `translateX(${x}px)` : '';
      splitter.style.transform = x ? `translateX(${x}px)` : '';
      layout(true);
    },
    onRest: (x) => {
      document.documentElement.classList.toggle('sidebar-hidden', x < -1);
      onSidebar?.(x >= -1);
    },
  });
  function setSidebar(open, { immediate = false } = {}) {
    sidebarOpen = open;
    document.documentElement.classList.remove('sidebar-hidden');
    const target = open ? 0 : -(editorPane.offsetWidth + GAP + 30);
    if (immediate) { sidebar.set(target); sidebar.onRest(target); } else sidebar.to(target);
  }

  /* ---------------------------------------- Blatt auf dem Handy (Parameter) */
  let sheetH = 0;
  const detents = () => {
    sheetH = paramsPanel.offsetHeight || viewerPane.clientHeight - 64;
    // Eingeklappt bleibt der Kopf über der schwebenden Tab-Leiste sichtbar
    const tabs = document.querySelector('.mobile-tabs');
    const tabsH = tabs ? tabs.offsetHeight + 14 : 0;
    return { full: 0, half: Math.round(sheetH * 0.48), peek: Math.max(0, sheetH - 92 - tabsH) };
  };
  const sheet = new Spring(10000, {
    damping: 1, response: 0.3,
    onUpdate: (y) => {
      if (!isApple() || !isMobile()) return;
      paramsPanel.style.setProperty('--sheet-y', `${y}px`);
      layout(true);
    },
  });
  let lastDetent = 'peek';
  function snapSheet(name, opts = {}) {
    const d = detents();
    lastDetent = name;
    sheet.to(d[name], opts);
  }

  const tracker = new VelocityTracker();
  let drag = null;
  function onDown(e) {
    if (!isApple() || !isMobile() || e.button > 0) return;
    if (e.target.closest('button, input, select, a')) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    sheet.stop();
    tracker.reset();
    tracker.add(sheet.value);
    // Griffpunkt merken – das Blatt bleibt unter dem Finger, statt zu springen
    drag = { id: e.pointerId, startY: e.clientY, startSheet: sheet.value, moved: false, handle };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < 8) return; // kleine Toleranz, bevor ein Ziehen beginnt
    drag.moved = true;
    const { peek } = detents();
    let y = drag.startSheet + dy;
    if (y < 0) y = -rubberband(-y, sheetH);
    else if (y > peek) y = peek + rubberband(y - peek, sheetH);
    sheet.set(y);
    tracker.add(y);
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const was = lastDetent;
    if (!drag.moved) {
      // Antippen: zwischen klein und halb wechseln
      snapSheet(lastDetent === 'peek' ? 'half' : 'peek');
    } else {
      const v = tracker.velocity;
      const d = detents();
      // Schwung projizieren und dort einrasten, wohin die Geste zielt
      const target = nearest(sheet.value + project(v, 0.99), [d.full, d.half, d.peek]);
      const name = Object.keys(d).find((k) => d[k] === target);
      lastDetent = name;
      sheet.to(target, { velocity: v, damping: Math.abs(v) > 400 ? 0.8 : 1, response: 0.3 });
      if (name !== was) tick();
    }
    drag = null;
  }
  for (const el of [paramsPanel.querySelector('.sheet-grabber'), paramsPanel.querySelector('.params-head')]) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  /* --------------------------------------------- Freie Fläche → 3D-Ansicht */
  function insets() {
    if (!isApple()) return null;
    const visibleParams = paramsVisible();
    if (isMobile()) {
      const tab = document.body.dataset.mtab;
      const showSheet = tab !== 'editor' && visibleParams;
      const bottom = showSheet ? Math.max(0, (paramsPanel.offsetHeight || 0) - sheet.value) : 90;
      return { left: 0, right: 0, top: TOOLBAR + 44, bottom: Math.max(bottom, 90) + 8 };
    }
    const sideW = editorPane.offsetWidth;
    const left = document.documentElement.classList.contains('sidebar-hidden') ? 0 : Math.max(0, GAP + sideW + sidebar.value + GAP);
    const inspW = paramsPanel.offsetWidth || 300;
    const right = visibleParams ? Math.max(0, inspW + 2 * GAP - inspector.value) : 0;
    return { left, right, top: TOOLBAR, bottom: 62 };
  }

  function layout(immediate = false) {
    const ins = insets();
    if (!ins) return;
    viewerPane.style.setProperty('--free-l', `${ins.left}px`);
    viewerPane.style.setProperty('--free-r', `${ins.right}px`);
    viewerPane.classList.toggle('free-narrow', viewerPane.clientWidth - ins.left - ins.right < 560);
    viewer.setInsets(ins, { immediate });
  }

  // Beim Wechsel zurück auf „Glas“ alle Inline-Stile entfernen
  function reset() {
    for (const el of [editorPane, splitter, paramsPanel]) { el.style.transform = ''; el.style.visibility = ''; }
    paramsPanel.style.removeProperty('--sheet-y');
    viewerPane.style.removeProperty('--free-l');
    viewerPane.style.removeProperty('--free-r');
    document.documentElement.classList.remove('sidebar-hidden');
  }

  function activate({ sidebarOpen: so = true, paramsOpen = true } = {}) {
    reset();
    setSidebar(so, { immediate: true });
    setInspector(paramsOpen, { immediate: true });
    requestAnimationFrame(() => {
      const d = detents();
      sheet.set(d[lastDetent] ?? d.peek);
      layout(true);
    });
  }

  return {
    glide, setInspector, setSidebar, layout, reset, activate, snapSheet,
    get sidebarOpen() { return sidebarOpen; },
    get inspectorOpen() { return inspectorOpen; },
  };
}
