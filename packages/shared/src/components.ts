// The component library. Each component owns a slot in the world and exposes a Behavior;
// levels are nothing but lists of these.
import { flow, identity, pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import * as L from 'monocle-ts/lib/Lens.js';
import * as Op from 'monocle-ts/lib/Optional.js';
import {
  W, H, FLOOR, PS, SPEED, NONE,
  box, mkDoor, floorBox, ov, hitC, cx, standingOn,
  _door, _doorX, _doorY, _solids, _spikes, _spawn, _gdir, _player, setTo,
  type World, type Rect, type Solid, type Door, type Slot, type Input,
} from './world.ts';
import {
  behavior, setSlot, getSlot, modifySlot, withSlot, slotOr, say, sayOneOf, alive,
  type Behavior, type Endo, type Env, type Cond,
} from './behavior.ts';

const some = <A>(a: A) => O.some(a);
const when = (c: boolean, f: Endo<World>): Endo<World> => (c ? f : identity);

/* ---------- static scenery ---------- */
export const door = (x: number, y?: number): Behavior => behavior({ init: w => ({ ...w, door: mkDoor(x, y) }) });
export const hangingDoor = (x: number, y: number): Behavior => behavior({ init: w => ({ ...w, door: { ...mkDoor(x, y), flip: true } }) });
export const blocks = (...ss: Solid[]): Behavior => behavior({ init: L.modify(RA.concat(ss))(_solids) });
export const spikes = (...rs: Rect[]): Behavior => behavior({ init: L.modify(RA.concat(rs))(_spikes) });
export const ceiling = () => blocks(box(0, 44, W, 20));
export const gravity = (dir: 1 | -1, spawn: readonly [number, number]): Behavior =>
  behavior({ init: flow(setTo<1 | -1>(dir)(_gdir), setTo(spawn)(_spawn)) });
const removeFloor: Endo<World> = L.modify<ReadonlyArray<Solid>>(RA.filter(s => !s.floor))(_solids);
const openHole = (x0: number, x1: number): Endo<World> =>
  flow(removeFloor, L.modify<ReadonlyArray<Solid>>(RA.concat([floorBox(0, x0), floorBox(x1, W - x1)]))(_solids));

/* ---------- breakable floor tiles: st 0 solid, 1 shaking, 2 falling, 3 gone ---------- */
export interface Tile extends Solid { readonly tile: true; readonly st: 0 | 1 | 2 | 3; readonly tt: number; readonly vy: number }
export interface TilesS extends Slot { readonly kind: 'tiles'; readonly tiles: ReadonlyArray<Tile>; readonly regrow: number; readonly size: number; readonly seam: boolean }
const mkTiles = (size: number, seam: boolean): ReadonlyArray<Tile> =>
  RA.makeBy(Math.ceil(W / size), i => ({ ...box(i * size, FLOOR, Math.min(size, W - i * size), H - FLOOR, { floor: true, seam }), tile: true as const, st: 0 as const, tt: 0, vy: 0 }));
const tileStep = (dt: number, regrow: number) => (t: Tile): Tile => {
  if (t.st === 1) { const tt = t.tt - dt; return tt <= 0 ? { ...t, tt, st: 2, vy: 0 } : { ...t, tt }; }
  if (t.st === 2) { const vy = t.vy + 1800 * dt, y = t.y + vy * dt; return y > H + 60 ? { ...t, vy, y, st: 3, tt: regrow } : { ...t, vy, y }; }
  if (t.st === 3 && regrow) { const tt = t.tt - dt; return tt <= 0 ? { ...t, st: 0, tt: 0, vy: 0, y: FLOOR } : { ...t, tt }; }
  return t;
};
/** Tiles replace the floor. Their falling runs in `update`, so put this after anything that drops tiles. */
export const tiles = (key: string, size: number, seam: boolean, regrow = 0): Behavior => behavior({
  init: flow(removeFloor, setSlot<TilesS>(key, { kind: 'tiles', tiles: mkTiles(size, seam), regrow, size, seam })),
  update: ({ dt }) => modifySlot<TilesS>(key, s => ({ ...s, tiles: s.tiles.map(tileStep(dt, s.regrow)) })),
  solids: slotOr<TilesS, ReadonlyArray<Solid>>(key, s => s.tiles.filter(t => t.st < 2), []),
});
export const dropTiles = (key: string, idx: ReadonlyArray<number>, delay = 0): Endo<World> =>
  modifySlot<TilesS>(key, s => ({ ...s, tiles: s.tiles.map((t, i) => (idx.includes(i) && !t.st ? { ...t, st: 1, tt: delay } : t)) }));
export const restoreTiles = (key: string): Endo<World> =>
  modifySlot<TilesS>(key, s => ({ ...s, tiles: s.tiles.map(t => ({ ...t, st: 0, tt: 0, vy: 0, y: FLOOR })) }));
export const resetTiles = (key: string): Endo<World> => modifySlot<TilesS>(key, s => ({ ...s, tiles: mkTiles(s.size, s.seam) }));
const tileIndexUnder = (key: string, p: Rect) => (w: World): O.Option<number> =>
  pipe(getSlot<TilesS>(key)(w), O.chain(s => pipe(standingOn(p, w.gdir)(s.tiles.filter(t => t.st < 2)), O.map(t => s.tiles.indexOf(t as Tile)))));

/** Tiles give way a moment after someone stands on them. */
export const crumbleUnderfoot = (tilesKey: string, delay: number, from: number): Behavior => behavior({
  update: env => w => w.t <= from ? w : pipe(alive(env).filter(p => p.g), RA.reduce(w, (acc, p) =>
    pipe(tileIndexUnder(tilesKey, p)(acc), O.match(() => acc, i => dropTiles(tilesKey, [i], delay)(acc))))),
});

/** Hidden trapdoors: tiles that drop when someone's centre passes a line. They never come back. */
interface TrapsS extends Slot { readonly kind: 'traps'; readonly traps: ReadonlyArray<{ readonly t: ReadonlyArray<number>; readonly at: number; readonly on: boolean }> }
export const traps = (key: string, tilesKey: string, list: ReadonlyArray<{ t: number[]; at: number }>, lines: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<TrapsS>(key, { kind: 'traps', traps: list.map(x => ({ ...x, on: false })) }),
  update: env => withSlot<TrapsS>(key, s => w => pipe(s.traps, RA.reduceWithIndex(w, (i, acc, tr) =>
    tr.on || !alive(env).some(p => cx(p) > tr.at) ? acc
      : pipe(acc,
        modifySlot<TrapsS>(key, q => ({ ...q, traps: q.traps.map((x, j) => (j === i ? { ...x, on: true } : x)) })),
        dropTiles(tilesKey, tr.t),
        sayOneOf(lines))))),
});

/** The door falls through the floor once someone gets close; a spare appears at the start. */
interface DoorFallS extends Slot { readonly kind: 'doorfall'; readonly phase: 0 | 1 | 2; readonly dfall: boolean; readonly dvy: number }
export const doorFallsAway = (key: string, tilesKey: string, near: number): Behavior => behavior({
  init: setSlot<DoorFallS>(key, { kind: 'doorfall', phase: 0, dfall: false, dvy: 0 }),
  update: env => w => {
    const s0 = getSlot<DoorFallS>(key)(w); if (O.isNone(s0)) return w;
    let s = s0.value, w1 = w;
    if (s.phase === 0 && alive(env).some(p => p.x > near)) {
      s = { ...s, phase: 1, dfall: true, dvy: 0 };
      w1 = pipe(w1, dropTiles(tilesKey, [14]), dropTiles(tilesKey, [15]), say('Ой.'));
    }
    if (s.dfall) {
      const dvy = s.dvy + 1800 * env.dt;
      s = { ...s, dvy };
      w1 = Op.modify((y: number) => y + dvy * env.dt)(_doorY)(w1);
      if ((w1.door?.y ?? 0) > H + 60) {
        s = { ...s, dfall: false, phase: 2 };
        w1 = pipe(w1, restoreTiles(tilesKey), x => ({ ...x, door: mkDoor(14), spawn: [900, FLOOR - PS] as const }),
          say('Дверь упала. Ничего, запасная есть — в начале уровня.'));
      }
    }
    return setSlot(key, s)(w1);
  },
  canEnter: w => !slotOr<DoorFallS, boolean>(key, s => s.dfall, false)(w),
});

/* ---------- moving hazards ---------- */
export interface SawS extends Slot { readonly kind: 'saw'; readonly x: number; readonly v: number; readonly on: boolean; readonly min?: number; readonly max?: number; readonly speed: number; readonly r: number }
/** A floor saw. With min/max it patrols; without, it sits until launched and leaves when it rolls off screen. */
export const saw = (key: string, o: { x: number; v?: number; min?: number; max?: number; r?: number }, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<SawS>(key, { kind: 'saw', x: o.x, v: o.v ?? 0, on: true, min: o.min, max: o.max, speed: Math.abs(o.v ?? 0), r: o.r ?? 32 }),
  update: ({ dt }) => modifySlot<SawS>(key, s => {
    if (!s.on) return s;
    let x = s.x + s.v * dt, v = s.v;
    if (s.max !== undefined && x > s.max) { x = s.max; v = -s.speed; }
    if (s.min !== undefined && x < s.min) { x = s.min; v = s.speed; }
    return { ...s, x, v, on: x >= -60 };
  }),
  hits: p => w => pipe(getSlot<SawS>(key)(w), O.filter(s => s.on && hitC(p, s.x, FLOOR, s.r)), O.map(() => deathLine(deaths, w))),
});
export const launch = (key: string, v: number): Endo<World> => modifySlot<SawS>(key, s => ({ ...s, v }));
export const sawGone = (key: string): Cond => (_, w) => slotOr<SawS, boolean>(key, s => !s.on, false)(w);
/** Death lines are picked from the tick number: no RNG state needed on the client. */
export const deathLine = (xs: ReadonlyArray<string>, w: World) => xs[Math.floor(w.t * 60) % xs.length];

export interface Icicle { readonly x: number; readonly y: number; readonly vy: number; readonly st: 0 | 1 | 2 | 3; readonly tt: number }
export interface IciclesS extends Slot { readonly kind: 'icicles'; readonly ic: ReadonlyArray<Icicle> }
const icicleBox = (c: Icicle): Rect => ({ x: c.x + 4, y: c.y, w: 14, h: 34 });
const icicleHits = (xs: ReadonlyArray<Icicle>, p: Rect) => xs.some(c => c.st === 2 && ov(p, icicleBox(c)));
/** Icicles fall when someone comes near and grow back a few seconds after shattering. */
export const icicles = (key: string, xs: ReadonlyArray<number>, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<IciclesS>(key, { kind: 'icicles', ic: xs.map(x => ({ x, y: 64, vy: 0, st: 0, tt: 0 })) }),
  update: env => modifySlot<IciclesS>(key, s => ({
    ...s,
    ic: s.ic.map((c): Icicle => {
      if (c.st === 0 && alive(env).some(p => Math.abs(c.x + 11 - cx(p)) < 90)) return { ...c, st: 1, tt: .15 };
      if (c.st === 1) { const tt = c.tt - env.dt; return tt <= 0 ? { ...c, tt, st: 2, vy: 0 } : { ...c, tt }; }
      if (c.st === 2) { const vy = c.vy + 1800 * env.dt, y = c.y + vy * env.dt; return y + 34 >= FLOOR ? { ...c, vy, y, st: 3, tt: 2.5 } : { ...c, vy, y }; }
      if (c.st === 3) { const tt = c.tt - env.dt; return tt <= 0 ? { ...c, tt, st: 0, y: 64, vy: 0 } : { ...c, tt }; }
      return c;
    }),
  })),
  hits: p => w => pipe(getSlot<IciclesS>(key)(w), O.filter(s => icicleHits(s.ic, p)), O.map(() => deathLine(deaths, w))),
});

/** The icicle above the door: it waits, then breaks the door and leaves a hole — falling in wins. */
export interface BreakerS extends Slot { readonly kind: 'breaker'; readonly c: Icicle; readonly hole: boolean }
export const doorBreaker = (key: string, x: number, trigger: number, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<BreakerS>(key, { kind: 'breaker', c: { x, y: 64, vy: 0, st: 0, tt: 0 }, hole: false }),
  update: env => withSlot<BreakerS>(key, s => w => {
    const c = s.c;
    if (c.st === 0 && alive(env).some(p => cx(p) > trigger)) return pipe(w, setSlot(key, { ...s, c: { ...c, st: 1, tt: .3 } }), say('…'));
    if (c.st === 1) { const tt = c.tt - env.dt; return setSlot(key, { ...s, c: tt <= 0 ? { ...c, tt, st: 2, vy: 300 } : { ...c, tt } })(w); }
    if (c.st === 2) {
      const vy = c.vy + 1800 * env.dt, y = c.y + vy * env.dt;
      const hit = !!w.door && y + 34 >= w.door.y;
      return hit
        ? pipe(w, setSlot(key, { ...s, c: { ...c, vy, y, st: 3 }, hole: true }), x2 => ({ ...x2, door: null }), openHole(860, 936), say('Упс. Двери нет. Зато есть дыра.'))
        : setSlot(key, { ...s, c: { ...c, vy, y } })(w);
    }
    return w;
  }),
  hits: p => w => pipe(getSlot<BreakerS>(key)(w), O.filter(s => icicleHits([s.c], p)), O.map(() => deathLine(deaths, w))),
  onFall: slotOr<BreakerS, boolean>(key, s => s.hole, false),
});

export interface PendS extends Slot { readonly kind: 'pendulums'; readonly pd: ReadonlyArray<{ readonly x: number; readonly ph: number; readonly bx: number; readonly by: number }>; readonly chaos: boolean }
const swing = (t: number, chaos: boolean) => (q: PendS['pd'][number]) => {
  const a = chaos ? .7 * Math.sin(2.1 * t + q.ph) + .45 * Math.sin(3.7 * t + q.ph * 2) : .95 * Math.sin(2.1 * t + q.ph);
  return { ...q, bx: q.x + Math.sin(a) * 380, by: 64 + Math.cos(a) * 380 };
};
/** Spiked pendulums hanging from the ceiling; after `chaosAt` seconds they lose the rhythm. */
export const pendulums = (key: string, list: ReadonlyArray<{ x: number; ph: number }>, chaosAt: number, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: w => setSlot<PendS>(key, { kind: 'pendulums', pd: list.map(q => swing(w.t, false)({ ...q, bx: 0, by: 0 })), chaos: false })(w),
  update: () => w => withSlot<PendS>(key, s => {
    const chaos = s.chaos || w.t > chaosAt;
    return flow(when(chaos && !s.chaos, say('Маятники укачало. Ритма больше нет.')), setSlot(key, { ...s, chaos, pd: s.pd.map(swing(w.t, chaos)) }));
  })(w),
  hits: p => w => pipe(getSlot<PendS>(key)(w), O.filter(s => s.pd.some(q => hitC(p, q.bx, q.by, 28))), O.map(() => deathLine(deaths, w))),
});

export interface Plate { readonly x: number; readonly y: number; readonly vy: number; readonly st: 0 | 1 | 2 | 3; readonly tt: number }
export interface CrusherS extends Slot { readonly kind: 'crusher'; readonly cy: number; readonly crush: boolean; readonly pl: ReadonlyArray<Plate>; readonly slabs: ReadonlyArray<Solid> }
const crusherInit = (xs: ReadonlyArray<number>): CrusherS => ({ kind: 'crusher', cy: 44, crush: false, pl: xs.map(x => ({ x, y: 64, vy: 0, st: 0, tt: 0 })), slabs: [] });
/** Plates drop from the ceiling and stay as obstacles; past `trigger` the whole ceiling comes down, then resets. */
export const crusher = (key: string, xs: ReadonlyArray<number>, trigger: number, doorX: number, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot(key, crusherInit(xs)),
  update: env => withSlot<CrusherS>(key, s0 => w0 => {
    let s = s0, w = w0;
    if (!s.crush && alive(env).some(p => p.x > trigger)) { s = { ...s, crush: true }; w = say('Обвал! Бегите!')(w); }
    if (s.crush) {
      s = { ...s, cy: s.cy + 150 * env.dt };
      if (s.cy > FLOOR - 60) return pipe(w, setSlot(key, crusherInit(xs)), x => ({ ...x, door: mkDoor(doorX) }), say('Потолок подняли обратно. Ещё раз.'));
    }
    const slabs: Solid[] = [...s.slabs];
    const pl = s.pl.map((q0): Plate => {
      let q = q0;
      if (q.st === 0 && alive(env).some(p => Math.abs(q.x + 40 - cx(p)) < 75)) q = { ...q, st: 1, tt: .25 };
      if (q.st === 1) { const tt = q.tt - env.dt; q = tt <= 0 ? { ...q, tt, st: 2, vy: 0 } : { ...q, tt }; }
      if (q.st < 2) q = { ...q, y: s.cy + 20 };
      if (q.st === 2) {
        const vy = q.vy + 1800 * env.dt, y = q.y + vy * env.dt;
        q = { ...q, vy, y };
        if (y + 20 >= FLOOR) { q = { ...q, y: FLOOR - 20, st: 3 }; slabs.push(box(q.x, FLOOR - 20, 80, 20)); }
      }
      return q;
    });
    return setSlot(key, { ...s, pl, slabs })(w);
  }),
  solids: slotOr<CrusherS, ReadonlyArray<Solid>>(key, s => s.slabs, []),
  hits: p => w => pipe(getSlot<CrusherS>(key)(w), O.chain(s =>
    s.pl.some(q => q.st === 2 && ov(p, { x: q.x, y: q.y, w: 80, h: 20 })) ? some(deathLine(deaths, w))
      : s.crush && p.y < s.cy + 36 ? some('Потолок победил.') : O.none)),
});

export interface StripsS extends Slot { readonly kind: 'rhythm'; readonly st: ReadonlyArray<{ readonly x: number; readonly w: number; readonly i: number; readonly hh: number; readonly warn: boolean }>; readonly beat: number; readonly bt: number; readonly bl: number; readonly pulse: number; readonly drop: boolean }
/** Spike strips rising on alternate beats; past `dropAt` the tempo goes up. */
export const rhythmSpikes = (key: string, xs: ReadonlyArray<number>, width: number, dropAt: number, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<StripsS>(key, { kind: 'rhythm', st: xs.map((x, i) => ({ x, w: width, i, hh: 3, warn: false })), beat: 0, bt: 0, bl: .8, pulse: 0, drop: false }),
  update: env => withSlot<StripsS>(key, s0 => w => {
    let s = s0, w1 = w;
    if (!s.drop && alive(env).some(p => p.x > dropAt)) { s = { ...s, drop: true, bl: .6 }; w1 = say('ДРОП!')(w1); }
    let bt = s.bt + env.dt, beat = s.beat, pulse = s.pulse;
    if (bt >= s.bl) { bt -= s.bl; beat++; if (s.drop) pulse = .14; }
    if (pulse > 0) pulse -= env.dt;
    const st = s.st.map(q => {
      const up = (beat + q.i) % 2 === 0;
      return { ...q, warn: !up && bt > s.bl * .55, hh: q.hh + ((up ? 22 : 3) - q.hh) * Math.min(1, env.dt * 30) };
    });
    return setSlot(key, { ...s, bt, beat, pulse, st })(w1);
  }),
  hits: p => w => pipe(getSlot<StripsS>(key)(w),
    O.filter(s => s.st.some(q => q.hh > 12 && ov(p, { x: q.x, y: FLOOR - q.hh, w: q.w, h: q.hh }, 3))), O.map(() => deathLine(deaths, w))),
});

export interface BallS extends Slot { readonly kind: 'ball'; readonly x: number; readonly y: number; readonly st: 'wait' | 'chase' | 'hop' | 'in' | 'out'; readonly t: number; readonly x0: number }
/** A spiked ball chases everyone, hops over the leader into the door, sits there, then rolls back out. */
export const rollingBall = (key: string, doorX: number, hopAt: number, deaths: ReadonlyArray<string>): Behavior => behavior({
  init: setSlot<BallS>(key, { kind: 'ball', x: -80, y: FLOOR - 34, st: 'wait', t: 0, x0: 0 }),
  update: env => withSlot<BallS>(key, b => w => {
    const dt = env.dt, set = (nb: BallS) => setSlot(key, nb);
    switch (b.st) {
      case 'wait': { const t = b.t + dt; return set(t > .9 ? { ...b, t, st: 'chase', x: -80, y: FLOOR - 34 } : { ...b, t })(w); }
      case 'chase': {
        const x = b.x + 200 * dt;
        return set(alive(env).some(p => p.x > hopAt) || x > 720 ? { ...b, x, st: 'hop', t: 0, x0: x } : { ...b, x })(w);
      }
      case 'hop': {
        const t = b.t + dt, k = Math.min(1, t / .8);
        const x = b.x0 + (doorX - b.x0) * k, y = FLOOR - 34 - Math.sin(k * Math.PI) * 170;
        return k >= 1
          ? pipe(w, set({ ...b, t: 0, x, y: FLOOR - 34, st: 'in' }), setTo<readonly [number, number]>([700, FLOOR - PS])(_spawn), say('Шар зашёл первым. Занято. Чекпоинт у двери.'))
          : set({ ...b, t, x, y })(w);
      }
      case 'in': { const t = b.t + dt; return t > 2.2 ? pipe(w, set({ ...b, t, st: 'out', x: doorX }), say('Выходит! Прыгайте.')) : set({ ...b, t })(w); }
      case 'out': { const x = b.x - 330 * dt; return x < -80 ? pipe(w, set({ ...b, x, st: 'wait', t: -1.5 }), say('Свободно. Пока что.')) : set({ ...b, x })(w); }
    }
  }),
  hits: p => w => pipe(getSlot<BallS>(key)(w), O.filter(b => (b.st === 'chase' || b.st === 'out') && hitC(p, b.x, b.y, 34)), O.map(() => deathLine(deaths, w))),
  canEnter: slotOr<BallS, boolean>(key, b => b.st !== 'hop' && b.st !== 'in', true),
});

export interface Lift extends Solid { readonly ph: number; readonly lunch: boolean; readonly k: number }
export interface LiftsS extends Slot { readonly kind: 'lifts'; readonly lf: ReadonlyArray<Lift>; readonly back: boolean }
const moveLifts = (t: number, dt: number) => (s: LiftsS): LiftsS => ({
  ...s,
  lf: s.lf.map(l => {
    let y = 360 + 60 * Math.sin(1.6 * t + l.ph), k = l.k;
    if (l.lunch) { if (!s.back) y = -60; else { k = Math.min(1, k + dt * .6); y = -60 + (y + 60) * k; } }
    return { ...l, prevY: l.y, y, k, active: !(l.lunch && !s.back) };
  }),
});
/** Lifts bobbing over a spike pit; the one marked `lunch` is away until `backAt`. */
export const lifts = (key: string, list: ReadonlyArray<{ x: number; ph: number; lunch?: boolean }>, backAt: number): Behavior => behavior({
  init: w => setSlot<LiftsS>(key, moveLifts(w.t, 0)({ kind: 'lifts', back: false, lf: list.map(o => ({ ...box(o.x, 380, 90, 14, { oneway: true }), ph: o.ph, lunch: !!o.lunch, k: 0 })) }))(w),
  update: ({ dt }) => w => withSlot<LiftsS>(key, s => {
    const back = s.back || w.t > backAt;
    return flow(when(back && !s.back, say('Вернулся с обеда. Сытый, медленный.')), setSlot(key, moveLifts(w.t, dt)({ ...s, back })));
  })(w),
  solids: slotOr<LiftsS, ReadonlyArray<Solid>>(key, s => s.lf.filter(l => l.active !== false), []),
});

export interface CollapseS extends Slot { readonly kind: 'collapse'; readonly cx: number; readonly st: 0 | 1 | 2 | 3 | 4; readonly clock: number; readonly pt: number; readonly rt: number; readonly obst: ReadonlyArray<Solid> }
/** The floor collapses behind the players, pauses, then outruns them. Splits into a driver and its obstacles so tile order stays right. */
export const collapse = (key: string, tilesKey: string, setup: { obst: Solid[]; spikes: Rect[]; doorX: number }) => {
  const reset: Endo<World> = flow(
    setSlot<CollapseS>(key, { kind: 'collapse', cx: -40, st: 0, clock: 0, pt: 0, rt: 0, obst: setup.obst }),
    setTo<ReadonlyArray<Rect>>(setup.spikes)(_spikes),
    w => ({ ...w, door: mkDoor(setup.doorX) }),
  );
  const driver = behavior({
    init: reset,
    update: env => withSlot<CollapseS>(key, s0 => w0 => {
      const dt = env.dt;
      let s: CollapseS = { ...s0, clock: s0.clock + dt }, w = w0;
      if (s.st === 0 && s.clock > 1.2) s = { ...s, st: 1 };
      else if (s.st === 1) { s = { ...s, cx: s.cx + 170 * dt }; if (s.cx >= 440) { s = { ...s, st: 2, pt: 1.6 }; w = say('Передохните.')(w); } }
      else if (s.st === 2) { s = { ...s, pt: s.pt - dt }; if (s.pt <= 0) { s = { ...s, st: 3 }; w = say('Шучу. БЕГИТЕ.')(w); } }
      else if (s.st === 3) { s = { ...s, cx: s.cx + 320 * dt }; if (s.cx > W + 40) s = { ...s, st: 4, rt: 1.5 }; }
      else if (s.st === 4) { s = { ...s, rt: s.rt - dt }; if (s.rt <= 0) return pipe(w, resetTiles(tilesKey), reset, say('Пол починили. Ещё раз.')); }
      const front = s.cx;
      const drop = pipe(getSlot<TilesS>(tilesKey)(w), O.map(ts => ts.tiles.flatMap((t, i) => (!t.st && t.x + t.w <= front ? [i] : []))), O.getOrElse((): number[] => []));
      w = pipe(w, dropTiles(tilesKey, drop, .08), L.modify<ReadonlyArray<Rect>>(RA.filter(sp => sp.x + sp.w > front))(_spikes));
      s = { ...s, obst: s.obst.filter(o => o.x + o.w > front) };
      w = setSlot(key, s)(w);
      return w.door && front > w.door.x ? pipe(w, x => ({ ...x, door: null }), say('Опоздали.')) : w;
    }),
  });
  const obstacles = behavior({ solids: slotOr<CollapseS, ReadonlyArray<Solid>>(key, s => s.obst, []) });
  return { driver, obstacles };
};

export interface CreditsS extends Slot { readonly kind: 'credits'; readonly lines: ReadonlyArray<Solid> }
const syncCreditsDoor = (s: CreditsS): Endo<World> => w => {
  const L0 = s.lines[s.lines.length - 1];
  return { ...w, door: { ...(w.door ?? mkDoor(0, 0)), x: L0.x + L0.w - 40, y: L0.y - 52 } };
};
/** Rolling credits you can stand on; the last line carries the door. */
export const credits = (key: string, lines: ReadonlyArray<string>, charW: number, speed: number): Behavior => behavior({
  init: w => {
    const s: CreditsS = {
      kind: 'credits',
      lines: lines.map((t, i) => {
        const last = i === lines.length - 1, tw = t.length * charW;
        return box(i % 2 ? 470 : 90, FLOOR + 20 + i * 100, last ? tw + 80 : tw, 20, { oneway: true, text: t, color: last ? 'accent' : 'ink', active: false });
      }),
    };
    return pipe(w, x => ({ ...x, door: mkDoor(0, 0) }), setSlot(key, s), syncCreditsDoor(s));
  },
  update: ({ dt }) => withSlot<CreditsS>(key, s0 => w => {
    let ls = s0.lines.map(l => { const y = l.y - speed * dt; return { ...l, prevY: l.y, y, active: y < FLOOR - 2 }; });
    let w1 = w;
    if (ls[ls.length - 1].y < -80) { const d = FLOOR + 20 - ls[0].y; ls = ls.map(l => ({ ...l, y: l.y + d, prevY: l.y + d })); w1 = say('Ещё круг титров. Специально для вас.')(w1); }
    const s = { ...s0, lines: ls };
    return pipe(w1, setSlot(key, s), syncCreditsDoor(s));
  }),
  solids: slotOr<CreditsS, ReadonlyArray<Solid>>(key, s => s.lines.filter(l => l.active), []),
  canEnter: slotOr<CreditsS, boolean>(key, s => !!s.lines[s.lines.length - 1].active, false),
});

/* ---------- door behaviours ---------- */
interface ShyS extends Slot { readonly kind: 'shy'; readonly wrapped: boolean }
/** The door runs from whoever is closest and looking at it, and creeps up when they look away. */
export const shyDoor = (key: string): Behavior => behavior({
  init: setSlot<ShyS>(key, { kind: 'shy', wrapped: false }),
  update: env => w => {
    const d0 = w.door, a = alive(env);
    if (!d0) return w;
    if (!a.length) return { ...w, door: { ...d0, moving: false } };
    const dc = cx(d0), p = a.reduce((m, q) => (Math.abs(cx(q) - dc) < Math.abs(cx(m) - dc) ? q : m));
    const dir = Math.sign(dc - cx(p)) || 1, dist = Math.abs(dc - cx(p));
    let x = d0.x, moving = false;
    if (p.face === dir) { if (dist < 280) { x += dir * SPEED * 1.3 * env.dt; moving = true; } }
    else { x -= dir * SPEED * .75 * env.dt; moving = true; }
    let w1 = w;
    if (x > W - d0.w) {
      x = 4;
      if (!slotOr<ShyS, boolean>(key, s => s.wrapped, true)(w1)) w1 = pipe(w1, setSlot<ShyS>(key, { kind: 'shy', wrapped: true }), say('Она обежала уровень по кругу. Теперь подкрадывается сзади.'));
    }
    if (x < 0) x = W - d0.w - 4;
    return { ...w1, door: { ...d0, x, moving } };
  },
});
export const doorWrapped: Cond = (_, w) => slotOr<ShyS, boolean>('shy', s => s.wrapped, false)(w);

interface WalkerS extends Slot { readonly kind: 'walker'; readonly wait: number; readonly done: boolean; readonly n: number }
/** Nobody may press anything for `secs`; the door walks from `from` to `to`. Any press resets it. */
export const patienceDoor = (key: string, from: number, to: number, secs: number, lines: ReadonlyArray<string>): Behavior => behavior({
  init: flow(setSlot<WalkerS>(key, { kind: 'walker', wait: 0, done: false, n: 0 }), w => ({ ...w, door: mkDoor(from) })),
  update: ({ dt }) => withSlot<WalkerS>(key, s => w => {
    if (s.done) return w;
    const wait = s.wait + dt, k = Math.min(1, wait / secs), done = k >= 1;
    return pipe(w,
      setSlot(key, { ...s, wait, done }),
      Op.modify((d: Door) => ({ ...d, x: from + (to - from) * k, moving: k < 1 }))(_door),
      when(done, say('Спасибо, что не трогали. А теперь — бегом!')));
  }),
  poke: name => withSlot<WalkerS>(key, s => s.done ? identity
    : flow(setSlot(key, { ...s, wait: 0, n: s.n + 1 }), setTo(from)(_doorX), say(`${name}, ${lines[s.n % lines.length]}`))),
  input: (_, w) => slotOr<WalkerS, boolean>(key, s => s.done, true)(w) ? identity : () => NONE,
  canEnter: slotOr<WalkerS, boolean>(key, s => s.done, true),
});

interface DrawnS extends Slot { readonly kind: 'drawn'; readonly strokes: ReadonlyArray<ReadonlyArray<readonly [number, number]>> }
/** No door until someone draws one. */
export const drawnDoor = (key: string): Behavior => behavior({
  init: flow(setSlot<DrawnS>(key, { kind: 'drawn', strokes: [] }), w => ({ ...w, door: null })),
  drawDoor: pts => w => {
    if (!Array.isArray(pts) || pts.length < 2) return w;
    const P = pts.slice(0, 120).map(([x, y]) => [Math.max(0, Math.min(W, +x || 0)), Math.max(0, Math.min(H, +y || 0))] as const);
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), bw = x1 - x0, bh = y1 - y0;
    if (bw < 22 || bh < 36) return say('Маловата. Туда никто не пролезет.')(w);
    return pipe(w, setSlot<DrawnS>(key, { kind: 'drawn', strokes: [P] }), x => ({ ...x, door: { x: x0, y: y0, w: bw, h: bh, drawn: true } }),
      say(bh > 220 ? 'Ого. Парадный вход.' : bw > 200 ? 'Это не дверь, это ворота. Но ладно.' : 'Отличная дверь. Почти как настоящая.'));
  },
});

/* ---------- player-facing rules ---------- */
/** Everyone's square is tired: each player has to find the right words for their own. */
export const persuade = (opts: ReadonlyArray<readonly [string, string | null]>, yes: string): Behavior => behavior({
  input: (pid, w) => (w.pl[pid]?.ok ? identity : () => NONE),
  answer: (pid, i) => w => {
    const st = w.pl[pid] ?? {}, withPl = setTo(O.some(st))(_player(pid))(w);
    if (st.ok || (st.lock ?? 0) > w.t) return [O.none, withPl];
    const o = opts[i]; if (!o) return [O.none, withPl];
    return o[1]
      ? [O.some(o[1]), setTo(O.some({ ...st, lock: w.t + 2 }))(_player(pid))(w)]
      : [O.some(yes), setTo(O.some({ ...st, ok: true }))(_player(pid))(w)];
  },
});

/** Controls fine at first, then swapped, then "fixed" into something worse. */
export const scrambledControls = (swapAt: number, fixAt: number): Behavior => behavior({
  input: (_, w) => (i: Input): Input => w.t < swapAt ? i
    : w.t < fixAt ? { left: i.right, right: i.left, jump: i.jump, leftP: i.rightP, rightP: i.leftP, jumpP: i.jumpP }
      : { left: i.right, right: i.jump, jump: i.left, leftP: i.rightP, rightP: i.jumpP, jumpP: i.leftP },
});

interface CardboardS extends Slot { readonly kind: 'cardboard'; readonly flat: ReadonlyArray<number>; readonly told: boolean }
/** Spikes that turn out to be cardboard: walking through flattens them. Pair with `harmlessSpikes` in the level meta. */
export const cardboard = (key: string): Behavior => behavior({
  init: setSlot<CardboardS>(key, { kind: 'cardboard', flat: [], told: false }),
  update: env => w => pipe(alive(env), RA.reduce(w, (acc, p) => pipe(acc.spikes, RA.reduce(acc, (a2, sp) => {
    if (!ov(p, sp, 3)) return a2;
    const from = Math.floor((p.x - sp.x) / 22), to = Math.floor((p.x + p.w - sp.x) / 22);
    return withSlot<CardboardS>(key, s => {
      const flat = [...s.flat]; for (let i = from; i <= to; i++) if (!flat.includes(i)) flat.push(i);
      return flow(setSlot(key, { ...s, flat, told: true }), when(!s.told, say('…это картон. Шипы картонные. Идите уже.')));
    })(a2);
  })))),
});

/** A static trigger for scenery facts: someone is standing on text that starts with `prefix`. */
export const standingOnText = (prefix: string): Cond => (env, w) =>
  alive(env).some(p => pipe(standingOn(p, w.gdir)(w.solids), O.exists(s => !!s.text?.startsWith(prefix))));
