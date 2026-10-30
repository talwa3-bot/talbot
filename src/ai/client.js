// ממשק לעובד הרקע, עם גיבוי בחוט הראשי אם עובדים לא נתמכים.
import { chooseCard, fieldResults, claimAll } from './core.js';

let worker = null, seq = 0;
const pending = new Map();
try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.result);
  };
  worker.onerror = () => { worker = null; for (const p of pending.values()) p.fallback(); pending.clear(); };
} catch { worker = null; }

function local(type, payload) {
  if (type === 'card') return chooseCard(payload.view, null, payload.opts);
  if (type === 'field') return fieldResults({ solve: null, ...payload });
  if (type === 'claim') return claimAll({ solve: null, ...payload });
  return false;
}

/** @param {string} type @param {any} payload @returns {Promise<any>} */
export function ask(type, payload) {
  if (!worker) return Promise.resolve(local(type, payload));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, fallback: () => resolve(local(type, payload)) });
    worker.postMessage({ id, type, payload });
  });
}
