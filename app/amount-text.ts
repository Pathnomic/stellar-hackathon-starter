/**
 * An amount of test money a person typed, read the way they meant it.
 *
 * `toStroops` in `lib/stellar/network.ts` reads amounts exactly as the network
 * writes them: digits, and a point before any decimals ("12.5"). People write
 * amounts their own way, so this sits in front of it:
 *
 *  - Spaces around the amount are ignored, and so are extra zeros in front
 *    ("007" is 7).
 *  - The reader's own decimal mark always works: a comma in Turkish ("12,5"),
 *    a point in English ("12.5"). The other mark works too, except where it
 *    could be separating thousands: in Turkish "1.000" is how a thousand is
 *    written (it is how this page itself writes the goal), so reading it as 1
 *    would quietly give away a thousandth of what the person meant. So a mark
 *    that is not the reader's own, with exactly three digits after it and a
 *    number other than 0 before it, is refused and the person is asked to
 *    write the amount without separators ("1.000" in Turkish, "1,000" in
 *    English). "0.125" and "12.5" read the same in both languages.
 *  - At most one mark, and at most 7 digits after it: test money has no
 *    smaller part, and an amount is never rounded behind the person's back.
 *
 * Pure, with no network: the page and the checks in `tests/` call the same code.
 */

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';
import { toStroops } from '../lib/stellar/network.ts';

import { problemWords } from './stellar-problems.ts';

/** Why a typed amount cannot be used. The page shows words for each. */
export type AmountProblem = 'empty' | 'not-a-number' | 'thousands' | 'too-many-decimals' | 'not-positive' | 'too-large';

export type AmountReading =
  | {
      readonly ok: true;
      /** The amount written the network's way, with a point: hand this to the library. */
      readonly amount: string;
      readonly stroops: bigint;
    }
  | { readonly ok: false; readonly problem: AmountProblem };

/** The reader's own decimal mark. */
const DECIMAL_MARK: Readonly<Record<Locale, string>> = Object.freeze({ en: '.', tr: ',' });

/** Digits, then at most one mark and the digits after it (none is fine: "12," is 12). */
const AMOUNT_SHAPE = /^([0-9]+)(?:([.,])([0-9]*))?$/;

/** Minus signs a keyboard or a copied number can bring: hyphen, minus, en dash. */
const NEGATIVE = /^[-−–]/;

/** The most whole digits `toStroops` reads: the network's limit is 922,337,203,685 test money. */
const MAX_WHOLE_DIGITS = 12;

const MAX_DECIMALS = 7;

/** Reads `typed` as an amount of test money, for a reader of `locale`. */
export function readAmount(typed: string, locale: Locale): AmountReading {
  const text = typed.trim();
  if (text === '') return { ok: false, problem: 'empty' };
  if (NEGATIVE.test(text)) return { ok: false, problem: 'not-positive' };
  const match = AMOUNT_SHAPE.exec(text);
  if (match === null) return { ok: false, problem: 'not-a-number' };
  const whole = match[1].replace(/^0+(?=[0-9])/, '');
  const mark = match[2];
  const decimals = match[3] ?? '';
  const ownMark = DECIMAL_MARK[locale] ?? DECIMAL_MARK.en;
  if (mark !== undefined && mark !== ownMark && decimals.length === 3 && whole !== '0') {
    return { ok: false, problem: 'thousands' };
  }
  if (decimals.length > MAX_DECIMALS) return { ok: false, problem: 'too-many-decimals' };
  if (/^0*$/.test(whole) && /^0*$/.test(decimals)) return { ok: false, problem: 'not-positive' };
  if (whole.length > MAX_WHOLE_DIGITS) return { ok: false, problem: 'too-large' };
  const amount = decimals === '' ? whole : `${whole}.${decimals}`;
  const stroops = toStroops(amount);
  if (stroops === null) return { ok: false, problem: 'too-large' };
  return { ok: true, amount, stroops };
}

/**
 * The words for an amount that cannot be used, in `locale`. Each key is written
 * out rather than built, so Tellop's word checks can see it.
 */
export function amountProblemWords(problem: AmountProblem, locale: Locale): string {
  switch (problem) {
    case 'empty':
      return t('wallet.amountEmpty', locale);
    case 'too-many-decimals':
      return t('wallet.amountDecimals', locale);
    case 'not-positive':
      return problemWords('amount-not-positive', locale);
    case 'too-large':
      return t('wallet.amountTooLarge', locale);
    case 'not-a-number':
    case 'thousands':
      return t('wallet.amountFormat', locale);
  }
}
