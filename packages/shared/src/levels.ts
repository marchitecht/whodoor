// All levels. Each level owns w.s (plain JSON state), runs on the server every tick,
// and also on clients between snapshots so motion stays smooth.
import {
  W, H, FLOOR, PS, SPEED, CHAR_W, NONE,
  box, mkDoor, spk, ov, pick, hitC, say, textPlat, newWorld,
  tileFloor, dropTile, tilesUpdate, restoreTiles, standingOn,
  type World, type PV, type Rect, type Input, type Solid,
} from './world.ts';

export interface Level {
  id: string;
  /** set for bonus levels; shown as "<previous number><label>" */
  label?: string;
  say: string;
  gdir?: 1 | -1;
  spawn?: [number, number];
  skip?: string; skipTo?: string; next?: string;
  fallSay?: string;
  cardboard?: boolean;
  overlay?: 'ad' | 'dialog';
  draw?: boolean;
  disp?: string;
  init(w: World): void;
  update?(w: World, dt: number, ps: PV[]): void;
  /** returns a death line if this box dies to a level hazard */
  hits?(w: World, p: Rect): string | null;
  map?(w: World, i: Input, pid: string): Input;
  canEnter?(w: World): boolean;
  /** true if falling off the bottom counts as reaching the exit */
  onFall?(w: World): boolean;
  poke?(w: World, name: string): void;
  answer?(w: World, pid: string, i: number): string | null;
  drawDoor?(w: World, pts: [number, number][]): void;
}

export const DEATH = ['Бывает.', 'Шипы острые. Кто бы мог подумать.', 'Это было больно даже смотреть.', 'Квадрат в порядке. Почти.'];
export const TIRED_OPTS: [string, string | null][] = [
  ['Иди, я сказал!', 'Не кричи на меня.'],
  ['Там за дверью печеньки.', 'Печеньки — ложь. Как и торт.'],
  ['Ну пожалуйста?', 'Вежливо. Но нет.'],
  ['Ты уже столько прошёл. Ты крут.', null],
];
export const CREDITS = ['НАД ИГРОЙ РАБОТАЛИ', 'Квадраты — в главных ролях', 'Дверь — играла саму себя', 'Стеснительность двери — дублёр',
  'Шипы — картонные каскадёры', 'Пила — вежливая, но нет', 'Шар — без очереди', 'Лифт — на обеде', 'Пол — ненадёжный',
  'Крестик рекламы — лёгкая атлетика', 'Гравитация — вверх ногами', 'Вы — невероятное терпение', 'Спасибо, что дошли', 'ИГРАТЬ СНОВА'];

const alive = (ps: PV[]) => ps.filter(p => p.alive);
const cx = (p: Rect) => p.x + p.w / 2;

function openHole(w: World, x0: number, x1: number) {
  w.solids = w.solids.filter(s => !s.floor);
  w.solids.push(box(0, FLOOR, x0, H - FLOOR, { floor: true }), box(x1, FLOOR, W - x1, H - FLOOR, { floor: true }));
}
function calcPend(w: World) {
  const t = w.t, c = w.s.c;
  for (const q of w.s.pd) {
    const a = c ? .7 * Math.sin(2.1 * t + q.ph) + .45 * Math.sin(3.7 * t + q.ph * 2) : .95 * Math.sin(2.1 * t + q.ph);
    q.bx = q.x + Math.sin(a) * 380; q.by = 64 + Math.cos(a) * 380;
  }
}
function resetSlabs(w: World) {
  w.s.slabs = []; w.s.cy = 44; w.s.crush = false;
  w.s.pl = [170, 320, 470, 620].map(x => ({ x, y: 64, vy: 0, st: 0, tt: 0 }));
  w.door = mkDoor(880);
}
function moveLifts(w: World, dt: number) {
  const s = w.s, t = w.t;
  for (const l of s.lf) {
    l.prevY = l.y;
    let y = 360 + 60 * Math.sin(1.6 * t + l.ph);
    if (l.lunch) { if (!s.back) y = -60; else { l.k = Math.min(1, l.k + dt * .6); y = -60 + (y + 60) * l.k; } }
    l.y = y; l.active = !(l.lunch && !s.back);
  }
}
function resetCollapse(w: World) {
  tileFloor(w, 40, true);
  w.s.obst = [box(520, 420, 40, 50)];
  w.spikes = [spk(300, 66), spk(700, 66)];
  w.door = mkDoor(880);
  Object.assign(w.s, { cx: -40, st: 0, clock: 0, pt: 0, rt: 0 });
}
function syncCredits(w: World) {
  const L = w.s.lines[w.s.lines.length - 1];
  w.door!.x = L.x + L.w - 40; w.door!.y = L.y - 52;
}

export const LEVELS: Level[] = [
  { id: 'basic', say: 'Дойди до двери первым. Всё. Это вся игра.',
    init(w) { w.solids.push(box(380, 420, 80, 50), box(560, 380, 80, 90)); w.door = mkDoor(860); } },

  { id: 'shy', say: 'Эта дверь немного стеснительная.',
    init(w) { w.door = mkDoor(820); },
    update(w, dt, ps) {
      const d = w.door!, a = alive(ps); d.moving = false; if (!a.length) return;
      const dc = cx(d), p = a.reduce((m, q) => Math.abs(cx(q) - dc) < Math.abs(cx(m) - dc) ? q : m);
      const dir = Math.sign(dc - cx(p)) || 1, dist = Math.abs(dc - cx(p));
      if (p.face === dir) { if (dist < 280) { d.x += dir * SPEED * 1.3 * dt; d.moving = true; } }
      else { d.x -= dir * SPEED * .75 * dt; d.moving = true; }
      if (d.x > W - d.w) { d.x = 4; if (!w.s.w) { w.s.w = 1; say(w, 'Она обежала уровень по кругу. Теперь подкрадывается сзади.'); } }
      if (d.x < 0) d.x = W - d.w - 4;
      if (w.t > 8 && !w.s.h && !w.s.w) { w.s.h = 1; say(w, 'Может, не смотреть на неё так пристально?'); }
    } },

  { id: 'saw', say: 'Тут пилы. Просто перепрыгивай.',
    init(w) { w.door = mkDoor(880); Object.assign(w.s, { a: { x: 200, v: 230 }, b: { x: 790, v: 0, on: true }, go: 0, rot: 0 }); },
    update(w, dt, ps) {
      const s = w.s, a = s.a, b = s.b; s.rot += dt * 9;
      a.x += a.v * dt; if (a.x > 540) { a.x = 540; a.v = -230; } if (a.x < 180) { a.x = 180; a.v = 230; }
      if (b.on) {
        if (!s.go && alive(ps).some(p => p.x > 590)) { s.go = 1; b.v = -430; say(w, 'Шучу.'); }
        b.x += b.v * dt; if (b.x < -60) { b.on = false; say(w, 'Ну и ладно. Проходите.'); }
      }
    },
    hits(w, p) { const s = w.s; return hitC(p, s.a.x, FLOOR, 32) || (s.b.on && hitC(p, s.b.x, FLOOR, 32)) ? pick(['Распилило.', 'Пила быстрее.', 'Надо было прыгать.']) : null; } },

  { id: 'crumble', say: 'Пол старый. Не стой на месте.',
    init(w) { tileFloor(w, 60, true); w.door = mkDoor(880); w.s.phase = 0; },
    update(w, dt, ps) {
      const s = w.s;
      if (w.t > 1) for (const p of alive(ps)) { if (!p.g) continue; const t = standingOn(w, p); if (t?.tile && !t.st) dropTile(t, .35); }
      if (s.phase === 0 && alive(ps).some(p => p.x > 740)) { s.phase = 1; s.dfall = true; s.dvy = 0; dropTile(s.tiles[14]); dropTile(s.tiles[15]); say(w, 'Ой.'); }
      if (s.dfall) {
        s.dvy += 1800 * dt; w.door!.y += s.dvy * dt;
        if (w.door!.y > H + 60) { s.dfall = false; s.phase = 2; restoreTiles(w); w.door = mkDoor(14); w.spawn = [900, FLOOR - PS]; say(w, 'Дверь упала. Ничего, запасная есть — в начале уровня.'); }
      }
      tilesUpdate(w, dt, 3);
    },
    canEnter(w) { return !w.s.dfall; } },

  { id: 'text', say: 'Дверь высоко. Тут поможет только чтение.',
    init(w) { w.solids.push(textPlat('Нажми ПРОБЕЛ, чтобы прыгнуть', 110, 385, 'mute'), textPlat('Эта надпись — не платформа', 400, 300, 'mute'), box(740, 215, 220, 16, { oneway: true })); w.door = mkDoor(890, 215 - 52); },
    update(w, dt, ps) {
      if (w.s.a) return;
      for (const p of alive(ps)) if (standingOn(w, p)?.text?.startsWith('Эта')) { w.s.a = 1; say(w, 'Ладно. Платформа. Я соврал.'); break; }
    } },

  { id: 'invert', say: 'Всё как обычно.',
    init(w) { w.solids.push(box(450, 410, 70, 60)); w.door = mkDoor(860); },
    update(w) {
      const t = w.t, s = w.s;
      if (t > 1.5 && !s.a) { s.a = 1; say(w, 'Ой. Управление перепутано.'); }
      if (t > 4.5 && !s.b) { s.b = 1; say(w, 'Сейчас починю…'); }
      if (t > 7 && !s.c) { s.c = 1; say(w, 'Починил! Вроде бы.'); }
      if (t > 15 && !s.d) { s.d = 1; say(w, 'Шпаргалка: ← прыжок, → влево, пробел вправо. Не благодарите.'); }
    },
    map(w, i) {
      if (w.t < 1.5) return i;
      if (w.t < 7) return { left: i.right, right: i.left, jump: i.jump, leftP: i.rightP, rightP: i.leftP, jumpP: i.jumpP };
      return { left: i.right, right: i.jump, jump: i.left, leftP: i.rightP, rightP: i.jumpP, jumpP: i.leftP };
    } },

  { id: 'ice', say: 'Потолок немного протекает.',
    init(w) { w.solids.push(box(0, 44, W, 20)); w.door = mkDoor(880); w.s.ic = [200, 330, 460, 590].map(x => ({ x, y: 64, vy: 0, st: 0, tt: 0 })); w.s.last = { x: 886, y: 64, vy: 0, st: 0, tt: 0 }; },
    update(w, dt, ps) {
      const s = w.s, a = alive(ps);
      for (const c of s.ic) {
        if (c.st === 0 && a.some(p => Math.abs(c.x + 11 - cx(p)) < 90)) { c.st = 1; c.tt = .15; }
        else if (c.st === 1 && (c.tt -= dt) <= 0) { c.st = 2; c.vy = 0; }
        else if (c.st === 2) { c.vy += 1800 * dt; c.y += c.vy * dt; if (c.y + 34 >= FLOOR) { c.st = 3; c.tt = 2.5; } }
        else if (c.st === 3 && (c.tt -= dt) <= 0) Object.assign(c, { st: 0, y: 64, vy: 0 });
      }
      const L = s.last;
      if (L.st === 0 && a.some(p => cx(p) > 600)) { L.st = 1; L.tt = .3; say(w, '…'); }
      else if (L.st === 1 && (L.tt -= dt) <= 0) { L.st = 2; L.vy = 300; }
      else if (L.st === 2) {
        L.vy += 1800 * dt; L.y += L.vy * dt;
        if (w.door && L.y + 34 >= w.door.y) { w.door = null; L.st = 3; s.hole = true; openHole(w, 860, 936); say(w, 'Упс. Двери нет. Зато есть дыра.'); }
      }
    },
    hits(w, p) {
      for (const c of [...w.s.ic, w.s.last]) if (c.st === 2 && ov(p, { x: c.x + 4, y: c.y, w: 14, h: 34 })) return pick(['Сосулька.', 'Смотри наверх.', 'Прямо в темечко.']);
      return null;
    },
    onFall(w) { return !!w.s.hole; } },

  { id: 'pits', say: 'Ровный пол. Совершенно обычный.', fallSay: 'Кто же знал.',
    init(w) { tileFloor(w, 60, false); w.door = mkDoor(880); w.s.traps = [{ t: [5], at: 300 }, { t: [9, 10], at: 488 }, { t: [13], at: 792 }]; },
    update(w, dt, ps) {
      for (const tr of w.s.traps) if (!tr.on && alive(ps).some(p => cx(p) > tr.at)) {
        tr.on = 1; tr.t.forEach((k: number) => dropTile(w.s.tiles[k])); say(w, pick(['Кто же знал.', 'Упс.', 'Совершенно обычный пол, говорю же.']));
      }
      tilesUpdate(w, dt, 0);
    } },

  { id: 'draw', draw: true, say: 'Дверь забыли нарисовать. Нарисуйте её сами — мышкой или пальцем.',
    init(w) { w.door = null; w.s.strokes = []; w.solids.push(box(300, 400, 60, 70)); },
    drawDoor(w, pts) {
      if (!Array.isArray(pts) || pts.length < 2) return;
      const P = pts.slice(0, 120).map(([x, y]) => [Math.max(0, Math.min(W, +x || 0)), Math.max(0, Math.min(H, +y || 0))] as [number, number]);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const bw = x1 - x0, bh = y1 - y0;
      if (bw < 22 || bh < 36) { say(w, 'Маловата. Туда никто не пролезет.'); return; }
      w.s.strokes = [P]; w.door = { x: x0, y: y0, w: bw, h: bh, drawn: true };
      say(w, bh > 220 ? 'Ого. Парадный вход.' : bw > 200 ? 'Это не дверь, это ворота. Но ладно.' : 'Отличная дверь. Почти как настоящая.');
    } },

  { id: 'pend', say: 'Маятники. Поймай ритм и проходи.',
    init(w) { w.solids.push(box(0, 44, W, 20)); w.door = mkDoor(880); w.s.pd = [{ x: 340, ph: 0 }, { x: 620, ph: 1.7 }]; calcPend(w); },
    update(w) { if (w.t > 7 && !w.s.c) { w.s.c = 1; say(w, 'Маятники укачало. Ритма больше нет.'); } calcPend(w); },
    hits(w, p) { for (const q of w.s.pd) if (hitC(p, q.bx, q.by, 28)) return pick(['Бум.', 'Маятник не виноват.', 'Качнуло.']); return null; } },

  { id: 'slabs', say: 'Потолок держится на честном слове.',
    init(w) { resetSlabs(w); },
    update(w, dt, ps) {
      const s = w.s, a = alive(ps);
      if (!s.crush && a.some(p => p.x > 560)) { s.crush = true; say(w, 'Обвал! Бегите!'); }
      if (s.crush) { s.cy += 150 * dt; if (s.cy > FLOOR - 60) { resetSlabs(w); say(w, 'Потолок подняли обратно. Ещё раз.'); return; } }
      for (const q of s.pl) {
        if (q.st === 0 && a.some(p => Math.abs(q.x + 40 - cx(p)) < 75)) { q.st = 1; q.tt = .25; }
        if (q.st === 1 && (q.tt -= dt) <= 0) { q.st = 2; q.vy = 0; }
        if (q.st < 2) q.y = s.cy + 20;
        if (q.st === 2) { q.vy += 1800 * dt; q.y += q.vy * dt; if (q.y + 20 >= FLOOR) { q.y = FLOOR - 20; q.st = 3; s.slabs.push(box(q.x, q.y, 80, 20)); } }
      }
    },
    hits(w, p) {
      const s = w.s;
      for (const q of s.pl) if (q.st === 2 && ov(p, { x: q.x, y: q.y, w: 80, h: 20 })) return pick(['Придавило.', 'Плита победила.', 'Смотри наверх.']);
      return s.crush && p.y < s.cy + 36 ? 'Потолок победил.' : null;
    } },

  { id: 'wait', say: 'Отдохните. Никто ничего не нажимает 10 секунд.',
    init(w) { w.door = mkDoor(860); Object.assign(w.s, { wait: 0, done: false, n: 0 }); },
    update(w, dt) {
      const s = w.s; if (s.done) return;
      s.wait += dt; const k = Math.min(1, s.wait / 10);
      w.door!.x = 860 + (480 - 860) * k; w.door!.moving = k < 1;
      if (k >= 1) { s.done = true; w.door!.moving = false; say(w, 'Спасибо, что не трогали. А теперь — бегом!'); }
    },
    poke(w, name) {
      const s = w.s; if (s.done) return;
      s.wait = 0; w.door!.x = 860;
      const l = ['я же просил.', 'ну вот, опять.', 'ничего. Не. Нажимай.', 'тебе правда так сложно?', 'руки. От. Клавиатуры.', 'дыши. Просто дыши.'];
      say(w, `${name}, ${l[s.n++ % l.length]}`);
    },
    map(w, i) { return w.s.done ? i : NONE; },
    canEnter(w) { return w.s.done; } },

  { id: 'gravity', say: 'Кто-то перевернул гравитацию. Дверь на потолке.', gdir: -1, spawn: [60, 116], fallSay: 'Упал вверх. Такое тоже бывает.',
    init(w) { w.solids.push(box(0, 90, 400, 26), box(490, 90, 470, 26), box(250, 116, 40, 34)); w.door = { x: 860, y: 116, w: 34, h: 52, flip: true }; } },

  { id: 'spikes', say: 'Обычный уровень с шипами. Если что, есть кнопка «пропустить».', skip: 'Пропустить уровень →', skipTo: 'cardboard', next: 'rhythm',
    init(w) { w.spikes.push(spk(260, 88), spk(470, 110), spk(700, 88)); w.door = mkDoor(880); } },

  { id: 'cardboard', label: '½', cardboard: true, say: 'Кто-то хотел пропустить? Держите уровень посложнее.', skip: 'Пропустить ещё раз →', skipTo: 'spikes',
    init(w) { w.spikes.push(spk(130, 726)); w.s.flat = []; w.door = mkDoor(880); },
    update(w, dt, ps) {
      for (const p of alive(ps)) for (const sp of w.spikes) {
        if (!ov(p, sp, 3)) continue;
        const a = Math.floor((p.x - sp.x) / 22), b = Math.floor((p.x + p.w - sp.x) / 22);
        for (let i = a; i <= b; i++) if (!w.s.flat.includes(i)) w.s.flat.push(i);
        if (!w.s.told) { w.s.told = 1; say(w, '…это картон. Шипы картонные. Идите уже.'); }
      }
    } },

  { id: 'rhythm', say: 'Шипы под ритм. Раз — два. Раз — два.',
    init(w) { w.solids.push(box(90, 360, 750, 50)); w.door = mkDoor(880); Object.assign(w.s, { st: [0, 1, 2, 3, 4].map(i => ({ x: 110 + i * 150, w: 110, i, hh: 3 })), beat: 0, bt: 0, bl: .8, pulse: 0 }); },
    update(w, dt, ps) {
      const s = w.s;
      if (!s.drop && alive(ps).some(p => p.x > 560)) { s.drop = 1; s.bl = .6; say(w, 'ДРОП!'); }
      s.bt += dt; if (s.bt >= s.bl) { s.bt -= s.bl; s.beat++; if (s.drop) s.pulse = .14; }
      if (s.pulse > 0) s.pulse -= dt;
      for (const q of s.st) { const up = (s.beat + q.i) % 2 === 0; q.warn = !up && s.bt > s.bl * .55; q.hh += ((up ? 22 : 3) - q.hh) * Math.min(1, dt * 30); }
    },
    hits(w, p) { for (const q of w.s.st) if (q.hh > 12 && ov(p, { x: q.x, y: FLOOR - q.hh, w: q.w, h: q.hh }, 3)) return pick(['Сбился с ритма.', 'Мимо такта.', 'Не в долю.']); return null; } },

  { id: 'tired', overlay: 'dialog', say: 'Ваши квадраты устали. Уговорите своего.',
    init(w) { w.door = mkDoor(860); w.solids.push(box(420, 420, 60, 50)); },
    map(w, i, pid) { return w.pl[pid]?.ok ? i : NONE; },
    answer(w, pid, i) {
      const st = (w.pl[pid] ??= {});
      if (st.ok || (st.lock ?? 0) > w.t) return null;
      const o = TIRED_OPTS[i]; if (!o) return null;
      if (o[1]) { st.lock = w.t + 2; return o[1]; }
      st.ok = true; return '…правда? Ну да. Я крут.';
    } },

  { id: 'ball', say: 'Бегите.',
    init(w) { w.door = mkDoor(880); w.solids.push(box(300, 430, 40, 40), box(520, 410, 40, 60)); w.spikes.push(spk(640, 66)); w.s.b = { x: -80, y: FLOOR - 34, st: 'wait', t: 0, rot: 0 }; },
    update(w, dt, ps) {
      const b = w.s.b; b.rot += dt * (b.st === 'out' ? -7 : 7);
      if (b.st === 'wait') { if ((b.t += dt) > .9) { b.st = 'chase'; b.x = -80; b.y = FLOOR - 34; } }
      else if (b.st === 'chase') { b.x += 200 * dt; if (alive(ps).some(p => p.x > 740) || b.x > 720) { b.st = 'hop'; b.t = 0; b.x0 = b.x; } }
      else if (b.st === 'hop') {
        b.t += dt; const k = Math.min(1, b.t / .8);
        b.x = b.x0 + (897 - b.x0) * k; b.y = FLOOR - 34 - Math.sin(k * Math.PI) * 170;
        if (k >= 1) { b.st = 'in'; b.t = 0; b.y = FLOOR - 34; w.spawn = [700, FLOOR - PS]; say(w, 'Шар зашёл первым. Занято. Чекпоинт у двери.'); }
      }
      else if (b.st === 'in') { if ((b.t += dt) > 2.2) { b.st = 'out'; b.x = 897; say(w, 'Выходит! Прыгайте.'); } }
      else if (b.st === 'out') { b.x -= 330 * dt; if (b.x < -80) { b.st = 'wait'; b.t = -1.5; say(w, 'Свободно. Пока что.'); } }
    },
    hits(w, p) { const b = w.s.b; return (b.st === 'chase' || b.st === 'out') && hitC(p, b.x, b.y, 34) ? pick(['Шар победил.', 'Раздавило.', 'Надо было быстрее.']) : null; },
    canEnter(w) { const st = w.s.b.st; return st !== 'hop' && st !== 'in'; } },

  { id: 'ad', overlay: 'ad', say: 'Реклама. Простите, надо же как-то зарабатывать.',
    init(w) { w.door = mkDoor(600); } },

  { id: 'lifts', say: 'Лифты над шипами. Один ушёл на обед.',
    init(w) {
      w.door = mkDoor(890); w.spikes.push(spk(140, 704)); w.s.back = false;
      w.s.lf = [{ x: 160, ph: 0 }, { x: 330, ph: 1.3 }, { x: 500, ph: 2.6, lunch: true }, { x: 670, ph: 3.9 }]
        .map(o => ({ ...box(o.x, 380, 90, 14, { oneway: true }), ph: o.ph, lunch: !!o.lunch, k: 0 }));
      moveLifts(w, 0);
    },
    update(w, dt) { if (w.t > 7 && !w.s.back) { w.s.back = true; say(w, 'Вернулся с обеда. Сытый, медленный.'); } moveLifts(w, dt); } },

  { id: 'collapse', say: 'Пол рушится. Прямо за вами.',
    init(w) { resetCollapse(w); },
    update(w, dt) {
      const s = w.s; s.clock += dt;
      if (s.st === 0 && s.clock > 1.2) s.st = 1;
      else if (s.st === 1) { s.cx += 170 * dt; if (s.cx >= 440) { s.st = 2; s.pt = 1.6; say(w, 'Передохните.'); } }
      else if (s.st === 2) { if ((s.pt -= dt) <= 0) { s.st = 3; say(w, 'Шучу. БЕГИТЕ.'); } }
      else if (s.st === 3) { s.cx += 320 * dt; if (s.cx > W + 40) { s.st = 4; s.rt = 1.5; } }
      else if (s.st === 4 && (s.rt -= dt) <= 0) { resetCollapse(w); say(w, 'Пол починили. Ещё раз.'); return; }
      for (const t of s.tiles as Solid[]) if (!t.st && t.x + t.w <= s.cx) dropTile(t, .08);
      w.spikes = w.spikes.filter(sp => sp.x + sp.w > s.cx);
      s.obst = s.obst.filter((o: Solid) => o.x + o.w > s.cx);
      if (w.door && s.cx > w.door.x) { w.door = null; say(w, 'Опоздали.'); }
      tilesUpdate(w, dt, 0);
    } },

  { id: 'credits', say: 'Титры. По ним можно ходить.', fallSay: 'Унесло титрами. Прыгай на строчки пониже.',
    init(w) {
      w.s.lines = CREDITS.map((t, i) => {
        const last = i === CREDITS.length - 1, tw = t.length * CHAR_W;
        return box(i % 2 ? 470 : 90, FLOOR + 20 + i * 100, last ? tw + 80 : tw, 20, { oneway: true, text: t, color: last ? 'accent' : 'ink', active: false });
      });
      w.door = mkDoor(0, 0); syncCredits(w);
    },
    update(w, dt) {
      const ls: Solid[] = w.s.lines;
      for (const l of ls) { l.prevY = l.y; l.y -= 55 * dt; l.active = l.y < FLOOR - 2; }
      if (ls[ls.length - 1].y < -80) { const d = FLOOR + 20 - ls[0].y; for (const l of ls) { l.y += d; l.prevY = l.y; } say(w, 'Ещё круг титров. Специально для вас.'); }
      syncCredits(w);
    },
    canEnter(w) { return !!w.s.lines[w.s.lines.length - 1].active; } },
];

let n = 0;
for (const L of LEVELS) L.disp = L.label ? n + L.label : String(++n);
export const TOTAL = n;
export const byId = (id: string) => LEVELS.findIndex(l => l.id === id);
export const nextLevel = (i: number) => { const L = LEVELS[i]; return L.next ? byId(L.next) : i + 1; };

export function initLevel(idx: number): World {
  const L = LEVELS[idx], w = newWorld(idx);
  if (L.gdir) w.gdir = L.gdir;
  if (L.spawn) w.spawn = [...L.spawn];
  L.init(w); say(w, L.say);
  return w;
}

export function updateWorld(w: World, dt: number, ps: PV[]) { w.t += dt; LEVELS[w.lvl].update?.(w, dt, ps); }

export function mapInput(w: World, i: Input, pid: string): Input { const L = LEVELS[w.lvl]; return L.map ? L.map(w, i, pid) : i; }

/** Client-side check for its own player: what you see is what kills you. */
export function checkPlayer(w: World, p: Rect): { die?: string; win?: boolean } | null {
  const L = LEVELS[w.lvl];
  if (!L.cardboard) for (const sp of w.spikes) if (ov(p, sp, 3)) return { die: pick(DEATH) };
  const h = L.hits?.(w, p); if (h) return { die: h };
  if (p.y > H + 40) return L.onFall?.(w) ? { win: true } : { die: L.fallSay || pick(['Упал.', 'Пол кончился.']) };
  if (p.y + p.h < -20) return { die: L.fallSay || 'Унесло.' };
  if (w.door && ov(p, w.door, 4) && (!L.canEnter || L.canEnter(w))) return { win: true };
  return null;
}
