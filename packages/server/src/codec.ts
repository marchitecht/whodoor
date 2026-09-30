// The only way a byte from the network becomes a command: JSON, then an io-ts decoder. Anything else is Left.
import * as t from 'io-ts';
import * as E from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/lib/function.js';
import type { C2S } from '@whodoor/shared';

const Finite = new t.Type<number, number, unknown>(
  'Finite',
  (u): u is number => typeof u === 'number' && Number.isFinite(u),
  (u, c) => (typeof u === 'number' && Number.isFinite(u) ? t.success(u) : t.failure(u, c)),
  t.identity,
);
const Bit = t.union([t.literal(0), t.literal(1)]);
const tag = <T extends string>(name: T) => t.literal(name);

export const C2SCodec = t.union([
  t.intersection([t.type({ t: tag('join'), name: t.string }), t.partial({ room: t.string })]),
  t.type({ t: tag('start') }),
  t.type({ t: tag('restart') }),
  t.type({ t: tag('bot'), add: t.boolean }),
  t.type({ t: tag('st'), x: Finite, y: Finite, f: Finite, g: Bit, a: Bit }),
  t.type({ t: tag('die'), m: t.string }),
  t.type({ t: tag('door'), lvl: t.Int }),
  t.type({ t: tag('poke') }),
  t.type({ t: tag('skip') }),
  t.type({ t: tag('draw'), pts: t.array(t.tuple([Finite, Finite])) }),
  t.type({ t: tag('ans'), i: t.Int }),
]);

// compile-time proof that the codec and the shared protocol type agree
const _same: (m: t.TypeOf<typeof C2SCodec>) => C2S = m => m;
void _same;

export type DecodeError = 'not-json' | 'not-a-message';

export const decode = (raw: string): E.Either<DecodeError, C2S> =>
  pipe(
    E.tryCatch(() => JSON.parse(raw) as unknown, (): DecodeError => 'not-json'),
    E.chain(u => pipe(C2SCodec.decode(u), E.mapLeft((): DecodeError => 'not-a-message'))),
  );
