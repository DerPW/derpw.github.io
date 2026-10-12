// Bewegung nach Apples Modell (WWDC „Designing Fluid Interfaces“):
// Federn mit Dämpfung (1 = kein Überschwingen) und Antwortzeit in Sekunden,
// jederzeit unterbrechbar – ein neues Ziel startet vom aktuellen Wert und behält die Geschwindigkeit.

export const reducedMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';

export class Spring {
  constructor(value = 0, { damping = 1, response = 0.35, restDelta = 0.5, onUpdate, onRest } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.damping = damping;
    this.response = response;
    this.restDelta = restDelta;
    this.onUpdate = onUpdate;
    this.onRest = onRest;
    this.raf = 0;
    this.step = this.step.bind(this);
  }

  get moving() { return !!this.raf; }

  // Sofort setzen (z. B. während einer Geste: 1:1 dem Finger folgen)
  set(value, velocity = 0) {
    this.stop();
    this.value = this.target = value;
    this.velocity = velocity;
    this.onUpdate?.(value, velocity);
  }

  to(target, { velocity, damping, response } = {}) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    if (damping !== undefined) this.damping = damping;
    if (response !== undefined) this.response = response;
    if (reducedMotion()) {
      this.set(target);
      this.onRest?.(target);
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  step(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    // Apple-Parameter → Physik (Masse 1): Steifigkeit aus der Antwortzeit, Dämpfung aus dem Verhältnis
    const k = Math.pow((2 * Math.PI) / this.response, 2);
    const c = (4 * Math.PI * this.damping) / this.response;
    const n = Math.ceil(dt / (1 / 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < this.restDelta && Math.abs(this.velocity) < this.restDelta * 20) {
      this.value = this.target;
      this.velocity = 0;
      this.raf = 0;
      this.onUpdate?.(this.value, 0);
      this.onRest?.(this.value);
      return;
    }
    this.onUpdate?.(this.value, this.velocity);
    this.raf = requestAnimationFrame(this.step);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

// Geschwindigkeit aus den letzten ~100 ms der Zeigerbewegung (px/s)
export class VelocityTracker {
  constructor(windowMs = 100) { this.windowMs = windowMs; this.samples = []; }
  reset() { this.samples = []; }
  add(value, t = performance.now()) {
    this.samples.push([t, value]);
    while (this.samples.length > 2 && t - this.samples[0][0] > this.windowMs) this.samples.shift();
  }
  get velocity() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const [t0, v0] = s[0], [t1, v1] = s[s.length - 1];
    if (performance.now() - t1 > 80) return 0; // losgelassen nach einer Pause → kein Schwung
    return t1 > t0 ? ((v1 - v0) / (t1 - t0)) * 1000 : 0;
  }
}

// Wohin würde der Schwung tragen? (Apples Projektion, exponentielle Abbremsung)
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Weicher Widerstand jenseits einer Grenze
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function nearest(value, points) {
  return points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]);
}

// Kurzes haptisches Signal – nur für echte Ereignisse (Einrasten)
export function tick() {
  try { navigator.vibrate?.(8); } catch { /* nicht unterstützt */ }
}
