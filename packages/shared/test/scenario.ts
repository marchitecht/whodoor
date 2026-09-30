// Deterministic regression scenario: two scripted players on every level.
// The trace records only physical facts (bodies, door, solids, spikes, deaths/wins), not narrator text,
// so the implementation underneath can change as long as the game behaves the same.

export interface R { x: number; y: number; w: number; h: number }
export interface In { left: boolean; right: boolean; jump: boolean; leftP: boolean; rightP: boolean; jumpP: boolean }
export interface B extends R { vx: number; vy: number; face: number; g: boolean }
export interface P extends R { id: string; face: number; g: boolean; alive: boolean }

/** Everything the scenario needs from an implementation, in plain terms. */
export interface Api<W> {
  count: number;
  meta(i: number): { id: string; draw?: boolean; dialog?: boolean };
  init(i: number): W;
  step(w: W, dt: number, ps: P[]): W;
  mapInput(w: W, i: In, pid: string): In;
  move(b: B, i: In, w: W, others: R[], dt: number): B;
  check(w: W, b: R): 'die' | 'win' | null;
  door(w: W): R | null;
  solids(w: W): R[];
  spikes(w: W): R[];
  spawn(w: W): [number, number];
  waitDone(w: W): boolean;
  hole(w: W): boolean;
  draw(w: W, pts: [number, number][]): W;
  answer(w: W, pid: string, i: number): W;
  t(w: W): number;
}

const DT = 1 / 60, TICKS = 60 * 12, EVERY = 15;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rect = (r: R) => [r3(r.x), r3(r.y), r3(r.w), r3(r.h)];
const sorted = (rs: R[]) => rs.map(rect).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);

export function trace<W>(api: Api<W>) {
  const out: Record<string, unknown[]> = {};
  for (let li = 0; li < api.count; li++) {
    const m = api.meta(li);
    let w = api.init(li);
    const players = ['A', 'B'].map((id, slot) => {
      const [sx, sy] = api.spawn(w);
      return { id, slot, b: { x: sx + slot * 6, y: sy, w: 26, h: 26, vx: 0, vy: 0, face: 1, g: false } as B, prev: { left: false, right: false, jump: false } as { left: boolean; right: boolean; jump: boolean }, done: false, lastX: 0, stuck: 0 };
    });
    const rows: unknown[] = [];
    for (let f = 0; f < TICKS; f++) {
      const ps: P[] = players.map(p => ({ id: p.id, ...p.b, alive: !p.done }));
      w = api.step(w, DT, ps);
      if (m.draw && f === 60) w = api.draw(w, [[150, 410], [150, 470], [190, 470], [190, 410], [150, 410]]);
      if (m.dialog) {
        if (f === 60) w = api.answer(w, 'A', 0);
        if (f === 90) w = api.answer(w, 'B', 3);
        if (f === 200) w = api.answer(w, 'A', 3);
      }
      const events: string[] = [];
      for (const p of players) {
        if (p.done) continue;
        const b = p.b;
        const door = api.door(w);
        const tx = door ? door.x + door.w / 2 : api.hole(w) ? 898 : 960;
        const dx = tx - (b.x + b.w / 2);
        let raw = { left: dx < -8, right: dx > 8, jump: false };
        const moving = raw.left || raw.right;
        p.stuck = moving && Math.abs(b.x - p.lastX) < .3 ? p.stuck + 1 : 0;
        raw.jump = (f + p.slot * 17) % 40 < 2 || p.stuck > 5;
        if (p.id === 'B' && f < 30) raw = { left: false, right: false, jump: false };
        if (m.id === 'wait' && !api.waitDone(w)) raw = { left: false, right: false, jump: false };
        p.lastX = b.x;
        const inp: In = { ...raw, leftP: raw.left && !p.prev.left, rightP: raw.right && !p.prev.right, jumpP: raw.jump && !p.prev.jump };
        p.prev = raw;
        const others = players.filter(o => o !== p && !o.done).map(o => o.b);
        p.b = api.move(b, api.mapInput(w, inp, p.id), w, others, DT);
        const c = api.check(w, p.b);
        if (c === 'die') { const [sx, sy] = api.spawn(w); p.b = { ...p.b, x: sx + p.slot * 6, y: sy, vx: 0, vy: 0, g: false }; events.push(`${p.id}:die`); }
        else if (c === 'win') { p.done = true; events.push(`${p.id}:win`); }
      }
      if (events.length || f % EVERY === 0) {
        const d = api.door(w);
        rows.push([f, r3(api.t(w)), ...players.map(p => [...rect(p.b), p.done ? 1 : 0]), d ? rect(d) : null, sorted(api.solids(w)), sorted(api.spikes(w)), events]);
      }
    }
    out[`${li}:${m.id}`] = rows;
  }
  return out;
}

/** Compare two traces with a small float tolerance; returns human-readable differences. */
export function diff(a: unknown, b: unknown, path = '', out: string[] = [], limit = 20): string[] {
  if (out.length >= limit) return out;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 1e-3) out.push(`${path}: ${a} != ${b}`); return out; }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${path}: length ${a.length} != ${b.length}`); }
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as any)[k], (b as any)[k], `${path}.${k}`, out, limit);
    return out;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return out;
}
