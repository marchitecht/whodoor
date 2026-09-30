// Headless test clients: `pnpm bots [count] [url] [seconds]`.
// Each bot runs the same client loop as the browser (local physics + world between snapshots)
// with a dumb "hold right, jump a lot" brain, and logs who wins which level.
import WebSocket from 'ws';
import * as O from 'fp-ts/lib/Option.js';
import {
  LEVELS, PS, NONE, W, updateWorld, mapInput, checkPlayer, stepPlayer,
  type World, type Body, type PV, type S2C, type Input,
} from '@whodoor/shared';

const COUNT = Number(process.argv[2] ?? 4);
const URL = process.argv[3] ?? 'ws://localhost:8787/ws';
const SECONDS = Number(process.argv[4] ?? 120);
const ROOM = process.env.BOT_ROOM ?? 'BOTS';
const DT = 1 / 60;

const stats = { levels: new Map<string, string>(), deaths: 0, errors: 0, snaps: 0, teleports: new Set<string>() };

function bot(n: number) {
  const ws = new WebSocket(URL);
  let id = '', w: World | null = null, doorSent = -1, frame = 0, host = '', lvlFrames = 0;
  let b: Body = { x: 60, y: 444, w: PS, h: PS, vx: 0, vy: 0, face: 1, g: false };
  const others = new Map<string, PV>();
  let prev = { ...NONE };
  const send = (m: object) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const respawn = () => { if (!w) return; b = { ...b, x: w.spawn[0] + n * 6, y: w.spawn[1], vx: 0, vy: 0 }; };

  ws.on('open', () => send({ t: 'join', name: `Бот ${n + 1}`, room: ROOM }));
  ws.on('error', e => { stats.errors++; console.error('ws error', e.message); });
  ws.on('message', raw => {
    const m = JSON.parse(String(raw)) as S2C;
    if (m.t === 'hi') id = m.id;
    else if (m.t === 'lobby') {
      host = m.host;
      if (n === 0 && m.phase === 'lobby' && m.players.length === COUNT && host === id) send({ t: 'start' });
    }
    else if (m.t === 'lvl') {
      w = m.w; respawn(); doorSent = -1; lvlFrames = 0;
      const L = LEVELS[w.lvl];
      if (L.draw && n === 0) setTimeout(() => send({ t: 'draw', pts: [[150, 380], [150, 470], [190, 470], [190, 380], [150, 380]] }), 500);
      if (L.overlay === 'dialog') setTimeout(() => { send({ t: 'ans', i: n % 2 ? 0 : 3 }); setTimeout(() => send({ t: 'ans', i: 3 }), 2200); }, 800 + n * 200);
    }
    else if (m.t === 'snap') {
      stats.snaps++;
      w = m.w;
      for (const [pid, x, y, f, a] of m.ps) if (pid !== id) others.set(pid, { id: pid, x, y, w: PS, h: PS, face: f, g: true, alive: !!a });
    }
    else if (m.t === 'won') {
      const L = LEVELS[m.lvl];
      if (n === 0) console.log(`level ${(L.disp ?? "").padStart(3)} ${L.id.padEnd(10)} won by ${m.id === id ? 'bot 1' : m.id}`);
      if (n === 0) stats.levels.set(L.id, m.id);
    }
    else if (m.t === 'end') { if (n === 0) console.log('GAME END'); }
  });

  const timer = setInterval(() => {
    if (!w || !id) return;
    frame++; lvlFrames++;
    const ps: PV[] = [{ id, ...b, alive: true }, ...others.values()];
    w = updateWorld(DT, ps)(w);
    // brain: hold right; jump every ~0.6s with some per-bot phase; wait level: do nothing
    const L = LEVELS[w.lvl];
    const tx = w.door ? w.door.x + w.door.w / 2 : (w.c.last as { hole?: boolean } | undefined)?.hole ? 898 : W;
    const dx = tx - (b.x + b.w / 2);
    const raw: Input = { left: dx < -8, right: dx > 8, jump: (frame + n * 7) % 36 < 2, leftP: false, rightP: false, jumpP: false };
    const waiting = L.id === 'wait' && !(w.c.walker as { done?: boolean } | undefined)?.done;
    const inp: Input = waiting ? { ...NONE } : { ...raw, jumpP: raw.jump && !prev.jump, rightP: raw.right && !prev.right, leftP: raw.left && !prev.left };
    prev = inp;
    b = stepPlayer(mapInput(w, inp, id), w, [...others.values()].filter(o => o.alive), DT)(b)[1];
    // stuck for 20s: jump to the door so the rest of the flow still gets exercised
    if (lvlFrames > 60 * 20 && w.door && n === 0 && doorSent !== w.lvl) { stats.teleports.add(L.id); b = { ...b, x: w.door.x, y: w.door.y + w.door.h - b.h }; }
    const r = checkPlayer(w, b);
    if (O.isSome(r) && r.value.tag === 'die') { stats.deaths++; send({ t: 'die', m: r.value.msg }); respawn(); }
    else if (O.isSome(r) && doorSent !== w.lvl) { doorSent = w.lvl; send({ t: 'door', lvl: w.lvl }); }
    if (frame % 2 === 0) send({ t: 'st', x: b.x, y: b.y, f: b.face, g: b.g ? 1 : 0, a: 1 });
  }, 1000 / 60);

  return () => { clearInterval(timer); ws.close(); };
}

const stops = Array.from({ length: COUNT }, (_, n) => bot(n));
setTimeout(() => {
  stops.forEach(s => s());
  console.log(`\n${stats.levels.size}/${LEVELS.length} levels finished, ${stats.deaths} deaths, ${stats.snaps} snapshots, ${stats.errors} errors`);
  const missing = LEVELS.filter(l => !stats.levels.has(l.id)).map(l => l.id);
  if (missing.length) console.log('not finished:', missing.join(', '));
  if (stats.teleports.size) console.log('bot teleported on:', [...stats.teleports].join(', '));
  process.exit(0);
}, SECONDS * 1000);
