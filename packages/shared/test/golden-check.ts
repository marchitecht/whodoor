// Replays the reference scenario against the current implementation and diffs it with test/golden.json.
import { readFileSync } from 'node:fs';
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as G from '../src/index.ts';
import { trace, diff, type Api } from './scenario.ts';

const slot = <A>(w: G.World, k: string) => w.c[k] as unknown as A | undefined;

const api: Api<G.World> = {
  count: G.LEVELS.length,
  meta: i => ({ id: G.LEVELS[i].id, draw: !!G.LEVELS[i].draw, dialog: G.LEVELS[i].overlay === 'dialog' }),
  init: G.initLevel,
  step: (w, dt, ps) => G.updateWorld(dt, ps)(w),
  mapInput: (w, i, pid) => G.mapInput(w, i, pid),
  move: (b, i, w, others, dt) => G.stepPlayer(i, w, others, dt)(b)[1],
  check: (w, b) => pipe(G.checkPlayer(w, b), O.match(() => null, o => o.tag)),
  door: w => w.door,
  solids: w => [...G.solidsOf(w)],
  spikes: w => [...w.spikes],
  spawn: w => [w.spawn[0], w.spawn[1]],
  waitDone: w => !!slot<{ done: boolean }>(w, 'walker')?.done,
  hole: w => !!slot<{ hole: boolean }>(w, 'last')?.hole,
  draw: (w, pts) => G.drawDoor(pts)(w),
  answer: (w, pid, i) => G.answer(pid, i)(w)[1],
  t: w => w.t,
};

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const now = trace(api);
let bad = 0;
for (const k of Object.keys(golden)) {
  const d = diff(golden[k], now[k] ?? [], k, [], 5);
  if (d.length) { bad++; console.log(`✗ ${k}\n  ` + d.join('\n  ')); }
  else console.log(`✓ ${k}`);
}
console.log(bad ? `\n${bad} level(s) differ from the reference` : '\nall levels match the reference');
process.exit(bad ? 1 : 0);
