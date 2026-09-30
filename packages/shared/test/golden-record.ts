// One-off: records the pre-refactor behaviour into test/golden.json. Kept in git as the reference.
import { writeFileSync } from 'node:fs';
import * as G from '../src/index.ts';
import { trace, type Api } from './scenario.ts';

const api: Api<G.World> = {
  count: G.LEVELS.length,
  meta: i => ({ id: G.LEVELS[i].id, draw: !!G.LEVELS[i].draw, dialog: G.LEVELS[i].overlay === 'dialog' }),
  init: i => G.initLevel(i),
  step: (w, dt, ps) => { G.updateWorld(w, dt, ps); return w; },
  mapInput: (w, i, pid) => G.mapInput(w, i, pid),
  move: (b, i, w, others, dt) => { const c = { ...b }; G.stepPlayer(c, i, w, others, dt); return c; },
  check: (w, b) => { const r = G.checkPlayer(w, b); return r?.die ? 'die' : r?.win ? 'win' : null; },
  door: w => w.door,
  solids: w => G.allSolids(w),
  spikes: w => w.spikes,
  spawn: w => w.spawn,
  waitDone: w => !!w.s.done,
  hole: w => !!w.s.hole,
  draw: (w, pts) => { G.LEVELS[w.lvl].drawDoor?.(w, pts); return w; },
  answer: (w, pid, i) => { G.LEVELS[w.lvl].answer?.(w, pid, i); return w; },
  t: w => w.t,
};

const out = trace(api);
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify(out));
const rows = Object.values(out).reduce((n, r) => n + r.length, 0);
const wins = JSON.stringify(out).match(/:win/g)?.length ?? 0, deaths = JSON.stringify(out).match(/:die/g)?.length ?? 0;
console.log(`golden: ${Object.keys(out).length} levels, ${rows} rows, ${wins} wins, ${deaths} deaths`);
