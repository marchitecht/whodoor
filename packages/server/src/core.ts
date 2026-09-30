// The room as a pure state machine. A command becomes a State<Room, Effects>: the new room plus
// what should be sent. Steps compose with `seq` (a monoid: run in order, concatenate effects).
import { pipe } from 'fp-ts/lib/function.js';
import * as O from 'fp-ts/lib/Option.js';
import * as RA from 'fp-ts/lib/ReadonlyArray.js';
import type * as S from 'fp-ts/lib/State.js';
import {
  LEVELS, initLevel, updateWorld, nextLevel, byId, say, poke, answer, drawDoor, PS,
  SNAP_EVERY, WIN_PAUSE_MS, COLORS, MAX_PLAYERS,
  type World, type PV, type C2S, type S2C, type LobbyPlayer, type Phase, type PSnap, type Endo,
} from '@whodoor/shared';
import * as Bot from './brain.ts';

export interface Player {
  readonly id: string; readonly name: string; readonly color: string;
  readonly bot: O.Option<Bot.Brain>;
  readonly score: number; readonly deaths: number;
  readonly x: number; readonly y: number; readonly face: number; readonly g: boolean; readonly alive: boolean;
  readonly lastPoke: number;
}
export interface Room {
  readonly code: string;
  readonly players: ReadonlyArray<Player>;
  readonly host: string;
  readonly phase: Phase;
  readonly w: O.Option<World>;
  readonly tick: number;
  readonly wonAt: number;
  /** bot ids and seeds come from here, so the core never touches Math.random */
  readonly seq: number;
}
export type Cmd =
  | { readonly t: 'join'; readonly id: string; readonly name: string }
  | { readonly t: 'leave'; readonly id: string }
  | { readonly t: 'msg'; readonly id: string; readonly m: C2S; readonly now: number }
  | { readonly t: 'tick'; readonly now: number; readonly dt: number };
export type Effect =
  | { readonly t: 'to'; readonly id: string; readonly m: S2C }
  | { readonly t: 'all'; readonly m: S2C }
  | { readonly t: 'kick'; readonly id: string; readonly m: string }
  | { readonly t: 'close' };
export type Step = S.State<Room, ReadonlyArray<Effect>>;

export const newRoom = (code: string): Room => ({ code, players: [], host: '', phase: 'lobby', w: O.none, tick: 0, wonAt: 0, seq: 1 });

/* ---------- the step algebra ---------- */
const nothing: Step = r => [[], r];
export const seq = (...steps: ReadonlyArray<Step>): Step => r0 =>
  steps.reduce<[ReadonlyArray<Effect>, Room]>(([es, r], st) => { const [e2, r2] = st(r); return [[...es, ...e2], r2]; }, [[], r0]);
const modify = (f: Endo<Room>): Step => r => [[], f(r)];
const emit = (f: (r: Room) => ReadonlyArray<Effect>): Step => r => [f(r), r];
const when = (c: (r: Room) => boolean, st: Step): Step => r => (c(r) ? st(r) : nothing(r));
/** Decide the next step from the current room. */
const choose = (f: (r: Room) => Step): Step => r => f(r)(r);

/* ---------- lenses we need on the room, as plain helpers ---------- */
const humans = (r: Room) => r.players.filter(p => O.isNone(p.bot));
const player = (id: string) => (r: Room) => RA.findFirst<Player>(p => p.id === id)(r.players);
const updatePlayer = (id: string, f: Endo<Player>): Endo<Room> => r => ({ ...r, players: r.players.map(p => (p.id === id ? f(p) : p)) });
const updateWorld_ = (f: Endo<World>): Endo<Room> => r => ({ ...r, w: O.map(f)(r.w) });
const isHost = (id: string) => (r: Room) => r.host === id;
const inPhase = (...ps: Phase[]) => (r: Room) => ps.includes(r.phase);

/* ---------- messages ---------- */
const lobbyMsg = (r: Room): S2C => ({
  t: 'lobby', code: r.code, host: r.host, phase: r.phase,
  players: r.players.map((p): LobbyPlayer => ({ id: p.id, name: p.name, color: p.color, score: p.score, deaths: p.deaths, bot: O.isSome(p.bot) })),
});
const lobby: Step = emit(r => [{ t: 'all', m: lobbyMsg(r) }]);
const snapshot: Step = emit(r => pipe(r.w, O.match(() => [], w => [{
  t: 'all', m: { t: 'snap', w, ps: r.players.map((p): PSnap => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.face, p.alive ? 1 : 0]) },
}])));

/* ---------- membership ---------- */
const freeColor = (r: Room) => COLORS.find(c => !r.players.some(p => p.color === c))!;
const spawnPoint = (r: Room) => pipe(r.w, O.match(() => [60, 444] as const, w => w.spawn));
const mkPlayer = (r: Room, id: string, name: string, bot: O.Option<Bot.Brain>): Player => {
  const [x, y] = spawnPoint(r);
  return { id, name, color: freeColor(r), bot, score: 0, deaths: 0, x, y, face: 1, g: false, alive: true, lastPoke: 0 };
};
const cleanName = (raw: string, n: number) => raw.replace(/\s+/g, ' ').trim().slice(0, 16) || `Игрок ${n}`;

const join = (id: string, rawName: string): Step => choose(r => r.players.length >= MAX_PLAYERS
  ? emit(() => [{ t: 'kick', id, m: 'Комната заполнена (максимум 8).' }])
  : seq(
    modify(r2 => ({ ...r2, players: [...r2.players, mkPlayer(r2, id, cleanName(rawName, r2.players.length + 1), O.none)], host: r2.host || id })),
    emit(r2 => [{ t: 'to', id, m: { t: 'hi', id, room: r2.code } }]),
    lobby,
    emit(r2 => pipe(r2.w, O.match(() => [], w => [{ t: 'to', id, m: { t: 'lvl', w } }]))),
  ));

const leave = (id: string): Step => seq(
  modify(r => ({ ...r, players: r.players.filter(p => p.id !== id) })),
  choose(r => humans(r).length === 0
    ? emit(() => [{ t: 'close' }])
    : seq(modify(r2 => (r2.host === id ? { ...r2, host: humans(r2)[0].id } : r2)), lobby)),
);

const BOT_NAMES = ['Вася', 'Зина', 'Гоша', 'Люся', 'Толя', 'Нюра', 'Петя', 'Света'];
const addBot: Step = when(r => r.players.length < MAX_PLAYERS, seq(
  modify(r => {
    const name = `Бот ${BOT_NAMES.find(n => !r.players.some(p => p.name === `Бот ${n}`)) ?? r.players.length}`;
    const slot = r.players.length;
    const brain = pipe(Bot.newBrain(Math.imul(r.seq, 2654435761) >>> 0), b => pipe(r.w, O.match(() => b, w => Bot.onLevel(w, slot)(b))));
    return { ...r, seq: r.seq + 1, players: [...r.players, mkPlayer(r, `bot${r.seq}`, name, O.some(brain))] };
  }),
  lobby,
));
const removeBot: Step = choose(r => pipe(r.players.filter(p => O.isSome(p.bot)), RA.last, O.match(
  () => nothing,
  last => seq(modify(r2 => ({ ...r2, players: r2.players.filter(p => p.id !== last.id) })), lobby),
)));

/* ---------- game flow ---------- */
const load = (idx: number): Step => seq(
  modify(r => {
    const w = initLevel(idx), [sx, sy] = w.spawn;
    return {
      ...r, w: O.some(w), phase: 'play',
      players: r.players.map((p, slot) => ({ ...p, x: sx, y: sy, alive: true, g: false, bot: O.map(Bot.onLevel(w, slot))(p.bot) })),
    };
  }),
  emit(r => pipe(r.w, O.match(() => [], w => [{ t: 'all', m: { t: 'lvl', w } }]))),
  lobby,
);
const start: Step = seq(modify(r => ({ ...r, players: r.players.map(p => ({ ...p, score: 0, deaths: 0 })) })), load(0));

const win = (id: string, now: number): Step => when(inPhase('play'), choose(r => pipe(r.w, O.match(() => nothing, w => seq(
  modify(r2 => ({ ...updatePlayer(id, p => ({ ...p, score: p.score + 1 }))(r2), phase: 'won', wonAt: now })),
  emit(() => [{ t: 'all', m: { t: 'won', id, lvl: w.lvl } }]),
  lobby,
)))));

const die = (id: string, msg: string): Step => seq(
  modify(updatePlayer(id, p => ({ ...p, deaths: p.deaths + 1 }))),
  emit(() => [{ t: 'all', m: { t: 'fx', k: 'die', id, m: msg.slice(0, 60) } }]),
);

const reply = (id: string, i: number): Step => when(inPhase('play'), r => pipe(r.w, O.match(() => nothing(r), w => {
  const [line, w2] = answer(id, i)(w);
  return [pipe(line, O.match(() => [], m => [{ t: 'all', m: { t: 'fx', k: 'bub', id, m } } as Effect])), { ...r, w: O.some(w2) }];
})));

const clampPos = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const onMsg = (id: string, m: C2S, now: number): Step => choose(r => pipe(player(id)(r), O.match(() => nothing, p => {
  const L = pipe(r.w, O.map(w => LEVELS[w.lvl]));
  switch (m.t) {
    case 'join': return nothing;
    case 'start': return when(r2 => isHost(id)(r2) && inPhase('lobby')(r2), start);
    case 'restart': return when(r2 => isHost(id)(r2) && inPhase('end')(r2), start);
    case 'bot': return when(r2 => isHost(id)(r2) && inPhase('lobby', 'end')(r2), m.add ? addBot : removeBot);
    case 'st': return modify(updatePlayer(id, q => ({
      ...q, x: clampPos(m.x, -100, 1100), y: clampPos(m.y, -300, 900), face: m.f < 0 ? -1 : 1, g: !!m.g, alive: !!m.a,
    })));
    case 'die': return die(id, m.m);
    case 'door': return pipe(r.w, O.match(() => nothing, w => (m.lvl === w.lvl ? win(id, now) : nothing)));
    case 'poke': return when(r2 => inPhase('play')(r2) && now - p.lastPoke > 300,
      modify(r2 => updateWorld_(poke(p.name))(updatePlayer(id, q => ({ ...q, lastPoke: now }))(r2))));
    case 'skip': return pipe(L, O.chain(l => O.fromNullable(l.skipTo)), O.match(() => nothing, to => when(inPhase('play'), seq(
      load(byId(to)),
      modify(updateWorld_(say(to === 'cardboard' ? `${p.name} хотел пропустить? Держите уровень посложнее.` : `Ладно, ${p.name}, вернёмся к нормальному.`))),
    ))));
    case 'draw': return when(inPhase('play'), modify(updateWorld_(drawDoor(m.pts))));
    case 'ans': return reply(id, m.i);
  }
})));

/** Bots think on the server tick against the authoritative world. */
const runBots = (now: number, dt: number): Step => r0 => pipe(r0.players, RA.reduceWithIndex<Player, [ReadonlyArray<Effect>, Room]>([[], r0], (slot, [es, r], p0) => {
  if (O.isNone(p0.bot) || r.phase !== 'play' || O.isNone(r.w)) return [es, r];
  const w = r.w.value;
  const others = r.players.filter(o => o.id !== p0.id && o.alive).map(o => ({ x: o.x, y: o.y, w: PS, h: PS }));
  const [act, br] = Bot.tick(w, p0.id, others, dt)(p0.bot.value);
  const brain = act.die ? Bot.respawn(w, slot)(br) : br;
  const [e2, r2] = seq(
    act.ans !== undefined ? reply(p0.id, act.ans) : nothing,
    act.draw ? modify(updateWorld_(drawDoor(act.draw))) : nothing,
    act.die ? die(p0.id, act.die) : nothing,
    modify(updatePlayer(p0.id, p => ({ ...p, bot: O.some(brain), x: brain.b.x, y: brain.b.y, face: brain.b.face, g: brain.b.g, alive: true }))),
    act.win ? win(p0.id, now) : nothing,
  )(r);
  return [[...es, ...e2], r2];
}));

const onTick = (now: number, dt: number): Step => when(r => O.isSome(r.w), choose(r => {
  const w = (r.w as O.Some<World>).value;
  if (r.phase === 'play') {
    const ps: PV[] = r.players.map(p => ({ id: p.id, x: p.x, y: p.y, w: PS, h: PS, face: p.face, g: p.g, alive: p.alive }));
    return seq(modify(updateWorld_(updateWorld(dt, ps))), runBots(now, dt), snapshotEvery);
  }
  if (r.phase === 'won' && now - r.wonAt > WIN_PAUSE_MS)
    return w.lvl >= LEVELS.length - 1
      ? seq(modify(r2 => ({ ...r2, phase: 'end' })), emit(() => [{ t: 'all', m: { t: 'end' } }]), lobby)
      : load(nextLevel(w.lvl));
  return snapshotEvery;
}));
const snapshotEvery: Step = seq(modify(r => ({ ...r, tick: r.tick + 1 })), when(r => r.tick % SNAP_EVERY === 0 && r.phase !== 'end', snapshot));

export const step = (cmd: Cmd): Step => {
  switch (cmd.t) {
    case 'join': return join(cmd.id, cmd.name);
    case 'leave': return leave(cmd.id);
    case 'msg': return onMsg(cmd.id, cmd.m, cmd.now);
    case 'tick': return onTick(cmd.now, cmd.dt);
  }
};
