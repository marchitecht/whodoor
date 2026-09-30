// Server-side bots as a pure State<Brain, BotAct>: same physics and rules as people, randomness from a seed.
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import type * as S from 'fp-ts/lib/State.js';
import {
  LEVELS, PS, W, FLOOR, mapInput, stepPlayer, checkPlayer,
  type World, type Body, type Input, type Rect, type Pts, type Endo,
} from '@whodoor/shared';

export interface Brain {
  readonly b: Body;
  readonly prev: Pick<Input, 'left' | 'right' | 'jump'>;
  readonly frame: number;
  readonly seed: number;
  readonly phase: number;
  /** seconds after level start before the bot starts moving */
  readonly delay: number;
  readonly pause: number;
  readonly lastX: number;
  readonly stuck: number;
  readonly ansAt: number;
  readonly drawAt: number;
}
export interface BotAct { readonly die?: string; readonly win?: boolean; readonly ans?: number; readonly draw?: Pts }

const lcg = (s: number) => (Math.imul(s, 1664525) + 1013904223) >>> 0;
const rand: S.State<Brain, number> = br => { const seed = lcg(br.seed); return [seed / 2 ** 32, { ...br, seed }]; };
/** Draw n random numbers in one go. */
const rands = (n: number): S.State<Brain, number[]> => br => {
  const out: number[] = []; let b = br;
  for (let i = 0; i < n; i++) { const [r, b2] = rand(b); out.push(r); b = b2; }
  return [out, b];
};

export const newBrain = (seed: number): Brain => ({
  b: { x: 60, y: FLOOR - PS, w: PS, h: PS, vx: 0, vy: 0, face: 1, g: false },
  prev: { left: false, right: false, jump: false }, frame: 0, seed, phase: seed % 40,
  delay: 0, pause: 0, lastX: 0, stuck: 0, ansAt: 0, drawAt: 0,
});

export const respawn = (w: World, slot: number): Endo<Brain> => br =>
  ({ ...br, b: { ...br.b, x: w.spawn[0] + slot * 6, y: w.spawn[1], vx: 0, vy: 0, g: false } });

/** A new level: human-like hesitation, and when to answer or draw on the gag levels. */
export const onLevel = (w: World, slot: number): Endo<Brain> => br => {
  const [[d, a, dr], b2] = rands(3)(br);
  return pipe({ ...b2, prev: { left: false, right: false, jump: false }, pause: 0, stuck: 0, delay: .4 + d * .9, ansAt: 2 + a * 3, drawAt: 3 + dr * 3 }, respawn(w, slot));
};

export const tick = (w: World, id: string, others: ReadonlyArray<Rect>, dt: number): S.State<Brain, BotAct> => br0 => {
  const L = LEVELS[w.lvl];
  const [[r1, r2, r3, r4], br1] = rands(4)(br0);
  let br: Brain = { ...br1, frame: br1.frame + 1 };
  let act: BotAct = {};

  // gag levels
  const me = w.pl[id];
  if (L.overlay === 'dialog' && !me?.ok && w.t > br.ansAt && (me?.lock ?? 0) <= w.t) {
    act = { ...act, ans: r1 < .45 ? 3 : Math.floor(r2 * 3) };
    br = { ...br, ansAt: w.t + 1 + r3 * 2 };
  }
  if (L.draw && !w.door && w.t > br.drawAt) {
    const x = Math.min(W - 60, br.b.x + 60);
    act = { ...act, draw: [[x, FLOOR - 60], [x, FLOOR], [x + 34, FLOOR], [x + 34, FLOOR - 60], [x, FLOOR - 60]] };
    br = { ...br, drawAt: w.t + 8 };
  }

  // movement: walk to the door (or the hole), jump on a rhythm and when blocked, sometimes hesitate
  const pause = br.pause > 0 ? br.pause - dt : r4 < dt * .35 ? .15 + r1 * .45 : 0;
  br = { ...br, pause };
  let raw = { left: false, right: false, jump: false };
  if (w.t > br.delay && br.pause <= 0) {
    const tx = w.door ? w.door.x + w.door.w / 2 : (w.c.last as { hole?: boolean } | undefined)?.hole ? 898 : W;
    const dx = tx - (br.b.x + br.b.w / 2);
    const left = dx < -8, right = dx > 8;
    const stuck = (left || right) && Math.abs(br.b.x - br.lastX) < .3 ? br.stuck + 1 : 0;
    br = { ...br, stuck };
    raw = { left, right, jump: (br.frame + br.phase) % 40 < 2 || stuck > 5 };
  }
  if (L.id === 'wait' && !(w.c.walker as { done?: boolean } | undefined)?.done) raw = { left: false, right: false, jump: false };
  const input: Input = { ...raw, leftP: raw.left && !br.prev.left, rightP: raw.right && !br.prev.right, jumpP: raw.jump && !br.prev.jump };
  br = { ...br, lastX: br.b.x, prev: raw };

  const [, b] = stepPlayer(mapInput(w, input, id), w, others, dt)(br.b);
  br = { ...br, b };
  return pipe(checkPlayer(w, b), O.match(
    () => [act, br],
    o => [o.tag === 'die' ? { ...act, die: o.msg } : { ...act, win: true }, br],
  ));
};

