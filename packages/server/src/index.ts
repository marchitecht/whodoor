import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import type { C2S } from '@whodoor/shared';
import { Room } from './room.ts';

const PORT = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
const STATIC = process.env.STATIC_DIR ?? resolve(here, '../../client/dist');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map<string, Room>();
const cleanCode = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '');
function newCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (!rooms.has(c)) return c;
  }
}
function getRoom(code: string) {
  let r = rooms.get(code);
  if (!r) { r = new Room(code, c => rooms.delete(c)); rooms.set(code, r); }
  return r;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
if (existsSync(STATIC)) await app.register(fastifyStatic, { root: STATIC });
else app.log.warn(`static dir ${STATIC} not found, serving API only`);

app.get('/health', async () => ({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) }));

const alive = new WeakMap<WebSocket, boolean>();
setInterval(() => {
  for (const ws of app.websocketServer.clients) {
    if (alive.get(ws) === false) { ws.terminate(); continue; }
    alive.set(ws, false); ws.ping();
  }
}, 20_000);

app.register(async f => {
  f.get('/ws', { websocket: true }, (socket: WebSocket) => {
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    let room: Room | null = null;
    let player: ReturnType<Room['add']> = null;
    let budget = 0, window = Date.now();
    socket.on('message', raw => {
      const now = Date.now();
      if (now - window > 1000) { window = now; budget = 0; }
      if (++budget > 150) return; // ~5x what a client needs
      let m: C2S;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!player) {
        if (m.t !== 'join') return;
        room = getRoom(cleanCode(m.room) || newCode());
        player = room.add(socket, m.name);
        if (!player) { socket.send(JSON.stringify({ t: 'err', m: 'Комната заполнена (максимум 8).' })); socket.close(); if (!room.players.size) rooms.delete(room.code); }
        return;
      }
      room!.handle(player, m);
    });
    socket.on('close', () => { if (room && player) room.remove(player.id); });
  });
});

await app.listen({ port: PORT, host: '0.0.0.0' });
