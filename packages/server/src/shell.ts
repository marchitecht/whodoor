// The imperative shell around the pure core: owns sockets and the clock, runs effects.
import type { WebSocket } from 'ws';
import { TICK_HZ, type C2S, type S2C } from '@whodoor/shared';
import { newRoom, step, type Cmd, type Effect, type Room } from './core.ts';

const DT = 1 / TICK_HZ;

export class RoomShell {
  private state: Room;
  private sockets = new Map<string, WebSocket>();
  private last = performance.now();
  private acc = 0;
  private timer: NodeJS.Timeout;

  constructor(code: string, private onClose: (code: string) => void) {
    this.state = newRoom(code);
    this.timer = setInterval(() => this.clock(), 1000 / TICK_HZ);
  }

  get code() { return this.state.code; }
  get size() { return this.state.players.length; }

  join(id: string, ws: WebSocket, name: string) { this.sockets.set(id, ws); this.dispatch({ t: 'join', id, name }); }
  leave(id: string) { this.sockets.delete(id); this.dispatch({ t: 'leave', id }); }
  message(id: string, m: C2S) { this.dispatch({ t: 'msg', id, m, now: performance.now() }); }

  private clock() {
    const now = performance.now();
    this.acc = Math.min(this.acc + (now - this.last) / 1000, DT * 5);
    this.last = now;
    while (this.acc >= DT) { this.acc -= DT; this.dispatch({ t: 'tick', now, dt: DT }); }
  }

  private dispatch(cmd: Cmd) {
    const [effects, next] = step(cmd)(this.state);
    this.state = next;
    for (const e of effects) this.run(e);
  }

  private run(e: Effect) {
    switch (e.t) {
      case 'to': this.send(this.sockets.get(e.id), e.m); break;
      case 'all': { const s = JSON.stringify(e.m); for (const ws of this.sockets.values()) if (ws.readyState === 1) ws.send(s); break; }
      case 'kick': { const ws = this.sockets.get(e.id); this.send(ws, { t: 'err', m: e.m }); ws?.close(); this.sockets.delete(e.id); break; }
      case 'close': clearInterval(this.timer); this.onClose(this.state.code); break;
    }
  }

  private send(ws: WebSocket | undefined, m: S2C) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }
}
