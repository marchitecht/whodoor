import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebSocket } from 'ws';
import * as E from 'fp-ts/lib/Either.js';
import { decode } from './codec.ts';
import { RoomShell } from './shell.ts';

const PORT = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
const STATIC = process.env.STATIC_DIR ?? resolve(here, '../../client/dist');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map<string, RoomShell>();
const rid = () => Math.random().toString(36).slice(2, 10);
const cleanCode = (v: unknown) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) : '');
function newCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    if (!rooms.has(c)) return c;
  }
}
function getRoom(code: string) {
  let r = rooms.get(code);
  if (!r) { r = new RoomShell(code, c => rooms.delete(c)); rooms.set(code, r); }
  return r;
}

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
if (existsSync(STATIC)) await app.register(fastifyStatic, { root: STATIC });
else app.log.warn(`static dir ${STATIC} not found, serving API only`);

app.get('/health', async () => ({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.size, 0) }));

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
    const id = rid();
    let room: RoomShell | null = null;
    let budget = 0, window = Date.now();
    socket.on('message', raw => {
      const now = Date.now();
      if (now - window > 1000) { window = now; budget = 0; }
      if (++budget > 150) return; // ~5x what a client needs
      const m = decode(String(raw));
      if (E.isLeft(m)) return;
      const msg = m.right;
      if (!room) {
        if (msg.t !== 'join') return;
        room = getRoom(cleanCode(msg.room) || newCode());
        room.join(id, socket, msg.name);
        return;
      }
      room.message(id, msg);
    });
    socket.on('close', () => room?.leave(id));
  });
});

await app.listen({ port: PORT, host: '0.0.0.0' });
