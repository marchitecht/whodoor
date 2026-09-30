// Levels are compositions: a name, a narrator line and a list of behaviors, concatenated as a monoid.
import { flow } from 'fp-ts/lib/function.js';
import { CHAR_W, box, spk, textPlat } from './world.ts';
import { all, once, at, after, and, not, anyPast, say, type Behavior } from './behavior.ts';
import {
  door, hangingDoor, blocks, spikes, ceiling, gravity,
  tiles, crumbleUnderfoot, traps, doorFallsAway,
  saw, launch, sawGone, icicles, doorBreaker, pendulums, crusher, rhythmSpikes, rollingBall, lifts, collapse, credits,
  shyDoor, doorWrapped, patienceDoor, drawnDoor, persuade, scrambledControls, cardboard, standingOnText,
} from './components.ts';

export interface Meta {
  readonly id: string;
  /** bonus levels: shown as "<previous number><label>" */
  readonly label?: string;
  readonly say: string;
  readonly skip?: string; readonly skipTo?: string; readonly next?: string;
  readonly fallSay?: string;
  /** spikes on this level do not kill */
  readonly harmlessSpikes?: boolean;
  readonly overlay?: 'ad' | 'dialog';
  readonly draw?: boolean;
}
export interface Level extends Meta { readonly b: Behavior; readonly disp: string }

export const DEATH = ['Бывает.', 'Шипы острые. Кто бы мог подумать.', 'Это было больно даже смотреть.', 'Квадрат в порядке. Почти.'];
export const TIRED_OPTS: ReadonlyArray<readonly [string, string | null]> = [
  ['Иди, я сказал!', 'Не кричи на меня.'],
  ['Там за дверью печеньки.', 'Печеньки — ложь. Как и торт.'],
  ['Ну пожалуйста?', 'Вежливо. Но нет.'],
  ['Ты уже столько прошёл. Ты крут.', null],
];
export const CREDITS = ['НАД ИГРОЙ РАБОТАЛИ', 'Квадраты — в главных ролях', 'Дверь — играла саму себя', 'Стеснительность двери — дублёр',
  'Шипы — картонные каскадёры', 'Пила — вежливая, но нет', 'Шар — без очереди', 'Лифт — на обеде', 'Пол — ненадёжный',
  'Крестик рекламы — лёгкая атлетика', 'Гравитация — вверх ногами', 'Вы — невероятное терпение', 'Спасибо, что дошли', 'ИГРАТЬ СНОВА'];

const die = {
  saw: ['Распилило.', 'Пила быстрее.', 'Надо было прыгать.'],
  ice: ['Сосулька.', 'Смотри наверх.', 'Прямо в темечко.'],
  pend: ['Бум.', 'Маятник не виноват.', 'Качнуло.'],
  slab: ['Придавило.', 'Плита победила.', 'Смотри наверх.'],
  beat: ['Сбился с ритма.', 'Мимо такта.', 'Не в долю.'],
  ball: ['Шар победил.', 'Раздавило.', 'Надо было быстрее.'],
};

const level = (meta: Meta, parts: ReadonlyArray<Behavior>) => ({ ...meta, b: all(parts) });
const floorRun = collapse('collapse', 'floor', { obst: [box(520, 420, 40, 50)], spikes: [spk(300, 66), spk(700, 66)], doorX: 880 });

const defs: ReadonlyArray<Omit<Level, 'disp'>> = [
  level({ id: 'basic', say: 'Дойди до двери первым. Всё. Это вся игра.' }, [
    blocks(box(380, 420, 80, 50), box(560, 380, 80, 90)), door(860),
  ]),

  level({ id: 'shy', say: 'Эта дверь немного стеснительная.' }, [
    door(820), shyDoor('shy'),
    once('hint', and(after(8), not(doorWrapped)), say('Может, не смотреть на неё так пристально?')),
  ]),

  level({ id: 'saw', say: 'Тут пилы. Просто перепрыгивай.' }, [
    door(880),
    saw('a', { x: 200, v: 230, min: 180, max: 540 }, die.saw),
    once('lunge', anyPast(590), flow(launch('b', -430), say('Шучу.'))),
    saw('b', { x: 790 }, die.saw),
    once('gone', sawGone('b'), say('Ну и ладно. Проходите.')),
  ]),

  level({ id: 'crumble', say: 'Пол старый. Не стой на месте.' }, [
    door(880),
    crumbleUnderfoot('floor', .35, 1),
    doorFallsAway('fall', 'floor', 740),
    tiles('floor', 60, true, 3),
  ]),

  level({ id: 'text', say: 'Дверь высоко. Тут поможет только чтение.' }, [
    blocks(textPlat('Нажми ПРОБЕЛ, чтобы прыгнуть', 110, 385, 'mute'), textPlat('Эта надпись — не платформа', 400, 300, 'mute'), box(740, 215, 220, 16, { oneway: true })),
    door(890, 215 - 52),
    once('lie', standingOnText('Эта'), say('Ладно. Платформа. Я соврал.')),
  ]),

  level({ id: 'invert', say: 'Всё как обычно.' }, [
    blocks(box(450, 410, 70, 60)), door(860),
    scrambledControls(1.5, 7),
    at('s1', 1.5, 'Ой. Управление перепутано.'), at('s2', 4.5, 'Сейчас починю…'), at('s3', 7, 'Починил! Вроде бы.'),
    at('s4', 15, 'Шпаргалка: ← прыжок, → влево, пробел вправо. Не благодарите.'),
  ]),

  level({ id: 'ice', say: 'Потолок немного протекает.' }, [
    ceiling(), door(880),
    icicles('ic', [200, 330, 460, 590], die.ice),
    doorBreaker('last', 886, 600, die.ice),
  ]),

  level({ id: 'pits', say: 'Ровный пол. Совершенно обычный.', fallSay: 'Кто же знал.' }, [
    door(880),
    traps('traps', 'floor', [{ t: [5], at: 300 }, { t: [9, 10], at: 488 }, { t: [13], at: 792 }], ['Кто же знал.', 'Упс.', 'Совершенно обычный пол, говорю же.']),
    tiles('floor', 60, false),
  ]),

  level({ id: 'draw', draw: true, say: 'Дверь забыли нарисовать. Нарисуйте её сами — мышкой или пальцем.' }, [
    drawnDoor('drawn'), blocks(box(300, 400, 60, 70)),
  ]),

  level({ id: 'pend', say: 'Маятники. Поймай ритм и проходи.' }, [
    ceiling(), door(880),
    pendulums('pend', [{ x: 340, ph: 0 }, { x: 620, ph: 1.7 }], 7, die.pend),
  ]),

  level({ id: 'slabs', say: 'Потолок держится на честном слове.' }, [
    door(880), crusher('crusher', [170, 320, 470, 620], 560, 880, die.slab),
  ]),

  level({ id: 'wait', say: 'Отдохните. Никто ничего не нажимает 10 секунд.' }, [
    patienceDoor('walker', 860, 480, 10, ['я же просил.', 'ну вот, опять.', 'ничего. Не. Нажимай.', 'тебе правда так сложно?', 'руки. От. Клавиатуры.', 'дыши. Просто дыши.']),
  ]),

  level({ id: 'gravity', say: 'Кто-то перевернул гравитацию. Дверь на потолке.', fallSay: 'Упал вверх. Такое тоже бывает.' }, [
    gravity(-1, [60, 116]),
    blocks(box(0, 90, 400, 26), box(490, 90, 470, 26), box(250, 116, 40, 34)),
    hangingDoor(860, 116),
  ]),

  level({ id: 'spikes', say: 'Обычный уровень с шипами. Если что, есть кнопка «пропустить».', skip: 'Пропустить уровень →', skipTo: 'cardboard', next: 'rhythm' }, [
    spikes(spk(260, 88), spk(470, 110), spk(700, 88)), door(880),
  ]),

  level({ id: 'cardboard', label: '½', harmlessSpikes: true, say: 'Кто-то хотел пропустить? Держите уровень посложнее.', skip: 'Пропустить ещё раз →', skipTo: 'spikes' }, [
    spikes(spk(130, 726)), cardboard('flat'), door(880),
  ]),

  level({ id: 'rhythm', say: 'Шипы под ритм. Раз — два. Раз — два.' }, [
    blocks(box(90, 360, 750, 50)), door(880),
    rhythmSpikes('beat', [110, 260, 410, 560, 710], 110, 560, die.beat),
  ]),

  level({ id: 'tired', overlay: 'dialog', say: 'Ваши квадраты устали. Уговорите своего.' }, [
    door(860), blocks(box(420, 420, 60, 50)),
    persuade(TIRED_OPTS, '…правда? Ну да. Я крут.'),
  ]),

  level({ id: 'ball', say: 'Бегите.' }, [
    door(880), blocks(box(300, 430, 40, 40), box(520, 410, 40, 60)), spikes(spk(640, 66)),
    rollingBall('ball', 897, 740, die.ball),
  ]),

  level({ id: 'ad', overlay: 'ad', say: 'Реклама. Простите, надо же как-то зарабатывать.' }, [door(600)]),

  level({ id: 'lifts', say: 'Лифты над шипами. Один ушёл на обед.' }, [
    door(890), spikes(spk(140, 704)),
    lifts('lifts', [{ x: 160, ph: 0 }, { x: 330, ph: 1.3 }, { x: 500, ph: 2.6, lunch: true }, { x: 670, ph: 3.9 }], 7),
  ]),

  level({ id: 'collapse', say: 'Пол рушится. Прямо за вами.' }, [
    floorRun.driver, tiles('floor', 40, true), floorRun.obstacles,
  ]),

  level({ id: 'credits', say: 'Титры. По ним можно ходить.', fallSay: 'Унесло титрами. Прыгай на строчки пониже.' }, [
    credits('credits', CREDITS, CHAR_W, 55),
  ]),
];

let n = 0;
export const LEVELS: ReadonlyArray<Level> = defs.map(d => ({ ...d, disp: d.label ? n + d.label : String(++n) }));
export const TOTAL = n;
export const byId = (id: string) => LEVELS.findIndex(l => l.id === id);
export const nextLevel = (i: number) => { const L = LEVELS[i]; return L.next ? byId(L.next) : i + 1; };
