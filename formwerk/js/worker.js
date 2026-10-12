// Führt OpenSCAD (WebAssembly) in einem eigenen Thread aus, siehe engine.js.

import OpenSCAD from '../vendor/openscad/openscad.js';
import { createEngine } from './engine.js';

let engine = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    engine = createEngine({ OpenSCAD, wasmModule: data.module });
    self.postMessage({ type: 'ready' });
    return;
  }
  if (data.type === 'job') {
    try {
      const res = await engine.render(data.job);
      const transfer = [];
      if (res.mesh) {
        transfer.push(res.mesh.positions.buffer);
        if (res.mesh.faceColors) transfer.push(res.mesh.faceColors.buffer);
      }
      if (res.off) transfer.push(res.off.buffer);
      if (res.data) transfer.push(res.data.buffer);
      self.postMessage({ type: 'result', id: data.id, result: res }, transfer);
    } catch (e) {
      self.postMessage({ type: 'result', id: data.id, result: { type: 'render', ok: false, crashed: true, logs: [`ERROR: ${e?.message ?? e}`] } });
    }
  }
};
