// Laws and purity: lens laws for the core optics, monoid laws for Behavior, and no mutation anywhere in a tick.
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as G from '../src/index.ts';

let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? '✓' : '✗'} ${name}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// sample worlds: every level, a few seconds in, with one idle player
const idle: G.PV[] = [{ id: 'A', x: 60, y: 444, w: 26, h: 26, face: 1, g: true, alive: true }];
const worlds = G.LEVELS.map((_, i) => {
  let w = G.initLevel(i);
  for (let k = 0; k < 120; k++) w = G.updateWorld(1 / 60, idle)(w);
  return w;
});

/* Lens / Optional laws on the door and component slots */
const door2: G.Door = { x: 1, y: 2, w: 3, h: 4 };
check('door: set then get returns what was set', worlds.every(w => w.door === null || eq(G._door.getOption(G._door.set(door2)(w)), O.some(door2))));
check('door: get then set is identity', worlds.every(w => pipe(G._door.getOption(w), O.match(() => true, d => eq(G._door.set(d)(w), w)))));
check('door: set twice = set once', worlds.every(w => eq(G._door.set(door2)(G._door.set({ ...door2, x: 9 })(w)), G._door.set(door2)(w))));
check('t lens: get(set(a)) = a', worlds.every(w => G._t.get(G._t.set(42)(w)) === 42));
check('slots: get then set is identity', worlds.every(w => Object.keys(w.c).every(k => pipe(G._slot(k).getOption(w), O.match(() => false, s => eq(G._slot(k).set(s)(w), w))))));

/* Behavior monoid laws, checked extensionally on every level */
const env: G.Env = { dt: 1 / 60, ps: idle };
const sameBehavior = (a: G.Behavior, b: G.Behavior, w: G.World) =>
  eq(a.init(w), b.init(w)) && eq(a.update(env)(w), b.update(env)(w)) && eq(a.solids(w), b.solids(w)) &&
  eq(a.hits(idle[0])(w), b.hits(idle[0])(w)) && a.canEnter(w) === b.canEnter(w) && a.onFall(w) === b.onFall(w);
check('monoid: left identity', G.LEVELS.every((L, i) => sameBehavior(G.Monoid.concat(G.Monoid.empty, L.b), L.b, worlds[i])));
check('monoid: right identity', G.LEVELS.every((L, i) => sameBehavior(G.Monoid.concat(L.b, G.Monoid.empty), L.b, worlds[i])));
const [a, b, c] = [G.LEVELS[2].b, G.LEVELS[6].b, G.LEVELS[17].b];
check('monoid: associativity', worlds.every(w => sameBehavior(G.Monoid.concat(G.Monoid.concat(a, b), c), G.Monoid.concat(a, G.Monoid.concat(b, c)), w)));

/* Purity: deep-freeze the input world; any write inside a tick throws in strict mode */
const freeze = <T>(o: T): T => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
let pure = true;
for (let i = 0; i < G.LEVELS.length; i++) {
  let w = G.initLevel(i);
  const ps: G.PV[] = [{ id: 'A', x: 300, y: 444, w: 26, h: 26, face: 1, g: true, alive: true }, { id: 'B', x: 700, y: 444, w: 26, h: 26, face: -1, g: true, alive: true }];
  try {
    for (let k = 0; k < 900; k++) {
      w = G.updateWorld(1 / 60, freeze(ps))(freeze(w));
      G.checkPlayer(w, ps[0]);
      G.stepPlayer(G.NONE, w, [ps[1]], 1 / 60)(freeze({ ...ps[0], vx: 0, vy: 0 }));
    }
    if (G.LEVELS[i].draw) G.drawDoor([[100, 400], [150, 470]])(freeze(w));
    if (G.LEVELS[i].overlay === 'dialog') G.answer('A', 3)(freeze(w));
    G.poke('A')(freeze(w));
  } catch (e) { pure = false; console.log(`  mutation in ${G.LEVELS[i].id}: ${(e as Error).message}`); }
}
check('purity: 15 s of every level never mutates its input', pure);

/* Determinism: same inputs, same world */
const run = () => { let w = G.initLevel(G.byId('pits')); for (let k = 0; k < 600; k++) w = G.updateWorld(1 / 60, [{ ...idle[0], x: 100 + k }])(w); return w; };
check('determinism: replaying a level gives the same world, narrator included', eq(run(), run()));

console.log(failed ? `\n${failed} check(s) failed` : '\nall laws hold');
process.exit(failed ? 1 : 0);
