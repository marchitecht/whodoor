// Server-side bots: they play inside the room with the same physics and rules as people.
import {
  LEVELS, NONE, PS, W, FLOOR, mapInput, stepPlayer, checkPlayer,
  type World, type Body, type Input, type Rect,
} from '@whodoor/shared';

export interface Brain {
  b: Body; prev: Input; frame: number; seed: number;
  /** seconds after level start before the bot starts moving */
  delay: number;
  pause: number;
  lastX: number; stuck: number;
  ansAt: number; drawAt: number;
}

export interface BotAct { die?: string; win?: boolean; ans?: number; draw?: [number, number][] }

export function newBrain(): Brain {
  return {
    b: { x: 60, y: FLOOR - PS, w: PS, h: PS, vx: 0, vy: 0, face: 1, g: false },
    prev: { ...NONE }, frame: 0, seed: Math.floor(Math.random() * 40),
    delay: 0, pause: 0, lastX: 0, stuck: 0, ansAt: 0, drawAt: 0,
  };
}

export function respawnBrain(br: Brain, w: World, slot: number) {
  const b = br.b;
  b.x = w.spawn[0] + slot * 6; b.y = w.spawn[1]; b.vx = b.vy = 0; b.g = false;
}

/** Called when a level starts: a human-like hesitation, and when to answer / draw on the gag levels. */
export function levelBrain(br: Brain, w: World, slot: number) {
  respawnBrain(br, w, slot);
  br.prev = { ...NONE }; br.pause = 0; br.stuck = 0;
  br.delay = .4 + Math.random() * .9;
  br.ansAt = 2 + Math.random() * 3;
  br.drawAt = 3 + Math.random() * 3;
}

export function tickBot(br: Brain, w: World, id: string, others: Rect[], dt: number): BotAct {
  const L = LEVELS[w.lvl], b = br.b, out: BotAct = {};
  br.frame++;

  // gag levels
  if (L.overlay === 'dialog' && !w.pl[id]?.ok && w.t > br.ansAt && (w.pl[id]?.lock ?? 0) <= w.t) {
    out.ans = Math.random() < .45 ? 3 : Math.floor(Math.random() * 3);
    br.ansAt = w.t + 1 + Math.random() * 2;
  }
  if (L.draw && !w.door && w.t > br.drawAt) {
    const x = Math.min(W - 60, b.x + 60);
    out.draw = [[x, FLOOR - 60], [x, FLOOR], [x + 34, FLOOR], [x + 34, FLOOR - 60], [x, FLOOR - 60]];
    br.drawAt = w.t + 8;
  }

  // movement: walk to the door (or the hole), jump on a rhythm and when blocked, sometimes hesitate
  let raw: Input = { ...NONE };
  if (br.pause > 0) br.pause -= dt;
  else if (Math.random() < dt * .35) br.pause = .15 + Math.random() * .45;
  if (w.t > br.delay && br.pause <= 0) {
    const tx = w.door ? w.door.x + w.door.w / 2 : w.s.hole ? 898 : W;
    const dx = tx - (b.x + b.w / 2);
    raw.left = dx < -8; raw.right = dx > 8;
    const moving = raw.left || raw.right;
    br.stuck = moving && Math.abs(b.x - br.lastX) < .3 ? br.stuck + 1 : 0;
    raw.jump = (br.frame + br.seed) % 40 < 2 || br.stuck > 5;
  }
  if (L.id === 'wait' && !w.s.done) raw = { ...NONE };
  br.lastX = b.x;
  raw.leftP = raw.left && !br.prev.left; raw.rightP = raw.right && !br.prev.right; raw.jumpP = raw.jump && !br.prev.jump;
  br.prev = raw;

  stepPlayer(b, mapInput(w, raw, id), w, others, dt);
  const r = checkPlayer(w, b);
  if (r?.die) out.die = r.die;
  else if (r?.win) out.win = true;
  return out;
}
