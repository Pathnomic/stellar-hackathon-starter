/**
 * The two files that describe this app's fundraiser, read and checked.
 *
 *  - `stellar/deployment.json` records the published fundraising contract. Tellop
 *    writes it when the person publishes from Tellop; outside Tellop, whoever
 *    publishes writes it (README.md). Until then it does not exist, and the app
 *    shows its fundraiser as a preview ("not published yet"). App code never
 *    writes or edits it.
 *  - `stellar/fundraiser.settings.json` says what the next publish will set up:
 *    the goal, the end date and who receives the money. This one may be edited
 *    (the goal, the date, the beneficiary), and Tellop checks it again before it
 *    publishes. After publishing, the contract itself is the truth: read it with
 *    `readFundraiser`.
 *
 * Both are checked field by field and key by key: a missing field, an extra
 * field or a value of the wrong shape means "not usable", with a reason, and
 * never a guess. The checks are pure functions of the parsed JSON, so they run
 * the same in the browser, on the server and in a check. Reading the files from
 * disk is in `server.ts`, which only server code may import.
 */

import { isAccountAddress, isContractAddress, isTransactionHash, toStroops } from './network.ts';

/** Where the published contract's details are recorded, from the project folder. */
export const DEPLOYMENT_FILE = 'stellar/deployment.json';

/** Where the fundraiser's settings live, from the project folder. */
export const SETTINGS_FILE = 'stellar/fundraiser.settings.json';

/** The largest file either reader accepts. Both are a few hundred bytes. */
export const MAX_FILE_BYTES = 64 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): 'ok' | 'unexpected-keys' | 'missing-keys' {
  const present = Object.keys(value);
  if (present.some((key) => !keys.includes(key))) return 'unexpected-keys';
  if (keys.some((key) => !Object.hasOwn(value, key))) return 'missing-keys';
  return 'ok';
}

/** A moment in UTC, the way `Date.prototype.toISOString` writes it (milliseconds optional). */
const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

/** A calendar date, `YYYY-MM-DD`. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A moment with an explicit offset, `YYYY-MM-DDTHH:MM[:SS[.sss]](Z|+HH:MM|-HH:MM)`. */
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

/** Whether year, month and day name a real day (so "2026-02-30" does not quietly become March). */
function realDay(year: string, month: string, day: string): boolean {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
  );
}

function instantMs(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const match = ISO_INSTANT.exec(text);
  if (match === null || !realDay(match[1], match[2], match[3])) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/* ------------------------------------------------------------------------ */
/* stellar/deployment.json                                                  */
/* ------------------------------------------------------------------------ */

export type Deployment = {
  readonly published: true;
  readonly network: 'testnet';
  /** The fundraising contract's address (`C...`). */
  readonly contractId: string;
  /** The app's own Stellar account, which published the contract (`G...`). */
  readonly accountAddress: string;
  /** SHA-256 of the exact contract program Tellop published. */
  readonly wasmSha256: string;
  /** When it was published (ISO 8601, UTC). */
  readonly publishedAt: string;
  /** The two changes that published it: uploading the program, and creating the contract. */
  readonly transactions: { readonly upload: string; readonly create: string };
};

export type DeploymentProblem =
  | 'missing'
  | 'too-large'
  | 'not-json'
  | 'not-an-object'
  | 'unexpected-keys'
  | 'missing-keys'
  | 'wrong-network'
  | 'bad-contract-id'
  | 'bad-account-address'
  | 'bad-wasm-hash'
  | 'bad-published-at'
  | 'bad-transactions';

export type DeploymentReading = Deployment | { readonly published: false; readonly reason: DeploymentProblem };

const DEPLOYMENT_KEYS = Object.freeze(['network', 'contractId', 'accountAddress', 'wasmSha256', 'publishedAt', 'transactions']);
const TRANSACTION_KEYS = Object.freeze(['upload', 'create']);

/** Checks the parsed contents of `stellar/deployment.json`. Anything but the exact shape is "not published". */
export function parseDeployment(value: unknown): DeploymentReading {
  const no = (reason: DeploymentProblem): DeploymentReading => ({ published: false, reason });
  if (!isPlainObject(value)) return no('not-an-object');
  const keys = hasExactly(value, DEPLOYMENT_KEYS);
  if (keys !== 'ok') return no(keys);
  if (value.network !== 'testnet') return no('wrong-network');
  if (!isContractAddress(value.contractId)) return no('bad-contract-id');
  if (!isAccountAddress(value.accountAddress)) return no('bad-account-address');
  if (!isTransactionHash(value.wasmSha256)) return no('bad-wasm-hash');
  if (instantMs(value.publishedAt) === null) return no('bad-published-at');
  const transactions = value.transactions;
  if (
    !isPlainObject(transactions) ||
    hasExactly(transactions, TRANSACTION_KEYS) !== 'ok' ||
    !isTransactionHash(transactions.upload) ||
    !isTransactionHash(transactions.create)
  ) {
    return no('bad-transactions');
  }
  return {
    published: true,
    network: 'testnet',
    contractId: value.contractId,
    accountAddress: value.accountAddress,
    wasmSha256: value.wasmSha256,
    publishedAt: value.publishedAt as string,
    transactions: { upload: transactions.upload, create: transactions.create },
  };
}

/** Checks the text of `stellar/deployment.json`; `null` or `undefined` means the file is not there. */
export function readDeploymentText(text: string | null | undefined): DeploymentReading {
  if (text === null || text === undefined) return { published: false, reason: 'missing' };
  if (text.length > MAX_FILE_BYTES) return { published: false, reason: 'too-large' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { published: false, reason: 'not-json' };
  }
  return parseDeployment(value);
}

/* ------------------------------------------------------------------------ */
/* stellar/fundraiser.settings.json                                         */
/* ------------------------------------------------------------------------ */

/**
 * The limits a settings file must stay within. Tellop applies the same limits
 * again before it publishes.
 */
export const SETTINGS_LIMITS = Object.freeze({
  /** The largest goal, in test money. */
  maxGoal: 1_000_000_000,
  /** How far ahead the end may be, in days from now. */
  maxDays: 90,
});

const DAY_MS = 24 * 60 * 60 * 1000;

export type Settings = {
  readonly ok: true;
  /** The goal, in test money, exactly as written in the file. */
  readonly goal: number;
  /** When the fundraiser ends, as an ISO 8601 moment in UTC. */
  readonly endsAt: string;
  /** The same moment in seconds since 1970 (UTC): what the contract is given. */
  readonly deadline: number;
  /** `app-account` (the app's own Stellar account receives the money) or a `G...` address. */
  readonly beneficiary: string;
};

export type SettingsProblem =
  | 'missing'
  | 'too-large'
  | 'not-json'
  | 'not-an-object'
  | 'unexpected-keys'
  | 'missing-keys'
  | 'bad-goal'
  | 'goal-too-large'
  | 'bad-end-date'
  | 'ends-in-past'
  | 'ends-too-late'
  | 'bad-beneficiary';

export type SettingsReading = Settings | { readonly ok: false; readonly reason: SettingsProblem };

const SETTINGS_KEYS = Object.freeze(['goal', 'endsAt', 'beneficiary']);

/**
 * When `endsAt` ends, in milliseconds since 1970, or `null` if it is not a date.
 *
 * A date alone ("2026-11-15") means the fundraiser runs through that whole day
 * in UTC: it ends at the next midnight, UTC. A moment needs its offset
 * ("2026-11-15T18:00:00Z", "2026-11-15T21:00+03:00").
 */
function endMs(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const date = ISO_DATE.exec(text);
  if (date !== null) {
    if (!realDay(date[1], date[2], date[3])) return null;
    return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3])) + DAY_MS;
  }
  const moment = ISO_DATE_TIME.exec(text);
  if (moment === null || !realDay(moment[1], moment[2], moment[3])) return null;
  if (Number(moment[4]) > 23 || Number(moment[5]) > 59 || Number(moment[6] ?? '0') > 59) return null;
  const offset = moment[8];
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Checks the parsed contents of `stellar/fundraiser.settings.json` against
 * `now` (for "the end is ahead, and at most 90 days ahead").
 *
 * The goal is a number of test money units, positive, with at most 7 decimals
 * and at most {@link SETTINGS_LIMITS}`.maxGoal`. The beneficiary is the word
 * `app-account` or a valid `G...` address.
 */
export function parseSettings(value: unknown, now: Date = new Date()): SettingsReading {
  const no = (reason: SettingsProblem): SettingsReading => ({ ok: false, reason });
  if (!isPlainObject(value)) return no('not-an-object');
  const keys = hasExactly(value, SETTINGS_KEYS);
  if (keys !== 'ok') return no(keys);
  const goal = value.goal;
  if (typeof goal !== 'number' || toStroops(goal) === null) return no('bad-goal');
  if (goal > SETTINGS_LIMITS.maxGoal) return no('goal-too-large');
  const ends = endMs(value.endsAt);
  if (ends === null) return no('bad-end-date');
  const nowMs = now.getTime();
  if (ends <= nowMs) return no('ends-in-past');
  if (ends > nowMs + SETTINGS_LIMITS.maxDays * DAY_MS) return no('ends-too-late');
  const beneficiary = value.beneficiary;
  if (beneficiary !== 'app-account' && !isAccountAddress(beneficiary)) return no('bad-beneficiary');
  return {
    ok: true,
    goal,
    endsAt: new Date(ends).toISOString(),
    deadline: Math.floor(ends / 1000),
    beneficiary: beneficiary as string,
  };
}

/** Checks the text of `stellar/fundraiser.settings.json`; `null` or `undefined` means the file is not there. */
export function readSettingsText(text: string | null | undefined, now: Date = new Date()): SettingsReading {
  if (text === null || text === undefined) return { ok: false, reason: 'missing' };
  if (text.length > MAX_FILE_BYTES) return { ok: false, reason: 'too-large' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  return parseSettings(value, now);
}
