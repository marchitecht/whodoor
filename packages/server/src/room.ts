import type { WebSocket } from 'ws';
import {
  LEVELS, initLevel, updateWorld, nextLevel, byId, say, PS as PSIZE,
  TICK_HZ, SNAP_EVERY, WIN_PAUSE_MS, COLORS, MAX_PLAYERS,
  type World, type PV, type C2S, type S2C, type LobbyPlayer, type Phase, type PSnap,
} from '@whodoor/shared';

interface Player {
  id: string; name: string; color: string; ws: WebSocket;
  score: number; deaths: number;
  x: number; y: number; face: number; g: boolean; alive: boolean;
  lastPoke: number;
}

const DT = 1 / TICK_HZ;
const rid = () => Math.random().toString(36).slice(2, 10);
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);

export class Room {
  players = new Map<string, Player>();
  host = '';
  phase: Phase = 'lobby';
  w: World | null = null;
  private tick = 0;
  private wonAt = 0;
  private last = performance.now();
  private acc = 0;
  private timer: NodeJS.Timeout;

  constructor(public code: string, private onEmpty: (code: string) => void) {
    this.timer = setInterval(() => this.loop(), 1000 / TICK_HZ);
  }

  add(ws: WebSocket, rawName: unknown): Player | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map(p => p.color));
    const name = (typeof rawName === 'string' ? rawName : '').replace(/\s+/g, ' ').trim().slice(0, 16) || `Игрок ${this.players.size + 1}`;
    const [sx, sy] = this.w?.spawn ?? [60, 444];
    const p: Player = {
      id: rid(), name, color: COLORS.find(c => !used.has(c))!, ws, score: 0, deaths: 0,
      x: sx, y: sy, face: 1, g: false, alive: true, lastPoke: 0,
    };
    this.players.set(p.id, p);
    if (!this.host) this.host = p.id;
    this.send(p, { t: 'hi', id: p.id, room: this.code });
    this.lobby();
    if (this.w) this.send(p, { t: 'lvl', w: this.w });
    return p;
  }

  remove(id: string) {
    this.players.delete(id);
    if (!this.players.size) { clearInterval(this.timer); this.onEmpty(this.code); return; }
    if (this.host === id) this.host = this.players.keys().next().value!;
    this.lobby();
  }

  handle(p: Player, m: C2S) {
    const w = this.w;
    switch (m.t) {
      case 'start': if (p.id === this.host && this.phase === 'lobby') this.start(); break;
      case 'restart': if (p.id === this.host && this.phase === 'end') this.start(); break;
      case 'st': {
        const x = num(m.x, -100, 1100), y = num(m.y, -300, 900), f = num(m.f, -1, 1);
        if (x === null || y === null) return;
        p.x = x; p.y = y; p.face = f && f < 0 ? -1 : 1; p.g = !!m.g; p.alive = !!m.a;
        break;
      }
      case 'die': {
        p.deaths++;
        this.bcast({ t: 'fx', k: 'die', id: p.id, m: String(m.m ?? '').slice(0, 60) });
        break;
      }
      case 'door': {
        if (this.phase !== 'play' || !w || m.lvl !== w.lvl) return;
        p.score++; this.phase = 'won'; this.wonAt = performance.now();
        this.bcast({ t: 'won', id: p.id, lvl: w.lvl });
        this.lobby();
        break;
      }
      case 'poke': {
        const L = w && LEVELS[w.lvl]; const now = performance.now();
        if (this.phase === 'play' && L?.poke && now - p.lastPoke > 300) { p.lastPoke = now; L.poke(w!, p.name); }
        break;
      }
      case 'skip': {
        const L = w && LEVELS[w.lvl];
        if (this.phase !== 'play' || !L?.skipTo) return;
        const to = byId(L.skipTo); this.load(to);
        say(this.w!, to === byId('cardboard') ? `${p.name} хотел пропустить? Держите уровень посложнее.` : `Ладно, ${p.name}, вернёмся к нормальному.`);
        break;
      }
      case 'draw': { const L = w && LEVELS[w.lvl]; if (this.phase === 'play' && L?.drawDoor) L.drawDoor(w!, m.pts); break; }
      case 'ans': {
        const L = w && LEVELS[w.lvl];
        if (this.phase !== 'play' || !L?.answer) return;
        const r = L.answer(w!, p.id, Number(m.i));
        if (r) this.bcast({ t: 'fx', k: 'bub', id: p.id, m: r });
        break;
      }
    }
  }

  private start() {
    for (const p of this.players.values()) { p.score = 0; p.deaths = 0; }
    this.load(0);
  }

  private load(idx: number) {
    this.w = initLevel(idx);
    this.phase = 'play';
    const [sx, sy] = this.w.spawn;
    for (const p of this.players.values()) Object.assign(p, { x: sx, y: sy, alive: true, g: false });
    this.bcast({ t: 'lvl', w: this.w });
    this.lobby();
  }

  private loop() {
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - this.last) / 1000, DT * 5);
    this.last = now;
    while (this.acc >= DT) { this.acc -= DT; this.step(now); }
  }

  private step(now: number) {
    const w = this.w; if (!w) return;
    if (this.phase === 'play') {
      const ps: PV[] = [...this.players.values()].map(p => ({ id: p.id, x: p.x, y: p.y, w: PSIZE, h: PSIZE, face: p.face, g: p.g, alive: p.alive }));
      updateWorld(w, DT, ps);
    } else if (this.phase === 'won' && now - this.wonAt > WIN_PAUSE_MS) {
      if (w.lvl >= LEVELS.length - 1) { this.phase = 'end'; this.bcast({ t: 'end' }); this.lobby(); }
      else this.load(nextLevel(w.lvl));
      return;
    }
    if (++this.tick % SNAP_EVERY === 0 && this.phase !== 'end') {
      const ps: PSnap[] = [...this.players.values()].map(p => [p.id, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, p.face, p.alive ? 1 : 0]);
      this.bcast({ t: 'snap', w, ps });
    }
  }

  private lobby() {
    const players: LobbyPlayer[] = [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, score: p.score, deaths: p.deaths }));
    this.bcast({ t: 'lobby', code: this.code, host: this.host, phase: this.phase, players });
  }

  private send(p: Player, m: S2C) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(m)); }
  private bcast(m: S2C) {
    const s = JSON.stringify(m);
    for (const p of this.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }
}
