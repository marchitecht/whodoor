// The public, pure API the server and client use. World in, world out.
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import type * as S from 'fp-ts/lib/State.js';
import { H, ov, newWorld, type World, type PV, type Rect, type Solid, type Input, type Body } from './world.ts';
import { say, type Endo, type Pts } from './behavior.ts';
import { deathLine } from './components.ts';
import { stepPlayer as physics } from './physics.ts';
import { LEVELS, DEATH, type Level } from './levels.ts';

export const levelOf = (w: World): Level => LEVELS[w.lvl];

export const initLevel = (idx: number): World =>
  pipe(newWorld(idx), LEVELS[idx].b.init, say(LEVELS[idx].say));

export const updateWorld = (dt: number, ps: ReadonlyArray<PV>): Endo<World> => w =>
  levelOf(w).b.update({ dt, ps })({ ...w, t: w.t + dt });

export const solidsOf = (w: World): ReadonlyArray<Solid> => RA.concat(levelOf(w).b.solids(w))(w.solids);

export const mapInput = (w: World, i: Input, pid: string): Input => levelOf(w).b.input(pid, w)(i);

export const stepPlayer = (i: Input, w: World, others: ReadonlyArray<Rect>, dt: number): S.State<Body, boolean> =>
  physics(i, { solids: solidsOf(w), others, gdir: w.gdir, dt });

export const poke = (name: string): Endo<World> => w => levelOf(w).b.poke(name)(w);
export const answer = (pid: string, i: number): S.State<World, O.Option<string>> => w => levelOf(w).b.answer(pid, i)(w);
export const drawDoor = (pts: Pts): Endo<World> => w => levelOf(w).b.drawDoor(pts)(w);
export const canEnter = (w: World) => levelOf(w).b.canEnter(w);

export type Outcome = { readonly tag: 'die'; readonly msg: string } | { readonly tag: 'win' };
const died = (msg: string): O.Option<Outcome> => O.some({ tag: 'die', msg });
const won: O.Option<Outcome> = O.some({ tag: 'win' });

/** What happens to a box this tick: death by spikes or a hazard, falling out, or reaching the exit. First match wins. */
export const checkPlayer = (w: World, p: Rect): O.Option<Outcome> => {
  const L = levelOf(w);
  return pipe(
    L.harmlessSpikes || !w.spikes.some(sp => ov(p, sp, 3)) ? O.none : died(deathLine(DEATH, w)),
    O.alt(() => pipe(L.b.hits(p)(w), O.chain(died))),
    O.alt(() => p.y > H + 40 ? (L.b.onFall(w) ? won : died(L.fallSay ?? 'Упал.')) : O.none),
    O.alt(() => p.y + p.h < -20 ? died(L.fallSay ?? 'Унесло.') : O.none),
    O.alt(() => w.door && ov(p, w.door, 4) && L.b.canEnter(w) ? won : O.none),
  );
};
