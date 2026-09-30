let ac: AudioContext | null = null;

/** Must be called from a user gesture: browsers only start audio after one. */
export function initAudio() {
  try { ac ??= new (window.AudioContext || (window as any).webkitAudioContext)(); ac.resume?.(); } catch { /* no audio */ }
}

export type Sfx = 'jump' | 'die' | 'win' | 'lose' | 'err' | 'click' | 'tick' | 'tock';

export function sfx(k: Sfx) {
  if (!ac) return;
  const t = ac.currentTime;
  const tone = (f1: number, f2: number, d: number, type: OscillatorType = 'square', v = .05, dl = 0) => {
    const o = ac!.createOscillator(), g = ac!.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t + dl); o.frequency.exponentialRampToValueAtTime(f2, t + dl + d);
    g.gain.setValueAtTime(v, t + dl); g.gain.exponentialRampToValueAtTime(.0001, t + dl + d);
    o.connect(g).connect(ac!.destination); o.start(t + dl); o.stop(t + dl + d + .03);
  };
  switch (k) {
    case 'jump': tone(330, 660, .1); break;
    case 'die': tone(220, 55, .35, 'sawtooth', .06); break;
    case 'win': tone(523, 523, .09); tone(659, 659, .09, 'square', .05, .09); tone(784, 1046, .2, 'square', .05, .18); break;
    case 'lose': tone(392, 330, .12, 'triangle', .07); tone(330, 262, .2, 'triangle', .07, .12); break;
    case 'err': tone(170, 150, .2); break;
    case 'click': tone(900, 650, .05, 'triangle', .07); break;
    case 'tick': tone(1300, 1100, .04, 'square', .035); break;
    case 'tock': tone(220, 110, .09, 'sine', .1); break;
  }
}
