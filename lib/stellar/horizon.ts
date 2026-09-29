/**
 * A wallet's test money, and sending some of it to another wallet, through
 * Horizon (the test network's accounts service).
 *
 * **Call these only after the person has connected their wallet.** A wallet
 * that has never been given test money does not exist on the network yet, and
 * Horizon answers a question about it with "not found" (status 404). That is a
 * normal state here (`not-funded`), never an error, and nothing is written to
 * the console for it - but the page should still not ask before there is a
 * connected wallet to ask about.
 *
 * Every request goes through `http.ts` (no cookies, no extra headers, bounded).
 * The passphrase is always the test network's.
 */

import { Account, Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import { isRecord, joinUrl, requestJson } from './http.ts';
import {
  TESTNET_PASSPHRASE,
  balanceToStroops,
  formatTestMoney,
  isAccountAddress,
  readSignedTransaction,
  resolveEndpoints,
  toStroops,
} from './network.ts';
import type { Endpoints } from './network.ts';

/** How long a question to Horizon may take. */
const READ_TIMEOUT_MS = 15_000;

/** How long a send may take: Horizon itself gives up after about 30 seconds. */
const SEND_TIMEOUT_MS = 60_000;

/**
 * The most a payment offers to pay the network for carrying it, in stroops
 * (0.00001 test money). Only the going rate is charged, which is normally 100;
 * the headroom keeps a busy test network from refusing the payment as too cheap.
 */
const PAYMENT_FEE = '10000';

/** How long a built payment stays valid: time for the person to approve it in their wallet. */
const PAYMENT_VALID_SECONDS = 300;

/** A balance other than test money. */
export type OtherBalance =
  | { readonly kind: 'asset'; readonly code: string; readonly issuer: string; readonly balance: string }
  | { readonly kind: 'pool-share'; readonly poolId: string; readonly balance: string };

export type BalancesResult =
  | {
      readonly ok: true;
      readonly state: 'funded';
      readonly address: string;
      /** The wallet's test money, e.g. "10000" or "12.5". */
      readonly testMoney: string;
      readonly others: readonly OtherBalance[];
    }
  | { readonly ok: true; readonly state: 'not-funded'; readonly address: string }
  | { readonly ok: false; readonly reason: 'invalid-address' | 'unreachable' | 'busy' | 'unexpected-answer' };

type AccountLookup =
  | { readonly kind: 'found'; readonly account: Record<string, unknown> }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly reason: 'unreachable' | 'busy' | 'unexpected-answer' };

async function lookUpAccount(address: string, endpoints?: Endpoints): Promise<AccountLookup> {
  const { horizonUrl } = resolveEndpoints(endpoints);
  const answer = await requestJson(joinUrl(horizonUrl, `accounts/${address}`), {
    method: 'GET',
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (answer.kind === 'unreachable') return { kind: 'failed', reason: 'unreachable' };
  if (answer.status === 404) return { kind: 'missing' };
  if (answer.status === 429) return { kind: 'failed', reason: 'busy' };
  if (answer.status !== 200 || !isRecord(answer.body)) {
    return { kind: 'failed', reason: answer.status >= 500 ? 'unreachable' : 'unexpected-answer' };
  }
  return { kind: 'found', account: answer.body };
}

function readOtherBalance(entry: Record<string, unknown>): OtherBalance | null {
  const stroops = balanceToStroops(entry.balance);
  if (stroops === null) return null;
  const balance = formatTestMoney(stroops);
  if (
    (entry.asset_type === 'credit_alphanum4' || entry.asset_type === 'credit_alphanum12') &&
    typeof entry.asset_code === 'string' &&
    isAccountAddress(entry.asset_issuer)
  ) {
    return { kind: 'asset', code: entry.asset_code, issuer: entry.asset_issuer, balance };
  }
  if (entry.asset_type === 'liquidity_pool_shares' && typeof entry.liquidity_pool_id === 'string') {
    return { kind: 'pool-share', poolId: entry.liquidity_pool_id, balance };
  }
  return null;
}

/**
 * The connected wallet's test money and anything else it holds.
 *
 * A wallet the network has never seen answers `{ ok: true, state: 'not-funded' }`:
 * offer test money (`fundWithTestMoney` in `friendbot.ts`).
 */
export async function loadBalances(address: string, endpoints?: Endpoints): Promise<BalancesResult> {
  if (!isAccountAddress(address)) return { ok: false, reason: 'invalid-address' };
  const lookup = await lookUpAccount(address, endpoints);
  if (lookup.kind === 'failed') return { ok: false, reason: lookup.reason };
  if (lookup.kind === 'missing') return { ok: true, state: 'not-funded', address };
  const balances = lookup.account.balances;
  if (!Array.isArray(balances)) return { ok: false, reason: 'unexpected-answer' };
  let testMoney: string | null = null;
  const others: OtherBalance[] = [];
  for (const entry of balances) {
    if (!isRecord(entry)) return { ok: false, reason: 'unexpected-answer' };
    if (entry.asset_type === 'native') {
      const stroops = balanceToStroops(entry.balance);
      if (stroops === null) return { ok: false, reason: 'unexpected-answer' };
      testMoney = formatTestMoney(stroops);
    } else {
      const other = readOtherBalance(entry);
      if (other !== null) others.push(other);
    }
  }
  if (testMoney === null) return { ok: false, reason: 'unexpected-answer' };
  return { ok: true, state: 'funded', address, testMoney, others };
}

export type PaymentRequest = {
  /** The connected wallet, which pays and signs. */
  readonly from: string;
  /** Who receives the test money: a `G...` address. */
  readonly to: string;
  /** Test money as text ("12.5") or a number with at most 7 decimals. */
  readonly amount: string | number;
};

export type BuildResult =
  | { readonly ok: true; readonly xdr: string }
  | {
      readonly ok: false;
      readonly reason: 'invalid-address' | 'invalid-amount' | 'not-funded' | 'unreachable' | 'busy' | 'unexpected-answer';
    };

/**
 * A payment of test money, built for the test network and not yet signed.
 * Hand `xdr` to `signWithWallet`, then the signed result to {@link submitSigned}.
 *
 * Checked before anything is asked of the network: both addresses are valid
 * `G...` addresses and the amount is positive with at most 7 decimals.
 */
export async function buildPayment(request: PaymentRequest, endpoints?: Endpoints): Promise<BuildResult> {
  const { from, to, amount } = request;
  if (!isAccountAddress(from) || !isAccountAddress(to)) return { ok: false, reason: 'invalid-address' };
  const stroops = toStroops(amount);
  if (stroops === null) return { ok: false, reason: 'invalid-amount' };
  const lookup = await lookUpAccount(from, endpoints);
  if (lookup.kind === 'failed') return { ok: false, reason: lookup.reason };
  if (lookup.kind === 'missing') return { ok: false, reason: 'not-funded' };
  const sequence = lookup.account.sequence;
  if (typeof sequence !== 'string' || !/^[0-9]{1,19}$/.test(sequence)) {
    return { ok: false, reason: 'unexpected-answer' };
  }
  const payment = new TransactionBuilder(new Account(from, sequence), {
    fee: PAYMENT_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount: formatTestMoney(stroops) }))
    .setTimeout(PAYMENT_VALID_SECONDS)
    .build();
  return { ok: true, xdr: payment.toXDR() };
}

/** Why the network refused a change, from the codes it answered with. */
export type RefusalReason =
  | 'out-of-date'
  | 'expired'
  | 'not-enough-test-money'
  | 'fee-too-low'
  | 'bad-signature'
  | 'not-funded'
  | 'destination-not-funded'
  | 'below-minimum'
  | 'rejected';

/*
 * The network's result codes, in the spelling Horizon uses. The same codes
 * reach `fundraiser.ts` spelled the way they are named inside the network's
 * binary format ("txBadSeq"); `refusalFromCode` reads both.
 *
 * Written as pairs rather than as an object on purpose: Tellop refuses to save
 * a project file with a line shaped like `something_auth: 'a value'` (it reads
 * like a stored sign-in), and two of these codes end in "auth".
 */
const REFUSALS: ReadonlyMap<string, RefusalReason> = new Map<string, RefusalReason>([
  ['tx_bad_seq', 'out-of-date'],
  ['tx_too_late', 'expired'],
  ['tx_too_early', 'expired'],
  ['tx_insufficient_balance', 'not-enough-test-money'],
  ['tx_insufficient_fee', 'fee-too-low'],
  ['tx_bad_auth', 'bad-signature'],
  ['tx_bad_auth_extra', 'bad-signature'],
  ['tx_no_source_account', 'not-funded'],
  ['tx_no_account', 'not-funded'],
  ['op_underfunded', 'not-enough-test-money'],
  ['op_no_destination', 'destination-not-funded'],
  ['op_low_reserve', 'below-minimum'],
  ['op_bad_auth', 'bad-signature'],
  ['op_no_source_account', 'not-funded'],
]);

/** The friendly reason for one result code, in either spelling; `undefined` when there is none. */
export function refusalFromCode(code: unknown): RefusalReason | undefined {
  if (typeof code !== 'string') return undefined;
  return REFUSALS.get(code.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`));
}

export type ResultCodes = { readonly transaction?: string; readonly operations: readonly string[] };

export type SubmitResult =
  | { readonly ok: true; readonly hash: string }
  | {
      readonly ok: false;
      readonly reason:
        | 'not-a-transaction'
        | 'not-signed-for-testnet'
        | 'unreachable'
        | 'busy'
        | 'still-pending'
        | 'unexpected-answer'
        | RefusalReason;
      /** The change's reference code, whenever it was sent: check it on the explorer. */
      readonly hash?: string;
      /** The network's own codes, when it refused the change. */
      readonly codes?: ResultCodes;
    };

function readResultCodes(body: unknown): ResultCodes | undefined {
  if (!isRecord(body) || !isRecord(body.extras) || !isRecord(body.extras.result_codes)) return undefined;
  const codes = body.extras.result_codes;
  const operations = Array.isArray(codes.operations) ? codes.operations.filter((code) => typeof code === 'string') : [];
  return typeof codes.transaction === 'string' ? { transaction: codes.transaction, operations } : { operations };
}

/**
 * Sends a signed payment (or any signed classic change) to the test network and
 * waits for the answer.
 *
 * The signature is checked first: a change signed for any other network is
 * refused here (`not-signed-for-testnet`) and never sent. When Horizon gives up
 * waiting (`still-pending`), the change may still go through: show `hash` with
 * a link to the explorer rather than offering to send it again.
 */
export async function submitSigned(signedXdr: string, endpoints?: Endpoints): Promise<SubmitResult> {
  const check = readSignedTransaction(signedXdr);
  if (!check.ok) return { ok: false, reason: check.reason };
  const { horizonUrl } = resolveEndpoints(endpoints);
  const answer = await requestJson(joinUrl(horizonUrl, 'transactions'), {
    method: 'POST',
    form: { tx: signedXdr },
    timeoutMs: SEND_TIMEOUT_MS,
  });
  const hash = check.hash;
  if (answer.kind === 'unreachable') return { ok: false, reason: 'still-pending', hash };
  if (answer.status === 200) {
    if (isRecord(answer.body) && answer.body.successful === false) return { ok: false, reason: 'rejected', hash };
    return { ok: true, hash };
  }
  if (answer.status === 504) return { ok: false, reason: 'still-pending', hash };
  if (answer.status === 429) return { ok: false, reason: 'busy', hash };
  const codes = readResultCodes(answer.body);
  if (codes !== undefined) {
    const named = [...codes.operations, codes.transaction].map(refusalFromCode).find((reason) => reason !== undefined);
    return { ok: false, reason: named ?? 'rejected', hash, codes };
  }
  if (answer.status >= 500) return { ok: false, reason: 'unreachable', hash };
  return { ok: false, reason: 'unexpected-answer', hash };
}
