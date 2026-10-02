// עובד רקע: טוען את הפותר ומריץ את החשיבה של הבוטים בלי לתקוע את המסך.
import init, { Analyzer, solve_contract } from '../../vendor/bridge-solver/bridge_solver_wasm.js';
import { chooseCard, fieldResults, claimAll } from './core.js';

let solver = null, solve = null;
const ready = init({ module_or_path: new URL('../../vendor/bridge-solver/bridge_solver_wasm_bg.wasm', import.meta.url) })
  .then(() => { solver = new Analyzer(); solve = solve_contract; })
  .catch(() => { /* בלי פותר: היוריסטיקה */ });

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  await ready;
  try {
    let result;
    if (type === 'card') result = chooseCard(payload.view, solver, payload.opts);
    else if (type === 'field') result = fieldResults({ solve, ...payload });
    else if (type === 'claim') result = claimAll({ solve, ...payload });
    else if (type === 'ping') result = !!solver;
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
