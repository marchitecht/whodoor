// Geometry, world state and player physics shared by server and client.

export const W = 960, H = 540, FLOOR = 470;
export const SPEED = 250, JUMP = 560, GRAV = 1500, PS = 26;
/** IBM Plex Mono advance at 600 weight / 20px: 0.6em. Server has no canvas, so text widths use this. */
export const CHAR_W = 12;

export interface Rect { x: number; y: number; w: number; h: number }

export interface Solid extends Rect {
  oneway?: boolean;
  floor?: boolean;
  text?: string;
  color?: 'mute' | 'ink' | 'accent';
  active?: boolean;
  prevY?: number;
  seam?: boolean;
  tile?: boolean;
  st?: number; tt?: number; vy?: number;
}

export interface Door extends Rect { moving?: boolean; flip?: boolean; drawn?: boolean }

export interface PlayerState { ok?: boolean; lock?: number }

/** Everything the server sends about a level. Plain data only: it goes over the wire as JSON. */
export interface World {
  lvl: number;
  t: number;
  solids: Solid[];
  spikes: Rect[];
  door: Door | null;
  gdir: 1 | -1;
  spawn: [number, number];
  // level-specific state; `any` on purpose, each level owns its shape
  s: any;
  say: string;
  sayN: number;
  pl: Record<string, PlayerState>;
}

/** What the world needs to know about a player to run triggers. */
export interface PV extends Rect { id: string; face: number; g: boolean; alive: boolean }

export interface Input { left: boolean; right: boolean; jump: boolean; leftP: boolean; rightP: boolean; jumpP: boolean }
export const NONE: Input = { left: false, right: false, jump: false, leftP: false, rightP: false, jumpP: false };

export interface Body extends Rect { vx: number; vy: number; face: number; g: boolean }

export const box = (x: number, y: number, w: number, h: number, o: Partial<Solid> = {}): Solid => ({ x, y, w, h, ...o });
export const mkDoor = (x: number, y?: number): Door => ({ x, y: y ?? FLOOR - 52, w: 34, h: 52 });
export const spk = (x: number, w: number): Rect => ({ x, y: FLOOR - 22, w, h: 22 });
export const ov = (a: Rect, b: Rect, s = 0) => a.x + s < b.x + b.w && a.x + a.w - s > b.x && a.y + s < b.y + b.h && a.y + a.h - s > b.y;
export const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
export const textPlat = (text: string, x: number, y: number, color: Solid['color'] = 'ink'): Solid =>
  box(x, y, text.length * CHAR_W, 20, { oneway: true, text, color });

export function hitC(p: Rect, cx: number, cy: number, r: number) {
  const nx = Math.max(p.x, Math.min(cx, p.x + p.w)), ny = Math.max(p.y, Math.min(cy, p.y + p.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < (r - 4) ** 2;
}

export function say(w: World, text: string) { w.say = text; w.sayN++; }

export function newWorld(lvl: number): World {
  return {
    lvl, t: 0, solids: [box(0, FLOOR, W, H - FLOOR, { floor: true })], spikes: [], door: null,
    gdir: 1, spawn: [60, FLOOR - PS], s: {}, say: '', sayN: 0, pl: {},
  };
}

/* ---------- breakable floor tiles: st 0 solid, 1 shaking, 2 falling, 3 gone ---------- */
export function tileFloor(w: World, ts: number, seam: boolean) {
  w.solids = w.solids.filter(s => !s.floor);
  w.s.tiles = [] as Solid[];
  for (let x = 0; x < W; x += ts)
    w.s.tiles.push(box(x, FLOOR, Math.min(ts, W - x), H - FLOOR, { floor: true, tile: true, st: 0, tt: 0, vy: 0, seam }));
}
export function dropTile(t: Solid | undefined, delay = 0) { if (!t || t.st) return; t.st = 1; t.tt = delay; }
/** regrow: seconds a fallen tile stays gone before coming back (0 = never). */
export function tilesUpdate(w: World, dt: number, regrow = 0) {
  for (const t of w.s.tiles as Solid[]) {
    if (t.st === 1 && (t.tt! -= dt) <= 0) { t.st = 2; t.vy = 0; }
    else if (t.st === 2) { t.vy! += 1800 * dt; t.y += t.vy! * dt; if (t.y > H + 60) { t.st = 3; t.tt = regrow; } }
    else if (t.st === 3 && regrow && (t.tt! -= dt) <= 0) Object.assign(t, { st: 0, tt: 0, vy: 0, y: FLOOR });
  }
}
export function restoreTiles(w: World) { for (const t of w.s.tiles as Solid[]) Object.assign(t, { st: 0, tt: 0, vy: 0, y: FLOOR }); }

/** Static solids plus whatever the level keeps in its own state (tiles, lifts, credit lines, slabs, obstacles). */
export function allSolids(w: World): Solid[] {
  const a = w.solids.slice(), s = w.s;
  if (s.tiles) for (const t of s.tiles as Solid[]) if (t.st! < 2) a.push(t);
  if (s.lf) for (const l of s.lf as Solid[]) if (l.active !== false) a.push(l);
  if (s.lines) for (const l of s.lines as Solid[]) if (l.active) a.push(l);
  if (s.slabs) a.push(...(s.slabs as Solid[]));
  if (s.obst) a.push(...(s.obst as Solid[]));
  return a;
}

/** The solid a player stands on, if any (normal gravity only). */
export function standingOn(w: World, p: Rect): Solid | null {
  if (w.gdir < 0) return null;
  for (const s of allSolids(w)) if (Math.abs(p.y + p.h - s.y) < 2.5 && p.x + p.w > s.x && p.x < s.x + s.w) return s;
  return null;
}

/**
 * One physics step for one player. `others` are other players' boxes: you can stand on their heads.
 * Returns true if the player jumped this step.
 */
export function stepPlayer(b: Body, i: Input, w: World, others: Rect[], dt: number): boolean {
  const gd = w.gdir;
  const ax = (i.right ? 1 : 0) - (i.left ? 1 : 0);
  b.vx = ax * SPEED; if (ax) b.face = ax;
  let jumped = false;
  if (i.jumpP && b.g) { b.vy = -JUMP * gd; jumped = true; }
  b.vy = Math.max(-900, Math.min(900, b.vy + GRAV * gd * dt));
  const solids = allSolids(w);
  b.x += b.vx * dt;
  for (const s of solids) {
    if (s.oneway || !ov(b, s)) continue;
    if (b.vx > 0) b.x = s.x - b.w; else if (b.vx < 0) b.x = s.x + s.w;
  }
  b.x = Math.max(0, Math.min(W - b.w, b.x));
  const prevB = b.y + b.h;
  b.y += b.vy * dt; b.g = false;
  for (const s of solids) {
    if (!ov(b, s)) continue;
    if (s.oneway) {
      if (gd > 0 && b.vy >= 0 && prevB <= (s.prevY ?? s.y) + 6) { b.y = s.y - b.h; b.vy = 0; b.g = true; }
      continue;
    }
    if (b.vy > 0) { b.y = s.y - b.h; if (gd > 0) b.g = true; } else { b.y = s.y + s.h; if (gd < 0) b.g = true; }
    b.vy = 0;
  }
  if (gd > 0) for (const o of others) {
    if (ov(b, o) && b.vy >= 0 && prevB <= o.y + 6) { b.y = o.y - b.h; b.vy = 0; b.g = true; }
  }
  return jumped;
}
