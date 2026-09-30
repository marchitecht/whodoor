// The whole game in-process: the pure room core driven by commands, no sockets, no real time.
import * as O from 'fp-ts/lib/Option.js';
import { LEVELS, TICK_HZ } from '@whodoor/shared';
import { newRoom, step, type Cmd, type Effect, type Room } from '../src/core.ts';

let room: Room = newRoom('TEST');
const log: Effect[] = [];
const run = (cmd: Cmd) => { const [es, r] = step(cmd)(room); room = r; log.push(...es); return es; };
const dt = 1 / TICK_HZ;
let now = 0;

run({ t: 'join', id: 'host', name: 'Марат' });
for (let i = 0; i < 4; i++) run({ t: 'msg', id: 'host', m: { t: 'bot', add: true }, now });
console.log('players:', room.players.map(p => p.name).join(', '));

// junk and forged messages never change anything they shouldn't
const before = JSON.stringify(room);
run({ t: 'msg', id: 'bot1', m: { t: 'start' }, now });            // bots are not host
run({ t: 'msg', id: 'nobody', m: { t: 'start' }, now });          // unknown player
console.log('non-host start ignored:', JSON.stringify(room) === before);

run({ t: 'msg', id: 'host', m: { t: 'start' }, now });
const wins = new Map<string, string>();
const startedAt = new Map<number, number>();
const LIMIT = 60 * 60 * TICK_HZ; // one simulated hour
let ticks = 0;
while (room.phase !== 'end' && ticks < LIMIT) {
  now += dt * 1000; ticks++;
  // keep the idle host parked and alive, as a real client would report
  const es = run({ t: 'tick', now, dt });
  for (const e of es) {
    if (e.t === 'all' && e.m.t === 'won') wins.set(LEVELS[e.m.lvl].id, room.players.find(p => p.id === e.m.id)?.name ?? '?');
    if (e.t === 'all' && e.m.t === 'lvl') startedAt.set(e.m.w.lvl, ticks);
  }
  // a stuck level: skip it the way a host would, by pretending someone reached the door
  const lvl = O.isSome(room.w) ? room.w.value.lvl : -1;
  if (room.phase === 'play' && ticks - (startedAt.get(lvl) ?? ticks) > 90 * TICK_HZ) {
    wins.set(LEVELS[lvl].id + ' (зависли, пропуск)', 'host');
    run({ t: 'msg', id: 'host', m: { t: 'door', lvl }, now });
  }
}
console.log(`\nsimulated ${(ticks / TICK_HZ / 60).toFixed(1)} min in-process, phase: ${room.phase}`);
for (const [id, who] of wins) console.log(`  ${id.padEnd(28)} ${who}`);
const snaps = log.filter(e => e.t === 'all' && e.m.t === 'snap').length;
console.log(`effects: ${log.length}, snapshots: ${snaps}`);
console.log('scores:', room.players.map(p => `${p.name} ${p.score} (падений ${p.deaths})`).join(', '));
process.exit(room.phase === 'end' ? 0 : 1);
