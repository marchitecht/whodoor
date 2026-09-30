import { W, H, FLOOR, LEVELS, TOTAL, allSolids, type World, type Solid, type Door, type Rect } from '@whodoor/shared';

export const COL = { paper: '#E8E9EE', ink: '#15161B', mute: '#8B8E9E', accent: '#3148FF', faint: '#CFD1DA', white: '#FFFFFF' };
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace', DISP = '"Rubik Mono One", "Arial Black", sans-serif';
export const TXT = '600 20px ' + MONO;

export interface Avatar extends Rect { id: string; face: number; color: string; name: string; me: boolean; tired: boolean; alive: boolean }
export interface View {
  w: World; T: number;
  avatars: Avatar[];
  bubbles: { id: string; text: string }[];
  narr: string;
  scores: { color: string; score: number; me: boolean }[];
  flash: number;
  stroke: { x: number; y: number }[] | null;
}

export function setupCanvas(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')!;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawSaw(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, n = 12) {
  c.save(); c.translate(x, y); c.rotate(rot); c.fillStyle = COL.ink; c.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * Math.PI * 2, rr = i % 2 ? r : r - 9; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  c.closePath(); c.fill(); c.fillStyle = COL.paper; c.beginPath(); c.arc(0, 0, 5, 0, 7); c.fill(); c.restore();
}
function teeth(c: CanvasRenderingContext2D, x0: number, w: number, h: (i: number) => number) {
  for (let i = 0; i < Math.floor(w / 22); i++) { const x = x0 + i * 22; c.beginPath(); c.moveTo(x, FLOOR); c.lineTo(x + 11, FLOOR - h(i)); c.lineTo(x + 22, FLOOR); c.fill(); }
}
function bubbleAt(c: CanvasRenderingContext2D, t: string, cx: number, anchorY: number, up = true) {
  c.font = '600 16px ' + MONO;
  const bw = c.measureText(t).width + 24, bh = 34;
  const bx = Math.max(8, Math.min(W - bw - 8, cx - bw / 2)), by = up ? anchorY - bh - 16 : anchorY + 16;
  c.fillStyle = COL.white; c.strokeStyle = COL.ink; c.lineWidth = 2; c.beginPath(); c.rect(bx, by, bw, bh); c.fill(); c.stroke();
  const ty = up ? by + bh : by;
  c.beginPath(); c.moveTo(cx - 7, ty); c.lineTo(cx, ty + (up ? 10 : -10)); c.lineTo(cx + 7, ty); c.fill(); c.stroke();
  c.fillStyle = COL.white; c.fillRect(cx - 6, ty - (up ? 2 : 0), 12, 2);
  c.fillStyle = COL.ink; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(t, bx + 12, by + bh / 2 + 1);
}
function drawDoor(c: CanvasRenderingContext2D, d: Door, T: number) {
  if (d.drawn) return;
  const lift = d.moving ? 5 : 0, x = d.x, y = d.y - lift * (d.flip ? -1 : 1), w = d.w, h = d.h;
  c.fillStyle = COL.accent; c.fillRect(x, y, w, h);
  c.fillStyle = COL.ink; c.fillRect(x - 4, d.flip ? y + h : y - 4, w + 8, 4);
  c.fillStyle = COL.paper; c.beginPath(); c.arc(x + w - 8, y + h / 2, 3, 0, 7); c.fill();
  if (d.moving) {
    const ph = Math.sin(T * 22) * 4, by = d.flip ? y : y + h, dy = d.flip ? -lift : lift;
    c.strokeStyle = COL.ink; c.lineWidth = 3; c.beginPath();
    c.moveTo(x + 9, by); c.lineTo(x + 9 + ph, by + dy); c.moveTo(x + w - 9, by); c.lineTo(x + w - 9 - ph, by + dy); c.stroke();
  }
}

/* per-level extras, drawn behind solids (back) or above the floor (top) */
const back: Record<string, (c: CanvasRenderingContext2D, w: World, T: number) => void> = {
  saw(c, w) { const s = w.s; drawSaw(c, s.a.x, FLOOR, 32, s.rot); if (s.b.on) drawSaw(c, s.b.x, FLOOR, 32, s.go ? -s.rot * 1.6 : s.rot * .15); },
  ice(c, w) {
    c.fillStyle = COL.ink;
    for (const q of [...w.s.ic, w.s.last]) {
      if (q.st === 3) continue; const j = q.st === 1 ? (Math.random() - .5) * 4 : 0;
      c.beginPath(); c.moveTo(q.x + j, q.y); c.lineTo(q.x + 22 + j, q.y); c.lineTo(q.x + 11 + j, q.y + 34); c.fill();
    }
  },
  pend(c, w, T) {
    c.strokeStyle = COL.ink; c.lineWidth = 3;
    for (const q of w.s.pd) { if (q.bx == null) continue; c.beginPath(); c.moveTo(q.x, 64); c.lineTo(q.bx, q.by); c.stroke(); drawSaw(c, q.bx, q.by, 28, T * 3, 10); }
  },
  slabs(c, w) {
    const s = w.s; c.fillStyle = COL.ink; c.fillRect(0, 44, W, s.cy - 24);
    if (s.crush) for (let x = 0; x < W; x += 22) { c.beginPath(); c.moveTo(x, s.cy + 20); c.lineTo(x + 11, s.cy + 36); c.lineTo(x + 22, s.cy + 20); c.fill(); }
    for (const q of s.pl) { if (q.st === 3) continue; const j = q.st === 1 ? (Math.random() - .5) * 4 : 0; c.fillRect(q.x + j, q.y, 80, 20); }
  },
  wait(c, w) {
    if (w.s.done) return;
    c.save(); c.globalAlpha = .1; c.fillStyle = COL.ink; c.font = '180px ' + DISP; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(Math.max(0, Math.ceil(10 - w.s.wait))), W / 2, 250); c.restore();
  },
  rhythm(c, w) {
    const s = w.s;
    if (s.pulse > 0) { c.fillStyle = COL.accent; c.globalAlpha = s.pulse * .6; c.fillRect(0, 0, W, FLOOR); c.globalAlpha = 1; }
    for (const q of s.st) { c.fillStyle = q.warn ? COL.accent : COL.ink; teeth(c, q.x, q.w, () => q.hh); }
  },
  ball(c, w) { const b = w.s.b; if (b.st !== 'in' && b.st !== 'wait') drawSaw(c, b.x, b.y, 34, b.rot, 14); },
  lifts(c, w) {
    if (w.s.back) return;
    c.strokeStyle = COL.ink; c.lineWidth = 2; c.beginPath(); c.moveTo(545, 64); c.lineTo(545, 330); c.stroke();
    c.fillStyle = COL.white; c.fillRect(490, 330, 110, 44); c.strokeRect(490, 330, 110, 44);
    c.fillStyle = COL.ink; c.font = '600 13px ' + MONO; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('УШЁЛ', 545, 345); c.fillText('НА ОБЕД', 545, 361); c.textAlign = 'left';
  },
};
const top: Record<string, (c: CanvasRenderingContext2D, w: World, T: number) => void> = {
  saw(c, w) { if (w.s.b.on && !w.s.go) bubbleAt(c, 'Проходите, я подожду.', w.s.b.x, FLOOR - 40); },
  ice(c, w, T) {
    if (!w.s.hole) return;
    c.fillStyle = COL.accent; c.font = '28px ' + DISP; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('↓', 898, 440 + Math.sin(T * 6) * 4); c.textAlign = 'left';
  },
  draw(c, w) {
    c.save(); c.strokeStyle = COL.accent; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const st of w.s.strokes as [number, number][][]) { c.beginPath(); st.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); }
    const d = w.door;
    if (d) { c.globalAlpha = .14; c.fillStyle = COL.accent; c.fillRect(d.x, d.y, d.w, d.h); c.globalAlpha = 1; c.beginPath(); c.arc(d.x + d.w - 8, d.y + d.h / 2, 4, 0, 7); c.fill(); }
    c.restore();
  },
  ball(c, w) { if (w.s.b.st === 'in') bubbleAt(c, 'Занято!', 897, FLOOR - 60); },
};

function drawAvatar(c: CanvasRenderingContext2D, a: Avatar, gdir: number, T: number) {
  c.globalAlpha = a.me ? 1 : .88;
  c.fillStyle = a.color; c.fillRect(a.x, a.y, a.w, a.h);
  if (a.me) { c.strokeStyle = COL.ink; c.lineWidth = 2; c.strokeRect(a.x + 1, a.y + 1, a.w - 2, a.h - 2); }
  const blink = ((T + a.x * .01) % 3.3) < .12, eh = blink ? 1 : a.tired ? 3 : 7;
  const ex = a.x + (a.face > 0 ? 11 : 4), ey = gdir > 0 ? a.y + (a.tired ? 10 : 7) : a.y + a.h - 7 - eh;
  c.fillStyle = COL.white; c.fillRect(ex, ey, 4, eh); c.fillRect(ex + 7, ey, 4, eh);
  c.globalAlpha = 1;
  c.font = (a.me ? '600 ' : '') + '12px ' + MONO; c.textAlign = 'center'; c.textBaseline = gdir > 0 ? 'bottom' : 'top';
  c.fillStyle = a.me ? COL.ink : COL.mute;
  c.fillText(a.me ? a.name + ' · ты' : a.name, a.x + a.w / 2, gdir > 0 ? a.y - 4 : a.y + a.h + 4);
  c.textAlign = 'left';
}

export function draw(c: CanvasRenderingContext2D, v: View) {
  const { w, T } = v, L = LEVELS[w.lvl];
  c.fillStyle = COL.paper; c.fillRect(0, 0, W, H);
  c.fillStyle = COL.faint; for (let x = 24; x < W; x += 48) for (let y = 24; y < FLOOR; y += 48) c.fillRect(x - 1, y - 1, 2, 2);
  back[L.id]?.(c, w, T);
  const solids = allSolids(w);
  for (const s of solids) {
    if (s.floor) continue;
    if (s.text) { c.font = TXT; c.fillStyle = s.color === 'mute' ? COL.mute : s.color === 'accent' ? COL.accent : COL.ink; c.textBaseline = 'top'; c.textAlign = 'left'; c.fillText(s.text, s.x, s.y); }
    else { c.fillStyle = COL.ink; c.fillRect(s.x, s.y, s.w, s.h); }
  }
  c.fillStyle = COL.ink;
  const flat: number[] = L.cardboard ? w.s.flat ?? [] : [];
  for (const sp of w.spikes) teeth(c, sp.x, sp.w, i => flat.includes(i) ? 5 : 22);
  if (w.door) drawDoor(c, w.door, T);
  // floor: static segments and tiles; shaking tiles jitter, falling ones keep falling
  c.fillStyle = COL.ink;
  for (const s of solids) if (s.floor) { const j = s.st === 1 ? (Math.random() - .5) * 4 : 0; c.fillRect(s.x + j, s.y + (s.st === 1 ? Math.random() * 3 : 0), s.w, s.h); }
  if (w.s.tiles) for (const t of w.s.tiles as Solid[]) if (t.st === 2) c.fillRect(t.x, t.y, t.w, t.h);
  c.fillStyle = COL.paper; for (const s of solids) if (s.seam && s.x > 0) c.fillRect(s.x - 1, s.y, 2, 9);
  top[L.id]?.(c, w, T);
  if (v.stroke) {
    c.save(); c.strokeStyle = COL.accent; c.globalAlpha = .6; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath();
    v.stroke.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.stroke(); c.restore();
  }
  for (const a of v.avatars) if (!a.me && a.alive) drawAvatar(c, a, w.gdir, T);
  for (const a of v.avatars) if (a.me) drawAvatar(c, a, w.gdir, T);

  // narrator, printed on the floor
  c.textBaseline = 'middle'; c.textAlign = 'left'; c.font = '600 18px ' + MONO;
  c.fillStyle = COL.accent; c.fillText('›', 26, 505); c.fillStyle = COL.paper; c.fillText(v.narr, 46, 505);

  // HUD: level on the left, scores on the right
  c.font = '13px ' + DISP; c.fillStyle = COL.mute; c.textBaseline = 'alphabetic';
  c.fillText(`УРОВЕНЬ ${L.disp} / ${TOTAL}`, 24, 32);
  let x = W - 24; c.textAlign = 'right';
  for (const s of [...v.scores].reverse()) {
    c.font = '14px ' + DISP; c.fillStyle = COL.ink; c.fillText(String(s.score), x, 33);
    const tw = c.measureText(String(s.score)).width;
    c.fillStyle = s.color; c.fillRect(x - tw - 18, 20, 13, 13);
    if (s.me) { c.strokeStyle = COL.ink; c.lineWidth = 2; c.strokeRect(x - tw - 18, 20, 13, 13); }
    x -= tw + 32;
  }
  c.textAlign = 'left';

  for (const b of v.bubbles) {
    const a = v.avatars.find(q => q.id === b.id); if (!a || !a.alive) continue;
    const up = w.gdir > 0; bubbleAt(c, b.text, a.x + a.w / 2, up ? a.y - 14 : a.y + a.h + 14, up);
  }
  if (v.flash > 0) { c.fillStyle = `rgba(229,50,45,${v.flash * 1.2})`; c.fillRect(0, 0, W, H); }
}
