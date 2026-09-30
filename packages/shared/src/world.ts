// Geometry, the immutable world, and the optics everything else is built from.
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import * as L from 'monocle-ts/lib/Lens.js';
import * as Op from 'monocle-ts/lib/Optional.js';

export const W = 960, H = 540, FLOOR = 470;
export const SPEED = 250, JUMP = 560, GRAV = 1500, PS = 26;
/** IBM Plex Mono advance at 600 weight / 20px: 0.6em. The server has no canvas, so text widths use this. */
export const CHAR_W = 12;

export interface Rect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface Solid extends Rect {
  readonly oneway?: boolean;
  readonly floor?: boolean;
  readonly text?: string;
  readonly color?: 'mute' | 'ink' | 'accent';
  readonly active?: boolean;
  readonly prevY?: number;
  readonly seam?: boolean;
  readonly st?: number;
}
export interface Door extends Rect { readonly moving?: boolean; readonly flip?: boolean; readonly drawn?: boolean }
export interface PlayerState { readonly ok?: boolean; readonly lock?: number }
/** Every component keeps its state in a named slot; `kind` tells the renderer how to draw it. */
export interface Slot { readonly kind: string }

export interface World {
  readonly lvl: number;
  readonly t: number;
  /** RNG state: narrator picks stay pure and replayable */
  readonly seed: number;
  /** static solids; components add dynamic ones through Behavior.solids */
  readonly solids: ReadonlyArray<Solid>;
  readonly spikes: ReadonlyArray<Rect>;
  readonly door: Door | null;
  readonly gdir: 1 | -1;
  readonly spawn: readonly [number, number];
  readonly c: Readonly<Record<string, Slot>>;
  readonly say: string;
  readonly sayN: number;
  readonly pl: Readonly<Record<string, PlayerState>>;
}

/** What the world knows about a player when running triggers. */
export interface PV extends Rect { readonly id: string; readonly face: number; readonly g: boolean; readonly alive: boolean }
export interface Body extends Rect { readonly vx: number; readonly vy: number; readonly face: number; readonly g: boolean }
export interface Input { readonly left: boolean; readonly right: boolean; readonly jump: boolean; readonly leftP: boolean; readonly rightP: boolean; readonly jumpP: boolean }
export const NONE: Input = { left: false, right: false, jump: false, leftP: false, rightP: false, jumpP: false };

/* ---------- geometry ---------- */
export const box = (x: number, y: number, w: number, h: number, o: Omit<Solid, keyof Rect> = {}): Solid => ({ x, y, w, h, ...o });
export const mkDoor = (x: number, y: number = FLOOR - 52): Door => ({ x, y, w: 34, h: 52 });
export const spk = (x: number, w: number): Rect => ({ x, y: FLOOR - 22, w, h: 22 });
export const floorBox = (x = 0, w = W): Solid => box(x, FLOOR, w, H - FLOOR, { floor: true });
export const textPlat = (text: string, x: number, y: number, color: Solid['color'] = 'ink'): Solid =>
  box(x, y, text.length * CHAR_W, 20, { oneway: true, text, color });
export const ov = (a: Rect, b: Rect, s = 0) => a.x + s < b.x + b.w && a.x + a.w - s > b.x && a.y + s < b.y + b.h && a.y + a.h - s > b.y;
export const cx = (r: Rect) => r.x + r.w / 2;
export function hitC(p: Rect, x: number, y: number, r: number) {
  const nx = Math.max(p.x, Math.min(x, p.x + p.w)), ny = Math.max(p.y, Math.min(y, p.y + p.h));
  return (nx - x) ** 2 + (ny - y) ** 2 < (r - 4) ** 2;
}
/** The first solid a box stands on (normal gravity only). */
export const standingOn = (p: Rect, gdir: number) => (ss: ReadonlyArray<Solid>): O.Option<Solid> =>
  gdir < 0 ? O.none : pipe(ss, RA.findFirst(s => Math.abs(p.y + p.h - s.y) < 2.5 && p.x + p.w > s.x && p.x < s.x + s.w));

export const newWorld = (lvl: number): World => ({
  lvl, t: 0, seed: (0x9E3779B9 ^ (lvl * 2654435761)) >>> 0,
  solids: [floorBox()], spikes: [], door: null, gdir: 1, spawn: [60, FLOOR - PS],
  c: {}, say: '', sayN: 0, pl: {},
});

/* ---------- optics ---------- */
/** Point-free setter that works for any optic with `set` (Lens, Optional). */
export const setTo = <A>(a: A) => <S>(o: { readonly set: (a: A) => (s: S) => S }): ((s: S) => S) => o.set(a);
const world = L.id<World>();
export const _t = pipe(world, L.prop('t'));
export const _solids = pipe(world, L.prop('solids'));
export const _spikes = pipe(world, L.prop('spikes'));
export const _spawn = pipe(world, L.prop('spawn'));
export const _gdir = pipe(world, L.prop('gdir'));
/** The door may not exist (drawn later, broken, fallen): an Optional, not a Lens. */
export const _door: Op.Optional<World, Door> = pipe(world, L.prop('door'), L.fromNullable);
export const _doorX = pipe(_door, Op.prop('x'));
export const _doorY = pipe(_door, Op.prop('y'));
/** Slot presence as an Option — used to create a component's state. */
export const _slotAt = (key: string) => pipe(world, L.prop('c'), L.atKey(key));
/** A component's own state. The key is the component's, so the cast is local to it. */
export const _slot = <S extends Slot>(key: string): Op.Optional<World, S> =>
  pipe(world, L.prop('c'), L.key(key)) as unknown as Op.Optional<World, S>;
export const _player = (pid: string) => pipe(world, L.prop('pl'), L.atKey(pid));
