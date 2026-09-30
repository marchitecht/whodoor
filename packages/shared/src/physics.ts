// Player physics as a State over the body: the step returns whether the player jumped.
import { pipe } from 'fp-ts/lib/function.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import type * as S from 'fp-ts/lib/State.js';
import { W, SPEED, JUMP, GRAV, ov, type Body, type Input, type Rect, type Solid } from './world.ts';

export interface Env { readonly solids: ReadonlyArray<Solid>; readonly others: ReadonlyArray<Rect>; readonly gdir: 1 | -1; readonly dt: number }

const clamp = (lo: number, hi: number) => (v: number) => Math.max(lo, Math.min(hi, v));

/** Horizontal pass: walls push the body back against its direction of travel. */
const resolveX = (b: Body, s: Solid): Body =>
  s.oneway || !ov(b, s) ? b : b.vx > 0 ? { ...b, x: s.x - b.w } : b.vx < 0 ? { ...b, x: s.x + s.w } : b;

/** Vertical pass: one-way platforms only catch a body falling onto them from above. */
const resolveY = (gd: 1 | -1, prevBottom: number) => (b: Body, s: Solid): Body => {
  if (!ov(b, s)) return b;
  if (s.oneway) return gd > 0 && b.vy >= 0 && prevBottom <= (s.prevY ?? s.y) + 6 ? { ...b, y: s.y - b.h, vy: 0, g: true } : b;
  return b.vy > 0
    ? { ...b, y: s.y - b.h, vy: 0, g: gd > 0 ? true : b.g }
    : { ...b, y: s.y + s.h, vy: 0, g: gd < 0 ? true : b.g };
};

/** Other players are one-way platforms: you can land on a head. */
const onHeads = (gd: 1 | -1, prevBottom: number) => (b: Body, o: Rect): Body =>
  gd > 0 && ov(b, o) && b.vy >= 0 && prevBottom <= o.y + 6 ? { ...b, y: o.y - b.h, vy: 0, g: true } : b;

export const stepPlayer = (i: Input, env: Env): S.State<Body, boolean> => b0 => {
  const { gdir: gd, dt } = env;
  const ax = (i.right ? 1 : 0) - (i.left ? 1 : 0);
  const jumped = i.jumpP && b0.g;
  const vy = clamp(-900, 900)((jumped ? -JUMP * gd : b0.vy) + GRAV * gd * dt);
  const moved: Body = { ...b0, vx: ax * SPEED, face: ax || b0.face, vy, x: b0.x + ax * SPEED * dt };
  const bx = pipe(env.solids, RA.reduce(moved, resolveX));
  const clamped = { ...bx, x: clamp(0, W - bx.w)(bx.x) };
  const prevBottom = clamped.y + clamped.h;
  const fallen: Body = { ...clamped, y: clamped.y + clamped.vy * dt, g: false };
  const landed = pipe(env.solids, RA.reduce(fallen, resolveY(gd, prevBottom)));
  return [jumped, pipe(env.others, RA.reduce(landed, onHeads(gd, prevBottom)))];
};
