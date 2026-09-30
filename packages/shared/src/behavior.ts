// Behavior: the unit levels are composed from. Behaviors form a monoid, so a level is `concatAll` of its parts.
import { flow, identity, pipe, constFalse, constTrue, type Predicate } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as M from 'fp-ts/lib/Monoid.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import type * as S from 'fp-ts/lib/State.js';
import * as L from 'monocle-ts/lib/Lens.js';
import * as Op from 'monocle-ts/lib/Optional.js';
import { _slot, _slotAt, cx, setTo, type World, type PV, type Rect, type Solid, type Input, type Slot } from './world.ts';

export type Endo<A> = (a: A) => A;
export interface Env { readonly dt: number; readonly ps: ReadonlyArray<PV> }
export type Pts = ReadonlyArray<readonly [number, number]>;

export interface Behavior {
  readonly init: Endo<World>;
  readonly update: (env: Env) => Endo<World>;
  /** a death line if this box dies to something this behavior owns */
  readonly hits: (p: Rect) => (w: World) => O.Option<string>;
  readonly solids: (w: World) => ReadonlyArray<Solid>;
  readonly canEnter: Predicate<World>;
  /** falling off the bottom counts as reaching the exit */
  readonly onFall: Predicate<World>;
  readonly input: (pid: string, w: World) => Endo<Input>;
  readonly poke: (name: string) => Endo<World>;
  readonly answer: (pid: string, i: number) => S.State<World, O.Option<string>>;
  readonly drawDoor: (pts: Pts) => Endo<World>;
}

export const empty: Behavior = {
  init: identity,
  update: () => identity,
  hits: () => () => O.none,
  solids: () => [],
  canEnter: constTrue,
  onFall: constFalse,
  input: () => identity,
  poke: () => identity,
  answer: () => w => [O.none, w],
  drawDoor: () => identity,
};

/** Left-to-right: inits and updates run in list order, the first hit wins, solids concatenate. */
export const Monoid: M.Monoid<Behavior> = {
  empty,
  concat: (a, b) => ({
    init: flow(a.init, b.init),
    update: env => flow(a.update(env), b.update(env)),
    hits: p => w => pipe(a.hits(p)(w), O.alt(() => b.hits(p)(w))),
    solids: w => RA.concat(b.solids(w))(a.solids(w)),
    canEnter: w => a.canEnter(w) && b.canEnter(w),
    onFall: w => a.onFall(w) || b.onFall(w),
    input: (pid, w) => flow(a.input(pid, w), b.input(pid, w)),
    poke: name => flow(a.poke(name), b.poke(name)),
    answer: (pid, i) => w => {
      const [x, w1] = a.answer(pid, i)(w);
      const [y, w2] = b.answer(pid, i)(w1);
      return [pipe(x, O.alt(() => y)), w2];
    },
    drawDoor: pts => flow(a.drawDoor(pts), b.drawDoor(pts)),
  }),
};
export const all: (bs: ReadonlyArray<Behavior>) => Behavior = M.concatAll(Monoid);
export const behavior = (b: Partial<Behavior>): Behavior => ({ ...empty, ...b });

/* ---------- component state ---------- */
export const setSlot = <A extends Slot>(key: string, a: A): Endo<World> => setTo(O.some<Slot>(a))(_slotAt(key));
export const getSlot = <A extends Slot>(key: string) => (w: World): O.Option<A> => _slot<A>(key).getOption(w);
export const modifySlot = <A extends Slot>(key: string, f: Endo<A>): Endo<World> => Op.modify(f)(_slot<A>(key));
/** Run an update that needs both its own state and the world. */
export const withSlot = <A extends Slot>(key: string, f: (a: A) => Endo<World>): Endo<World> =>
  w => pipe(getSlot<A>(key)(w), O.match(() => w, a => f(a)(w)));
export const slotOr = <A extends Slot, B>(key: string, f: (a: A) => B, dflt: B) => (w: World): B =>
  pipe(getSlot<A>(key)(w), O.match(() => dflt, f));

/* ---------- pure randomness: a seed in the world, threaded with State ---------- */
const lcg = (s: number) => (Math.imul(s, 1664525) + 1013904223) >>> 0;
export const random: S.State<World, number> = w => { const seed = lcg(w.seed); return [seed / 2 ** 32, { ...w, seed }]; };
export const pick = <A>(xs: ReadonlyArray<A>): S.State<World, A> => w => {
  const [r, w1] = random(w);
  return [xs[Math.floor(r * xs.length)], w1];
};

/* ---------- narrator ---------- */
export const say = (text: string): Endo<World> => w => ({ ...w, say: text, sayN: w.sayN + 1 });
export const sayOneOf = (xs: ReadonlyArray<string>): Endo<World> => w => { const [t, w1] = pick(xs)(w); return say(t)(w1); };

/* ---------- conditions and triggers ---------- */
export type Cond = (env: Env, w: World) => boolean;
export const alive = (env: Env) => env.ps.filter(p => p.alive);
export const after = (t: number): Cond => (_, w) => w.t > t;
export const anyPast = (x: number): Cond => env => alive(env).some(p => p.x > x);
export const anyCenterPast = (x: number): Cond => env => alive(env).some(p => cx(p) > x);
export const and = (...cs: Cond[]): Cond => (env, w) => cs.every(c => c(env, w));
export const or = (...cs: Cond[]): Cond => (env, w) => cs.some(c => c(env, w));
export const not = (c: Cond): Cond => (env, w) => !c(env, w);
export const slotIs = <A extends Slot>(key: string, p: Predicate<A>): Cond => (_, w) => slotOr<A, boolean>(key, p, false)(w);

interface OnceS extends Slot { readonly kind: 'once'; readonly fired: boolean }
/** Fire an effect the first tick a condition holds, then never again. */
export const once = (key: string, cond: Cond, eff: Endo<World>): Behavior => behavior({
  init: setSlot<OnceS>(key, { kind: 'once', fired: false }),
  update: env => w => slotOr<OnceS, boolean>(key, s => !s.fired, false)(w) && cond(env, w)
    ? eff(setSlot<OnceS>(key, { kind: 'once', fired: true })(w))
    : w,
});
export const fired = (key: string): Cond => slotIs<OnceS>(key, s => s.fired);
/** Narration at a given time. */
export const at = (key: string, t: number, text: string) => once(key, after(t), say(text));
