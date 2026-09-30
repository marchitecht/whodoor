import './style.css';
import {
  PS, NONE, LEVELS, TIRED_OPTS, WIN_PAUSE_MS,
  updateWorld, mapInput, checkPlayer, stepPlayer,
  type World, type Body, type PV, type Input, type S2C, type C2S, type LobbyPlayer, type Phase,
} from '@whodoor/shared';
import { setupCanvas, draw, type Avatar } from './render.ts';
import { initAudio, sfx } from './audio.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const cv = $<HTMLCanvasElement>('cv');
const ctx = setupCanvas(cv);
const STEP = 1 / 60, INTERP_MS = 100;
const BASE = import.meta.env.BASE_URL; // '/' locally, '/games/whodoor/' in production

/* ---------------- state ---------------- */
let ws: WebSocket | null = null;
let myId = '', code = '', host = '', phase: Phase = 'lobby';
let players: LobbyPlayer[] = [];
let w: World | null = null;
const me: Body = { x: 60, y: 444, w: PS, h: PS, vx: 0, vy: 0, face: 1, g: false };
let doorSent = -1, flash = 0, T = 0, sendAcc = 0, lastBeat = -1;
let narr = { text: '', n: -1, t: 0 };
let stroke: { x: number; y: number }[] | null = null;
type Sample = { t: number; x: number; y: number; f: number; a: number };
const others = new Map<string, Sample[]>();
const bubbles = new Map<string, { text: string; until: number }>();

const store = {
  get(k: string) { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ---------------- network ---------------- */
function send(m: C2S) { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); }

function connect(name: string, room: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${BASE}ws`);
  ws.onopen = () => send({ t: 'join', name, room });
  ws.onmessage = e => onMsg(JSON.parse(e.data) as S2C);
  ws.onclose = () => showLost();
}

function onMsg(m: S2C) {
  const now = performance.now();
  switch (m.t) {
    case 'hi':
      myId = m.id; code = m.room;
      history.replaceState(null, '', `?r=${code}`);
      break;
    case 'lobby':
      host = m.host; players = m.players;
      if (m.phase !== phase) { phase = m.phase; }
      for (const id of [...others.keys()]) if (!players.some(p => p.id === id)) others.delete(id);
      screens();
      break;
    case 'lvl':
      w = m.w; doorSent = -1; lastBeat = -1; stroke = null; bubbles.clear();
      respawn(); levelUi(); takeNarr();
      break;
    case 'snap':
      w = m.w; takeNarr();
      for (const [id, x, y, f, a] of m.ps) {
        if (id === myId) continue;
        const buf = others.get(id) ?? []; buf.push({ t: now, x, y, f, a });
        while (buf.length > 2 && buf[1].t < now - 1000) buf.shift();
        others.set(id, buf);
      }
      break;
    case 'fx':
      if (m.id !== myId || m.k === 'bub') bubbles.set(m.id, { text: m.m, until: now + (m.k === 'bub' ? 2400 : 1600) });
      break;
    case 'won': {
      const p = players.find(q => q.id === m.id);
      const b = $('banner');
      b.replaceChildren();
      const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = p?.color ?? '#000';
      const tx = document.createElement('span'); tx.textContent = m.id === myId ? 'Ты первый! +1' : `${p?.name ?? 'Кто-то'} первый`;
      b.append(sw, tx); b.hidden = false;
      sfx(m.id === myId ? 'win' : 'lose');
      setTimeout(() => { b.hidden = true; }, WIN_PAUSE_MS - 200);
      break;
    }
    case 'end': sfx('win'); break;
    case 'err': showLost(m.m); break;
  }
}

function takeNarr() { if (w && w.sayN !== narr.n) narr = { text: w.say, n: w.sayN, t: 0 }; }
function myIndex() { return Math.max(0, players.findIndex(p => p.id === myId)); }
function respawn() {
  if (!w) return;
  me.x = w.spawn[0] + myIndex() * 6; me.y = w.spawn[1]; me.vx = me.vy = 0; me.g = false;
}

/* ---------------- screens ---------------- */
function showLost(msg?: string) {
  if (msg) $('lost-msg').textContent = msg;
  for (const id of ['scr-start', 'scr-lobby', 'scr-end']) $(id).hidden = true;
  $('scr-lost').hidden = false;
}
function swatch(color: string) { const s = document.createElement('span'); s.className = 'sw'; s.style.background = color; return s; }

function screens() {
  $('scr-start').hidden = !!myId;
  $('scr-lobby').hidden = !myId || phase !== 'lobby';
  $('scr-end').hidden = !myId || phase !== 'end';
  const isHost = host === myId;
  const hostName = players.find(p => p.id === host)?.name ?? 'хост';
  if (phase === 'lobby') {
    $('lb-code').textContent = code;
    $<HTMLInputElement>('lb-link').value = `${location.origin}${BASE}?r=${code}`;
    const ul = $('lb-list'); ul.replaceChildren();
    for (const p of players) {
      const li = document.createElement('li');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name;
      li.append(swatch(p.color), nm);
      const tags = [p.id === myId && 'ты', p.id === host && 'хост', p.bot && 'бот'].filter(Boolean).join(' · ');
      if (tags) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = tags; li.append(t); }
      ul.append(li);
    }
    const bots = players.filter(p => p.bot).length;
    $('btn-start').hidden = !isHost;
    $('btn-start').textContent = players.length > 1 ? `Начать (${players.length})` : 'Начать одному';
    $('lb-bots').hidden = !isHost;
    $<HTMLButtonElement>('btn-bot-add').disabled = players.length >= 8;
    $<HTMLButtonElement>('btn-bot-del').disabled = bots === 0;
    $('lb-wait').hidden = isHost;
    $('lb-wait').textContent = `Ждём, пока ${hostName} начнёт игру. Пока можно позвать ещё людей по ссылке.`;
  }
  if (phase === 'end') {
    const sorted = [...players].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    const top = sorted[0];
    $('end-title').textContent = top ? (top.id === myId ? 'Ты победил!' : `Победил ${top.name}`) : 'Конец';
    const ul = $('end-list'); ul.replaceChildren();
    for (const p of sorted) {
      const li = document.createElement('li');
      const who = document.createElement('span'); who.className = 'who';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.id === myId ? ' (ты)' : '');
      const dth = document.createElement('span'); dth.className = 'dth'; dth.textContent = `падений: ${p.deaths}`;
      who.append(swatch(p.color), nm, dth);
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(p.score);
      li.append(who, pts); ul.append(li);
    }
    $('btn-again').hidden = !isHost;
    $('end-wait').hidden = isHost;
    $('end-wait').textContent = `${hostName} может запустить ещё раунд.`;
  }
  if (phase !== 'play' && phase !== 'won') for (const id of ['ad', 'dialog', 'skip']) $(id).hidden = true;
}

/* ---------------- start / lobby controls ---------------- */
const urlCode = (new URLSearchParams(location.search).get('r') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const nameIn = $<HTMLInputElement>('in-name'), codeIn = $<HTMLInputElement>('in-code');
nameIn.value = store.get('whodoor.name');
if (urlCode) { $('btn-join').textContent = `Войти в комнату ${urlCode}`; $('code-wrap').hidden = true; }
codeIn.addEventListener('input', () => { const c = codeIn.value.trim(); $('btn-join').textContent = c ? `Войти в комнату ${c.toUpperCase()}` : 'Создать комнату'; });
$('f-join').addEventListener('submit', e => {
  e.preventDefault();
  const name = nameIn.value.trim().slice(0, 16); if (!name) return;
  store.set('whodoor.name', name); initAudio();
  (document.activeElement as HTMLElement | null)?.blur();
  connect(name, urlCode || codeIn.value.trim().toUpperCase());
});
$('btn-copy').addEventListener('click', async () => {
  const inp = $<HTMLInputElement>('lb-link');
  try { await navigator.clipboard.writeText(inp.value); $('btn-copy').textContent = 'Скопировано'; }
  catch { inp.select(); $('btn-copy').textContent = 'Выделено, жми Ctrl+C'; }
  setTimeout(() => { $('btn-copy').textContent = 'Скопировать'; }, 1800);
});
$('btn-start').addEventListener('click', () => { initAudio(); send({ t: 'start' }); });
$('btn-again').addEventListener('click', () => send({ t: 'restart' }));
$('btn-bot-add').addEventListener('click', () => send({ t: 'bot', add: true }));
$('btn-bot-del').addEventListener('click', () => send({ t: 'bot', add: false }));
$('skip').addEventListener('click', e => { (e.currentTarget as HTMLElement).blur(); sfx('click'); send({ t: 'skip' }); });

/* ---------------- per-level overlays ---------------- */
function levelUi() {
  if (!w) return;
  const L = LEVELS[w.lvl];
  $('skip').hidden = !L.skip; $('skip').textContent = L.skip ?? '';
  $('ad').hidden = L.overlay !== 'ad'; if (L.overlay === 'ad') showAd();
  $('dialog').hidden = L.overlay !== 'dialog';
  if (L.overlay === 'dialog') {
    const box = $('opts'); box.replaceChildren();
    TIRED_OPTS.forEach(([q], i) => {
      const b = document.createElement('button'); b.textContent = q;
      b.addEventListener('click', () => { b.blur(); sfx('click'); send({ t: 'ans', i }); });
      box.append(b);
    });
  }
}
function dialogState() {
  if (!w || LEVELS[w.lvl].overlay !== 'dialog') return;
  const st = w.pl[myId];
  $('dialog').hidden = !!st?.ok;
  const locked = (st?.lock ?? 0) > w.t;
  for (const b of $('opts').querySelectorAll('button')) b.disabled = locked;
}

const ADPOS = [{ top: '-1.7cqw', left: 'calc(100% - 1.7cqw)' }, { top: '-1.7cqw', left: '-1.7cqw' }, { top: 'calc(100% - 1.7cqw)', left: 'calc(100% - 1.7cqw)' }, { top: 'calc(100% - 1.7cqw)', left: '-1.7cqw' }, { top: '40%', left: '-1.7cqw' }, { top: '-1.7cqw', left: '45%' }];
let adDodge = 0;
const placeX = (i: number) => Object.assign($('adx').style, ADPOS[i % ADPOS.length]);
function showAd() {
  adDodge = 0; placeX(0); $('ad').classList.remove('ghost');
  $('adt').innerHTML = 'Вы 1 000 000-й игрок!<br>Заберите свою ДВЕРЬ бесплатно';
  $('adgo').hidden = false;
}
function dodge(e: Event) { if (adDodge >= 5) return; e.preventDefault(); adDodge++; placeX(adDodge + Math.floor(Math.random() * 3)); sfx('click'); if (adDodge === 5) $('adt').textContent = 'Крестик выдохся. Теперь можно.'; }
$('adx').addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse') dodge(e); });
$('adx').addEventListener('pointerdown', dodge);
$('adx').addEventListener('click', e => { (e.currentTarget as HTMLElement).blur(); if (adDodge >= 5) $('ad').hidden = true; });
$('adgo').addEventListener('click', e => {
  (e.currentTarget as HTMLElement).blur();
  $('adt').textContent = 'Шучу. Приза нет. Но дверь прямо за этой рекламой.'; $('adgo').hidden = true; sfx('err');
  setTimeout(() => $('ad').classList.add('ghost'), 1400);
});

/* ---------------- input ---------------- */
const held = { left: false, right: false, jump: false };
let prev = { ...held };
const KM: Record<string, keyof typeof held> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump' };
const playing = () => phase === 'play' && !!w && !!myId;
function poke() { if (playing() && LEVELS[w!.lvl].poke && !w!.s.done) send({ t: 'poke' }); }
function clearHeld() { held.left = held.right = held.jump = false; document.querySelectorAll('.pad button').forEach(b => b.classList.remove('on')); }

addEventListener('keydown', e => {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
  const k = KM[e.code];
  if (!playing()) return;
  if (k) e.preventDefault();
  if (!e.repeat) poke();
  if (k) held[k] = true;
});
addEventListener('keyup', e => { const k = KM[e.code]; if (k) held[k] = false; });
addEventListener('blur', clearHeld);
document.querySelectorAll<HTMLButtonElement>('.pad button').forEach(b => {
  const k = b.dataset.k as keyof typeof held;
  b.addEventListener('pointerdown', e => { e.preventDefault(); held[k] = true; b.classList.add('on'); poke(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { held[k] = false; b.classList.remove('on'); });
  b.addEventListener('contextmenu', e => e.preventDefault());
});

function readInput(): Input {
  const i = { ...held, leftP: held.left && !prev.left, rightP: held.right && !prev.right, jumpP: held.jump && !prev.jump };
  prev = { ...held };
  return i;
}

/* drawing a door (one level) */
const pt = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 960, y: (e.clientY - r.top) / r.height * 540 }; };
cv.addEventListener('pointerdown', e => {
  poke();
  if (!playing() || !LEVELS[w!.lvl].draw) return;
  cv.setPointerCapture(e.pointerId); stroke = [pt(e)];
});
cv.addEventListener('pointermove', e => { if (stroke) stroke.push(pt(e)); });
function endStroke() {
  if (!stroke) return;
  const s = stroke; stroke = null;
  if (s.length < 2) return;
  const every = Math.ceil(s.length / 100);
  send({ t: 'draw', pts: s.filter((_, i) => i % every === 0 || i === s.length - 1).map(q => [Math.round(q.x), Math.round(q.y)] as [number, number]) });
}
cv.addEventListener('pointerup', endStroke);
cv.addEventListener('pointercancel', endStroke);

/* ---------------- loop ---------------- */
function latestOthers(): PV[] {
  const out: PV[] = [];
  for (const [id, buf] of others) { const s = buf[buf.length - 1]; if (s) out.push({ id, x: s.x, y: s.y, w: PS, h: PS, face: s.f, g: true, alive: !!s.a }); }
  return out;
}

function tick(dt: number) {
  if (flash > 0) flash -= dt;
  narr.t += dt;
  if (!w || phase !== 'play') { readInput(); return; }
  const L = LEVELS[w.lvl];
  const os = latestOthers();
  updateWorld(w, dt, [{ id: myId, ...me, alive: true }, ...os]);
  if (L.id === 'rhythm') { if (lastBeat >= 0 && w.s.beat !== lastBeat) sfx(w.s.beat % 2 ? 'tick' : 'tock'); lastBeat = w.s.beat; }
  const i = mapInput(w, readInput(), myId);
  if (stepPlayer(me, i, w, os.filter(o => o.alive), dt)) sfx('jump');
  const r = checkPlayer(w, me);
  if (r?.die) {
    send({ t: 'die', m: r.die }); sfx('die'); flash = .3;
    bubbles.set(myId, { text: r.die, until: performance.now() + 1600 });
    respawn();
  } else if (r?.win && doorSent !== w.lvl) { doorSent = w.lvl; send({ t: 'door', lvl: w.lvl }); }
  if ((sendAcc += dt) >= 1 / 30) { sendAcc = 0; send({ t: 'st', x: me.x, y: me.y, f: me.face, g: me.g ? 1 : 0, a: 1 }); }
}

function interp(buf: Sample[], at: number): Sample | null {
  if (!buf.length) return null;
  for (let k = buf.length - 1; k > 0; k--) {
    const a = buf[k - 1], b = buf[k];
    if (a.t <= at && at <= b.t) {
      const f = (at - a.t) / Math.max(1, b.t - a.t);
      if (Math.abs(b.x - a.x) > 120 || Math.abs(b.y - a.y) > 120) return b; // respawn: don't slide across the screen
      return { t: at, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, f: b.f, a: b.a };
    }
  }
  return buf[buf.length - 1];
}

function render(now: number) {
  if (!w) {
    ctx.fillStyle = '#E8E9EE'; ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#15161B'; ctx.fillRect(0, 470, 960, 70);
    return;
  }
  const L = LEVELS[w.lvl];
  const avatars: Avatar[] = [];
  const pmeta = (id: string) => players.find(p => p.id === id);
  for (const [id, buf] of others) {
    const s = interp(buf, now - INTERP_MS), p = pmeta(id); if (!s || !p) continue;
    avatars.push({ id, x: s.x, y: s.y, w: PS, h: PS, face: s.f, color: p.color, name: p.name, me: false, alive: !!s.a, tired: L.id === 'tired' && !w.pl[id]?.ok });
  }
  const mm = pmeta(myId);
  if (mm) avatars.push({ id: myId, x: me.x, y: me.y, w: PS, h: PS, face: me.face, color: mm.color, name: mm.name, me: true, alive: true, tired: L.id === 'tired' && !w.pl[myId]?.ok });
  const bl: { id: string; text: string }[] = [];
  for (const [id, b] of bubbles) { if (b.until < now) bubbles.delete(id); else bl.push({ id, text: b.text }); }
  if (L.id === 'tired' && !w.pl[myId]?.ok && !bubbles.has(myId)) bl.push({ id: myId, text: 'Не хочу. Я устал.' });
  const scores = [...players].sort((a, b) => b.score - a.score).map(p => ({ color: p.color, score: p.score, me: p.id === myId }));
  draw(ctx, { w, T, avatars, bubbles: bl, narr: narr.text.slice(0, Math.floor(narr.t * 48)), scores, flash, stroke });
}

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(.1, (now - last) / 1000); last = now; T += dt; acc += dt;
  while (acc >= STEP) { acc -= STEP; tick(STEP); }
  dialogState();
  render(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
screens();
