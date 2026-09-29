/**
 * Stellar's test network, and nothing else.
 *
 * Every other file in `lib/stellar/` takes its addresses and its network name
 * from here. The network name (the "passphrase" that is mixed into every
 * signature) is a constant, never a parameter: nothing this app builds, signs or
 * sends can be meant for any other Stellar network, because nothing can ask for
 * one.
 *
 * Also here, because every other file needs them: the checks for a Stellar
 * address, a contract address and a change's reference code, the links to the
 * public explorer, and test money written as text versus counted in its
 * smallest unit (a "stroop": one ten-millionth).
 *
 * Nothing in this file reaches the network.
 */

import { Keypair, StrKey, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

/** The name Stellar's test network signs under. Never changes, never configurable. */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** The test network's public services. */
export const TESTNET = Object.freeze({
  passphrase: TESTNET_PASSPHRASE,
  /** Accounts, balances and classic payments. */
  horizonUrl: 'https://horizon-testnet.stellar.org',
  /** Contracts: reads by simulation, and sending signed changes. */
  rpcUrl: 'https://soroban-testnet.stellar.org',
  /** Hands out free test money to a new account. */
  friendbotUrl: 'https://friendbot.stellar.org',
  /** The public explorer, where anyone can check what happened. */
  explorerUrl: 'https://stellar.expert/explorer/testnet',
});

/** Thrown by {@link assertTestnet} for any network name but the test network's. */
export class NotTestnetError extends Error {
  readonly code = 'not-testnet';

  constructor() {
    super('This app only works on Stellar’s test network.');
    this.name = 'NotTestnetError';
  }
}

/** Whether `passphrase` is exactly the test network's name. */
export function isTestnet(passphrase: unknown): passphrase is typeof TESTNET_PASSPHRASE {
  return passphrase === TESTNET_PASSPHRASE;
}

/** Refuses, with a {@link NotTestnetError}, anything but the test network's name. */
export function assertTestnet(passphrase: unknown): asserts passphrase is typeof TESTNET_PASSPHRASE {
  if (!isTestnet(passphrase)) throw new NotTestnetError();
}

/*
 * Every reason a call in `lib/stellar/` can answer "no". A page turns each one
 * into words from `lib/i18n/locales/` (one key per reason); a reason is never a
 * sentence itself.
 */
export const STELLAR_PROBLEMS = Object.freeze([
  // What was handed in.
  'invalid-address',
  'invalid-contract-id',
  'invalid-amount',
  // Reaching the network.
  'unreachable',
  'busy',
  'unexpected-answer',
  // Accounts and money.
  'not-funded',
  'destination-not-funded',
  'not-enough-test-money',
  'below-minimum',
  // The wallet.
  'open-in-browser',
  'wallet-missing',
  'declined',
  'wrong-network',
  'wrong-account',
  'wallet-error',
  // Signing and sending.
  'not-a-transaction',
  'not-signed-for-testnet',
  'out-of-date',
  'expired',
  'fee-too-low',
  'bad-signature',
  'rejected',
  'still-pending',
  // The contract.
  'contract-missing',
  'not-a-fundraiser',
  'archived',
  'contract-refused',
  'goal-not-positive',
  'deadline-in-past',
  'amount-not-positive',
  'ended',
  'not-ended',
  'goal-not-reached',
  'goal-reached',
  'already-withdrawn',
  'nothing-to-refund',
  'overflow',
  'paused',
  'self-contribution',
  'beneficiary-is-contract',
] as const);

/** One reason from {@link STELLAR_PROBLEMS}. */
export type StellarProblem = (typeof STELLAR_PROBLEMS)[number];

/* ------------------------------------------------------------------------ */
/* Addresses                                                                */
/* ------------------------------------------------------------------------ */

const ACCOUNT_SHAPE = /^G[A-Z2-7]{55}$/;
const CONTRACT_SHAPE = /^C[A-Z2-7]{55}$/;
const HASH_SHAPE = /^[0-9a-f]{64}$/;

/** A Stellar account address: `G` and 55 more characters, with a valid checksum. */
export function isAccountAddress(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_SHAPE.test(value) && StrKey.isValidEd25519PublicKey(value);
}

/** A contract address: `C` and 55 more characters, with a valid checksum. */
export function isContractAddress(value: unknown): value is string {
  return typeof value === 'string' && CONTRACT_SHAPE.test(value) && StrKey.isValidContract(value);
}

/** A change's reference code (its hash): 64 lowercase hexadecimal characters. */
export function isTransactionHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_SHAPE.test(value);
}

/** The explorer page of an account, or `null` when `address` is not a valid `G...` address. */
export function explorerAccountUrl(address: unknown): string | null {
  return isAccountAddress(address) ? `${TESTNET.explorerUrl}/account/${address}` : null;
}

/** The explorer page of a contract, or `null` when `contractId` is not a valid `C...` address. */
export function explorerContractUrl(contractId: unknown): string | null {
  return isContractAddress(contractId) ? `${TESTNET.explorerUrl}/contract/${contractId}` : null;
}

/** The explorer page of one change, or `null` when `hash` is not 64 lowercase hex characters. */
export function explorerTxUrl(hash: unknown): string | null {
  return isTransactionHash(hash) ? `${TESTNET.explorerUrl}/tx/${hash}` : null;
}

/* ------------------------------------------------------------------------ */
/* Test money                                                               */
/* ------------------------------------------------------------------------ */

/** Stroops in one unit of test money. `BigInt(...)`, not a literal: the kit's TypeScript targets ES2017. */
export const STROOPS_PER_UNIT = BigInt(10_000_000);

/** The most one payment can carry: the network's 64-bit limit, in stroops. */
export const MAX_STROOPS = BigInt('9223372036854775807');

/** Up to 12 whole digits (the 64-bit limit is 922,337,203,685 units) and up to 7 decimals. */
const AMOUNT_TEXT = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,7}))?$/;

function decimalToStroops(text: string): bigint | null {
  const match = AMOUNT_TEXT.exec(text);
  if (match === null) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(7, '0'));
  const stroops = whole * STROOPS_PER_UNIT + fraction;
  return stroops > MAX_STROOPS ? null : stroops;
}

/**
 * An amount of test money, counted in stroops; `null` for anything that is not a
 * positive amount with at most 7 decimals.
 *
 * Text is read exactly as written ("12.5", never "12,5", " 12.5", "1e3" or
 * "-1"). A number is accepted only when it has at most 7 decimals, so 0.1 is
 * fine and 0.12345678 is refused rather than silently rounded.
 */
export function toStroops(amount: unknown): bigint | null {
  let text: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    text = amount.toFixed(7);
    if (Number(text) !== amount) return null;
  } else if (typeof amount === 'string') {
    text = amount;
  } else {
    return null;
  }
  const stroops = decimalToStroops(text);
  return stroops === null || stroops <= BigInt(0) ? null : stroops;
}

/** Stroops written as test money, without trailing zeros: 125000000 → "12.5". */
export function formatTestMoney(stroops: bigint): string {
  const negative = stroops < BigInt(0);
  const size = negative ? -stroops : stroops;
  const whole = size / STROOPS_PER_UNIT;
  const fraction = (size % STROOPS_PER_UNIT).toString().padStart(7, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction === '' ? '' : `.${fraction}`}`;
}

/** An amount as Horizon writes it ("10000.0000000"), including zero, as stroops. `null` if it is not one. */
export function balanceToStroops(text: unknown): bigint | null {
  return typeof text === 'string' ? decimalToStroops(text) : null;
}

/* ------------------------------------------------------------------------ */
/* Where the services are                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Other addresses for the test network's services. **For this project's own
 * checks only**: a page never passes one, and the network name cannot be changed
 * through it (there is no field for it, and an unknown field is refused).
 *
 * An override may only name this computer (`127.0.0.1`, `localhost`, `[::1]`)
 * or a name that can never exist on the internet (`*.test`, `*.invalid`,
 * `*.localhost`), so it cannot point this library at a real service of another
 * network either.
 */
export type Endpoints = {
  readonly horizonUrl?: string;
  readonly rpcUrl?: string;
  readonly friendbotUrl?: string;
  /** How long to wait between two checks on a sent change, in milliseconds. */
  readonly pollIntervalMs?: number;
};

/** The addresses a call uses, after overrides. */
export type ResolvedEndpoints = {
  readonly horizonUrl: string;
  readonly rpcUrl: string;
  readonly friendbotUrl: string;
  readonly pollIntervalMs: number;
  /** Whether the RPC address is plain `http:` (only ever a check's local stand-in). */
  readonly rpcAllowsHttp: boolean;
};

const ENDPOINT_KEYS: readonly string[] = Object.freeze(['horizonUrl', 'rpcUrl', 'friendbotUrl', 'pollIntervalMs']);

const DEFAULT_POLL_INTERVAL_MS = 1_000;

function overrideUrl(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a web address`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} is not a web address`);
  }
  const host = url.hostname;
  const local = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  const reserved = host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.localhost');
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !(local || reserved)) {
    throw new TypeError(`${name} may only point at this computer or a reserved test name`);
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new TypeError(`${name} may not carry a user name, a query or a fragment`);
  }
  return url.href.replace(/\/$/, '');
}

/** The test network's addresses, or a check's stand-ins for them (see {@link Endpoints}). */
export function resolveEndpoints(overrides?: Endpoints): ResolvedEndpoints {
  if (overrides === undefined) {
    return {
      horizonUrl: TESTNET.horizonUrl,
      rpcUrl: TESTNET.rpcUrl,
      friendbotUrl: TESTNET.friendbotUrl,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      rpcAllowsHttp: false,
    };
  }
  if (typeof overrides !== 'object' || overrides === null) throw new TypeError('endpoints must be an object');
  for (const key of Object.keys(overrides)) {
    if (!ENDPOINT_KEYS.includes(key)) throw new TypeError(`endpoints cannot set ${key}`);
  }
  const rpcUrl = overrides.rpcUrl === undefined ? TESTNET.rpcUrl : overrideUrl(overrides.rpcUrl, 'rpcUrl');
  const interval = overrides.pollIntervalMs;
  if (interval !== undefined && (!Number.isInteger(interval) || interval < 0 || interval > 60_000)) {
    throw new TypeError('pollIntervalMs must be a whole number of milliseconds, at most a minute');
  }
  return {
    horizonUrl: overrides.horizonUrl === undefined ? TESTNET.horizonUrl : overrideUrl(overrides.horizonUrl, 'horizonUrl'),
    rpcUrl,
    friendbotUrl:
      overrides.friendbotUrl === undefined ? TESTNET.friendbotUrl : overrideUrl(overrides.friendbotUrl, 'friendbotUrl'),
    pollIntervalMs: interval ?? DEFAULT_POLL_INTERVAL_MS,
    rpcAllowsHttp: rpcUrl.startsWith('http:'),
  };
}

/* ------------------------------------------------------------------------ */
/* Signed changes                                                           */
/* ------------------------------------------------------------------------ */

/** A signed change, read back and checked before it is sent anywhere. */
export type SignedTransactionCheck =
  | { readonly ok: true; readonly transaction: Transaction; readonly hash: string }
  | { readonly ok: false; readonly reason: 'not-a-transaction' | 'not-signed-for-testnet' };

/**
 * Reads a signed change and checks that its own account signed it **for the test
 * network**. A signature made for any other network does not verify against the
 * test network's hash, so a wallet that is set to another network is caught
 * here, before anything is sent.
 */
export function readSignedTransaction(signedXdr: unknown): SignedTransactionCheck {
  if (typeof signedXdr !== 'string' || signedXdr.length === 0 || signedXdr.length > 200_000) {
    return { ok: false, reason: 'not-a-transaction' };
  }
  let decoded: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    decoded = TransactionBuilder.fromXDR(signedXdr, TESTNET_PASSPHRASE);
  } catch {
    return { ok: false, reason: 'not-a-transaction' };
  }
  if (!(decoded instanceof Transaction) || !isAccountAddress(decoded.source)) {
    return { ok: false, reason: 'not-a-transaction' };
  }
  const hash = decoded.hash();
  const signer = Keypair.fromPublicKey(decoded.source);
  const signed = decoded.signatures.some((entry) => {
    try {
      return signer.verify(hash, entry.signature());
    } catch {
      return false;
    }
  });
  if (!signed) return { ok: false, reason: 'not-signed-for-testnet' };
  return { ok: true, transaction: decoded, hash: hash.toString('hex') };
}
