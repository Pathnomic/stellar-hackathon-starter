/**
 * The fundraiser's numbers, written for a reader.
 *
 * Two sources, one shape. Before the fundraiser is published, the page shows an
 * example: the goal and the end date that publishing will set up (from
 * `stellar/fundraiser.settings.json`, when it can be read) and a made-up amount
 * raised, labelled as an example where it is shown. After publishing, every
 * number is the contract's own, read from Stellar's test network in the
 * browser (`live-progress.tsx`).
 *
 * Amounts arrive as test money written the network's way ("1000", "12.5") and
 * are counted exactly, in stroops, never as floating point. Dates are shown in
 * UTC: a settings end date of "2026-11-15" means "through that day, UTC", so
 * the page shows the last day the fundraiser takes donations.
 *
 * Pure functions with no network and no clock: the page, the live reading and
 * the checks in `tests/` all call the same code.
 */

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';
import { EXAMPLE_GOAL, EXAMPLE_RAISED_PERCENT } from '../lib/stellar/example-data.ts';
import type { SettingsReading } from '../lib/stellar/deployment.ts';
import type { FundraiserReading } from '../lib/stellar/fundraiser.ts';
import { balanceToStroops, formatTestMoney } from '../lib/stellar/network.ts';

/** What the progress area shows, every value already in words. */
export type FundraiserFigures = {
  /** "420 test money" */
  readonly raised: string;
  /** "1,000 test money" */
  readonly goal: string;
  /** The last day donations are taken ("November 15, 2026"), or `null` when unknown. */
  readonly endsOn: string | null;
  readonly status: string;
  /** How far toward the goal, as a whole percent from 0 to 100. */
  readonly percent: number;
};

/** A published fundraiser's reading, as `readFundraiser` answers it. */
export type PublishedReading = Extract<FundraiserReading, { readonly ok: true }>;

/** The latest moment a `Date` can hold, in seconds since 1970. */
const LAST_DATE_SECONDS = 8_640_000_000_000;

/**
 * An amount of test money ("1000", "12.5") written for a reader in `locale`:
 * "1,000" and "12.5" in English, "1.000" and "12,5" in Turkish. `null` for
 * anything that is not an amount.
 */
export function readableAmount(amount: string, locale: Locale): string | null {
  const stroops = balanceToStroops(amount);
  if (stroops === null) return null;
  const [whole, fraction] = formatTestMoney(stroops).split('.');
  const numbers = new Intl.NumberFormat(locale);
  const grouped = numbers.format(BigInt(whole));
  if (fraction === undefined) return grouped;
  const decimal = numbers.formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? '.';
  return `${grouped}${decimal}${fraction}`;
}

/** How far `raised` is toward `goal`, as a whole percent from 0 to 100. */
export function percentRaised(raised: string, goal: string): number {
  const given = balanceToStroops(raised);
  const aim = balanceToStroops(goal);
  if (given === null || aim === null || aim <= BigInt(0)) return 0;
  const percent = (given * BigInt(100)) / aim;
  return percent > BigInt(100) ? 100 : Number(percent);
}

/**
 * The last day of a fundraiser that ends at `deadline` (seconds since 1970,
 * UTC), written for a reader: the day of the last second before the end.
 * `null` when there is no such day.
 */
export function readableEndDate(deadline: number, locale: Locale): string | null {
  if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > LAST_DATE_SECONDS) return null;
  const lastMoment = new Date(deadline * 1000 - 1);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(lastMoment);
}

/** Where a published fundraiser stands, in words. */
export function statusWords(reading: PublishedReading, locale: Locale): string {
  if (reading.state === 'running') {
    return reading.paused ? t('fundraiser.statePaused', locale) : t('fundraiser.stateRunning', locale);
  }
  if (reading.state === 'succeeded') {
    return reading.withdrawn ? t('fundraiser.stateWithdrawn', locale) : t('fundraiser.stateSucceeded', locale);
  }
  return t('fundraiser.stateFailed', locale);
}

function inTestMoney(amount: string, locale: Locale): string | null {
  const readable = readableAmount(amount, locale);
  return readable === null ? null : t('stellar.testMoney', locale, { amount: readable });
}

/** A published fundraiser's figures; `null` if its amounts cannot be read. */
export function publishedFigures(reading: PublishedReading, locale: Locale): FundraiserFigures | null {
  const raised = inTestMoney(reading.total, locale);
  const goal = inTestMoney(reading.goal, locale);
  if (raised === null || goal === null) return null;
  return {
    raised,
    goal,
    endsOn: readableEndDate(reading.deadline, locale),
    status: statusWords(reading, locale),
    percent: percentRaised(reading.total, reading.goal),
  };
}

/**
 * The example's figures, before anything is published: the goal and end date
 * from the settings file when it can be read (the example goal and no end date
 * when it cannot), and {@link EXAMPLE_RAISED_PERCENT} of that goal as raised.
 */
export function exampleFigures(settings: SettingsReading, locale: Locale): FundraiserFigures {
  const goalStroops = balanceToStroops(settings.ok ? settings.goal.toFixed(7) : EXAMPLE_GOAL) ?? BigInt(0);
  const raisedStroops = (goalStroops * BigInt(EXAMPLE_RAISED_PERCENT)) / BigInt(100);
  const goal = formatTestMoney(goalStroops);
  const raised = formatTestMoney(raisedStroops);
  return {
    raised: inTestMoney(raised, locale) ?? raised,
    goal: inTestMoney(goal, locale) ?? goal,
    endsOn: settings.ok ? readableEndDate(settings.deadline, locale) : null,
    status: t('fundraiser.stateNotPublished', locale),
    percent: percentRaised(raised, goal),
  };
}
