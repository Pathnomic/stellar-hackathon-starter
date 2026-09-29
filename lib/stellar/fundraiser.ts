/**
 * The fundraising contract: reading where it stands, and preparing, sending and
 * confirming the three things a person can do with it.
 *
 *  - {@link readFundraiser} reads the goal, the end, the total raised, the state
 *    and whether it is paused or already paid out, by *simulating* the
 *    contract's read-only calls. Nothing is signed and nothing costs anything.
 *    It is the one Stellar request a page may make while it loads, and only
 *    when a contract has been published (`stellar/deployment.json`).
 *  - {@link buildContribute}, {@link buildWithdraw} and {@link buildRefund}
 *    prepare a change for the connected wallet to sign: the network works out
 *    what it will touch and cost (a simulation), and the answer is folded into
 *    the change. A refusal the contract would make is found here, before the
 *    person is asked to sign anything, and comes back as a named reason.
 *  - {@link sendSigned} sends what the wallet signed and waits, for a bounded
 *    time, until the network says it went through or failed.
 *
 * Every answer is `{ ok: true, ... }` or `{ ok: false, reason }`, where `reason`
 * is one of `STELLAR_PROBLEMS` (`network.ts`); nothing here throws for a state a
 * person can be in, and nothing writes to the console.
 *
 * All of it goes to the test network's RPC service through the Stellar SDK,
 * with the SDK's own identifying headers removed (fewer headers for the
 * browser's cross-site check to ask about), no cookies, no redirects, a
 * bounded wait and a bounded answer size.
 */

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';

import { isRecord } from './http.ts';
import {
  TESTNET_PASSPHRASE,
  formatTestMoney,
  isAccountAddress,
  isContractAddress,
  readSignedTransaction,
  resolveEndpoints,
  toStroops,
} from './network.ts';
import type { Endpoints } from './network.ts';
import { refusalFromCode } from './horizon.ts';
import type { RefusalReason } from './horizon.ts';

/* ------------------------------------------------------------------------ */
/* The contract's own refusals                                              */
/* ------------------------------------------------------------------------ */

/**
 * The contract's numbered refusals (`contracts/fundraiser/src/lib.rs`, `Error`),
 * by the name a page shows words for.
 */
export const FUNDRAISER_ERRORS = Object.freeze({
  100: 'goal-not-positive',
  101: 'deadline-in-past',
  102: 'amount-not-positive',
  103: 'ended',
  104: 'not-ended',
  105: 'goal-not-reached',
  106: 'goal-reached',
  107: 'already-withdrawn',
  108: 'nothing-to-refund',
  109: 'overflow',
  110: 'paused',
  111: 'self-contribution',
  112: 'beneficiary-is-contract',
} as const);

export type FundraiserErrorName = (typeof FUNDRAISER_ERRORS)[keyof typeof FUNDRAISER_ERRORS];

/** The name of one of the contract's refusals, or `undefined` for any other number. */
export function fundraiserErrorName(code: unknown): FundraiserErrorName | undefined {
  if (typeof code !== 'number' || !Object.hasOwn(FUNDRAISER_ERRORS, code)) return undefined;
  return FUNDRAISER_ERRORS[code as keyof typeof FUNDRAISER_ERRORS];
}

/**
 * The test money contract's own refusal for "not enough money". It comes
 * through the fundraiser unchanged when a supporter gives more than they have.
 */
const NOT_ENOUGH_MONEY_CODE = 10;

type ContractRefusal = FundraiserErrorName | 'not-enough-test-money' | 'contract-refused';

function refusalFromContractCode(code: number): ContractRefusal {
  return fundraiserErrorName(code) ?? (code === NOT_ENOUGH_MONEY_CODE ? 'not-enough-test-money' : 'contract-refused');
}

/** The number in "Error(Contract, #107)", the way the network writes a contract's refusal. */
function contractCodeInText(text: string): number | undefined {
  const match = /Error\(Contract, #(\d+)\)/.exec(text);
  return match === null ? undefined : Number(match[1]);
}

/** A contract's refusal recorded in the network's diagnostic events, if one is there. */
function contractCodeInEvents(events: readonly unknown[] | undefined): number | undefined {
  for (const raw of events ?? []) {
    try {
      const event = typeof raw === 'string' ? xdr.DiagnosticEvent.fromXDR(raw, 'base64') : raw;
      if (!(event instanceof xdr.DiagnosticEvent)) continue;
      const body = event.event().body().v0();
      for (const value of [...body.topics(), body.data()]) {
        if (value.switch().name === 'scvError' && value.error().switch().name === 'sceContract') {
          return value.error().contractCode();
        }
      }
    } catch {
      // An event this version cannot read tells us nothing; keep looking.
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* The RPC service                                                          */
/* ------------------------------------------------------------------------ */

/** How long one question to the RPC service may take. */
const RPC_TIMEOUT_MS = 20_000;

/** The largest answer read from the RPC service. */
const RPC_MAX_ANSWER_BYTES = 5_000_000;

/** How many times {@link sendSigned} asks whether a sent change went through. */
const POLL_ATTEMPTS = 30;

/** How long a prepared change stays valid: time for the person to approve it in their wallet. */
const CALL_VALID_SECONDS = 300;

/**
 * The account every read-only simulation names as its sender: the all-zero
 * key, which nobody can sign for. The Stellar SDK uses the same one for reads
 * (`contract.NULL_ACCOUNT`). A simulation never checks that it exists, and
 * nothing built with it is ever signed or sent.
 */
export const READ_ONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

type Connection = { readonly server: rpc.Server; readonly pollIntervalMs: number };

function connect(endpoints?: Endpoints): Connection {
  const resolved = resolveEndpoints(endpoints);
  const server = new rpc.Server(resolved.rpcUrl, { allowHttp: resolved.rpcAllowsHttp });
  const defaults = server.httpClient.defaults;
  const headers = defaults.headers;
  if (headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)) {
    // The SDK names itself on every request. Those two extra headers are all the
    // browser's cross-site check would have to ask the service about besides the
    // JSON body, so they are left off.
    delete headers['X-Client-Name'];
    delete headers['X-Client-Version'];
  }
  defaults.timeout = RPC_TIMEOUT_MS;
  defaults.maxContentLength = RPC_MAX_ANSWER_BYTES;
  defaults.maxRedirects = 0;
  defaults.fetchOptions = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  return { server, pollIntervalMs: resolved.pollIntervalMs };
}

type NetworkProblem = 'unreachable' | 'busy' | 'unexpected-answer';

/**
 * What went wrong when the service could not be asked. The SDK throws three
 * kinds of thing: an error carrying the service's HTTP answer, a plain `Error`
 * when there was no answer at all (offline, refused, too slow, too large), and
 * the service's own JSON-RPC refusal as a plain object.
 */
function networkProblem(thrown: unknown): NetworkProblem {
  if (isRecord(thrown) && isRecord(thrown.response)) {
    const status = thrown.response.status;
    return status === 429 || status === 503 ? 'busy' : 'unreachable';
  }
  return thrown instanceof Error ? 'unreachable' : 'unexpected-answer';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type Simulated =
  | { readonly ok: true; readonly simulation: rpc.Api.SimulateTransactionSuccessResponse }
  | { readonly ok: false; readonly reason: NetworkProblem | 'archived' | 'contract-missing' | 'not-a-fundraiser' | ContractRefusal; readonly code?: number };

async function simulate(server: rpc.Server, transaction: Transaction): Promise<Simulated> {
  let raw: rpc.Api.RawSimulateTransactionResponse;
  try {
    raw = await server._simulateTransaction(transaction);
  } catch (thrown) {
    return { ok: false, reason: networkProblem(thrown) };
  }
  let simulation: rpc.Api.SimulateTransactionResponse;
  try {
    simulation = rpc.parseRawSimulation(raw);
  } catch {
    return { ok: false, reason: 'unexpected-answer' };
  }
  if (rpc.Api.isSimulationError(simulation)) {
    const text = typeof simulation.error === 'string' ? simulation.error : '';
    const code = contractCodeInText(text) ?? contractCodeInEvents(simulation.events);
    if (code !== undefined) return { ok: false, reason: refusalFromContractCode(code), code };
    if (text.includes('Error(Storage, MissingValue)')) return { ok: false, reason: 'contract-missing' };
    if (text.includes('Error(WasmVm, MissingValue)')) return { ok: false, reason: 'not-a-fundraiser' };
    return { ok: false, reason: 'unexpected-answer' };
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) return { ok: false, reason: 'unexpected-answer' };
  return { ok: true, simulation };
}

function call(contractId: string, source: string, sequence: string, name: string, args: readonly xdr.ScVal[]): Transaction {
  return new TransactionBuilder(new Account(source, sequence), { fee: BASE_FEE, networkPassphrase: TESTNET_PASSPHRASE })
    .addOperation(new Contract(contractId).call(name, ...args))
    .setTimeout(CALL_VALID_SECONDS)
    .build();
}

/* ------------------------------------------------------------------------ */
/* Reading                                                                  */
/* ------------------------------------------------------------------------ */

export type FundraiserState = 'running' | 'succeeded' | 'failed';

type ReadProblem = 'invalid-contract-id' | 'contract-missing' | 'not-a-fundraiser' | 'unreachable' | 'busy' | 'unexpected-answer';

export type FundraiserReading =
  | {
      readonly ok: true;
      readonly contractId: string;
      /** The goal, in test money ("250", "12.5"). */
      readonly goal: string;
      /** Everything given so far, in test money. Refunds and the payout do not lower it. */
      readonly total: string;
      /** When it ends, in seconds since 1970 (UTC): `new Date(deadline * 1000)`. */
      readonly deadline: number;
      readonly state: FundraiserState;
      /** New gifts are paused by the app's owner; payout and refunds still work. */
      readonly paused: boolean;
      /** The goal was reached and the money has been paid to the beneficiary. */
      readonly withdrawn: boolean;
      /** Who receives the money when the goal is reached (`G...`). */
      readonly beneficiary: string;
    }
  | { readonly ok: false; readonly reason: ReadProblem };

type ViewAnswer = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: ReadProblem };

async function readView(server: rpc.Server, contractId: string, name: string, args: readonly xdr.ScVal[] = []): Promise<ViewAnswer> {
  const simulated = await simulate(server, call(contractId, READ_ONLY_SOURCE, '0', name, args));
  if (!simulated.ok) {
    const reason = simulated.reason;
    const known = reason === 'contract-missing' || reason === 'not-a-fundraiser' || reason === 'unreachable' || reason === 'busy';
    return { ok: false, reason: known ? reason : 'unexpected-answer' };
  }
  const returned = simulated.simulation.result?.retval;
  if (returned === undefined) return { ok: false, reason: 'unexpected-answer' };
  try {
    return { ok: true, value: scValToNative(returned) };
  } catch {
    return { ok: false, reason: 'unexpected-answer' };
  }
}

const STATES: Readonly<Record<string, FundraiserState>> = Object.freeze({
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
});

function readState(value: unknown): FundraiserState | null {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string') return null;
  return Object.hasOwn(STATES, value[0]) ? STATES[value[0]] : null;
}

function isStellarAddress(value: unknown): value is string {
  return typeof value === 'string' && (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value));
}

/**
 * Where the published fundraiser stands. Seven read-only simulations, sent
 * together; the first that fails decides the answer.
 */
export async function readFundraiser(contractId: string, endpoints?: Endpoints): Promise<FundraiserReading> {
  if (!isContractAddress(contractId)) return { ok: false, reason: 'invalid-contract-id' };
  const { server } = connect(endpoints);
  const names = ['goal', 'total', 'deadline', 'state', 'is_paused', 'withdrawn', 'beneficiary'] as const;
  const answers = await Promise.all(names.map((name) => readView(server, contractId, name)));
  const values: unknown[] = [];
  for (const answer of answers) {
    if (!answer.ok) return { ok: false, reason: answer.reason };
    values.push(answer.value);
  }
  const [goal, total, deadline, state, paused, withdrawn, beneficiary] = values;
  const readable =
    typeof goal === 'bigint' &&
    goal > BigInt(0) &&
    typeof total === 'bigint' &&
    total >= BigInt(0) &&
    typeof deadline === 'bigint' &&
    deadline >= BigInt(0) &&
    deadline <= BigInt(Number.MAX_SAFE_INTEGER) &&
    typeof paused === 'boolean' &&
    typeof withdrawn === 'boolean' &&
    isStellarAddress(beneficiary);
  const named = readState(state);
  if (!readable || named === null) return { ok: false, reason: 'unexpected-answer' };
  return {
    ok: true,
    contractId,
    goal: formatTestMoney(goal),
    total: formatTestMoney(total),
    deadline: Number(deadline),
    state: named,
    paused,
    withdrawn,
    beneficiary,
  };
}

export type ContributionReading =
  | { readonly ok: true; readonly amount: string }
  | { readonly ok: false; readonly reason: ReadProblem | 'invalid-address' };

/** What `address` has given and not yet had back, in test money ("0" when nothing). */
export async function readContribution(contractId: string, address: string, endpoints?: Endpoints): Promise<ContributionReading> {
  if (!isContractAddress(contractId)) return { ok: false, reason: 'invalid-contract-id' };
  if (!isAccountAddress(address)) return { ok: false, reason: 'invalid-address' };
  const { server } = connect(endpoints);
  const answer = await readView(server, contractId, 'contribution', [new Address(address).toScVal()]);
  if (!answer.ok) return answer;
  if (typeof answer.value !== 'bigint' || answer.value < BigInt(0)) return { ok: false, reason: 'unexpected-answer' };
  return { ok: true, amount: formatTestMoney(answer.value) };
}

/* ------------------------------------------------------------------------ */
/* Preparing a change                                                       */
/* ------------------------------------------------------------------------ */

export type PreparedCall =
  | {
      readonly ok: true;
      /** The prepared change, unsigned. Hand it to `signWithWallet`, then to {@link sendSigned}. */
      readonly xdr: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid-contract-id'
        | 'invalid-address'
        | 'invalid-amount'
        | 'not-funded'
        | 'contract-missing'
        | 'not-a-fundraiser'
        | 'archived'
        | NetworkProblem
        | ContractRefusal;
      /** The contract's own number for its refusal, when it refused. */
      readonly code?: number;
    };

type SequenceLookup =
  | { readonly ok: true; readonly sequence: string }
  | { readonly ok: false; readonly reason: NetworkProblem | 'not-funded' };

/** The next change number of `address`, from the RPC service. A wallet the network has never seen is `not-funded`. */
async function currentSequence(server: rpc.Server, address: string): Promise<SequenceLookup> {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrAccountId() }));
  let raw: rpc.Api.RawGetLedgerEntriesResponse;
  try {
    raw = await server._getLedgerEntries(key);
  } catch (thrown) {
    return { ok: false, reason: networkProblem(thrown) };
  }
  const entries = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  if (entries.length === 0) return { ok: false, reason: 'not-funded' };
  try {
    return { ok: true, sequence: xdr.LedgerEntryData.fromXDR(entries[0].xdr, 'base64').account().seqNum().toString() };
  } catch {
    return { ok: false, reason: 'unexpected-answer' };
  }
}

async function prepare(
  endpoints: Endpoints | undefined,
  contractId: string,
  source: string,
  name: string,
  args: readonly xdr.ScVal[],
): Promise<PreparedCall> {
  const { server } = connect(endpoints);
  const account = await currentSequence(server, source);
  if (!account.ok) return account;
  const unprepared = call(contractId, source, account.sequence, name, args);
  const simulated = await simulate(server, unprepared);
  if (!simulated.ok) return simulated;
  if (rpc.Api.isSimulationRestore(simulated.simulation)) return { ok: false, reason: 'archived' };
  try {
    return { ok: true, xdr: rpc.assembleTransaction(unprepared, simulated.simulation).build().toXDR() };
  } catch {
    return { ok: false, reason: 'unexpected-answer' };
  }
}

export type ContributeRequest = {
  readonly contractId: string;
  /** The connected wallet: it gives the money and signs. */
  readonly from: string;
  /** Test money as text ("12.5") or a number with at most 7 decimals. */
  readonly amount: string | number;
};

/** Prepares giving `amount` of test money from the connected wallet to the fundraiser. */
export async function buildContribute(request: ContributeRequest, endpoints?: Endpoints): Promise<PreparedCall> {
  const { contractId, from, amount } = request;
  if (!isContractAddress(contractId)) return { ok: false, reason: 'invalid-contract-id' };
  if (!isAccountAddress(from)) return { ok: false, reason: 'invalid-address' };
  const stroops = toStroops(amount);
  if (stroops === null) return { ok: false, reason: 'invalid-amount' };
  return prepare(endpoints, contractId, from, 'contribute', [
    new Address(from).toScVal(),
    nativeToScVal(stroops, { type: 'i128' }),
  ]);
}

export type WithdrawRequest = {
  readonly contractId: string;
  /** The connected wallet, which pays the network's small fee. Anyone may ask; the money only goes to the beneficiary. */
  readonly source: string;
};

/** Prepares paying the whole raised amount to the beneficiary, once the goal was reached and the fundraiser has ended. */
export async function buildWithdraw(request: WithdrawRequest, endpoints?: Endpoints): Promise<PreparedCall> {
  const { contractId, source } = request;
  if (!isContractAddress(contractId)) return { ok: false, reason: 'invalid-contract-id' };
  if (!isAccountAddress(source)) return { ok: false, reason: 'invalid-address' };
  return prepare(endpoints, contractId, source, 'withdraw', []);
}

export type RefundRequest = {
  readonly contractId: string;
  /** The connected wallet, which pays the network's small fee. */
  readonly source: string;
  /** Whose money goes back. It can only ever go back to them. */
  readonly contributor: string;
};

/** Prepares giving `contributor` their money back, once the fundraiser ended without reaching its goal. */
export async function buildRefund(request: RefundRequest, endpoints?: Endpoints): Promise<PreparedCall> {
  const { contractId, source, contributor } = request;
  if (!isContractAddress(contractId)) return { ok: false, reason: 'invalid-contract-id' };
  if (!isAccountAddress(source) || !isAccountAddress(contributor)) return { ok: false, reason: 'invalid-address' };
  return prepare(endpoints, contractId, source, 'refund', [new Address(contributor).toScVal()]);
}

/* ------------------------------------------------------------------------ */
/* Sending                                                                  */
/* ------------------------------------------------------------------------ */

type SendProblem =
  | 'not-a-transaction'
  | 'not-signed-for-testnet'
  | 'still-pending'
  | 'archived'
  | 'rejected'
  | NetworkProblem
  | ContractRefusal
  | RefusalReason;

export type SendResult =
  | { readonly ok: true; readonly hash: string; readonly status: 'success' }
  | {
      readonly ok: false;
      /**
       * `not-sent`: the network did not take it (safe to prepare it again).
       * `failed`: it reached the network and was refused there.
       * `pending`: sent, or possibly sent, and not confirmed yet - show the
       * explorer link for `hash` instead of offering to do it again.
       */
      readonly status: 'not-sent' | 'failed' | 'pending';
      readonly reason: SendProblem;
      readonly hash?: string;
      /** The contract's own number for its refusal, when it refused. */
      readonly code?: number;
    };

const HOST_FUNCTION_REFUSALS: Readonly<Record<string, SendProblem>> = Object.freeze({
  invokeHostFunctionTrapped: 'contract-refused',
  invokeHostFunctionEntryArchived: 'archived',
  invokeHostFunctionInsufficientRefundableFee: 'fee-too-low',
  invokeHostFunctionResourceLimitExceeded: 'rejected',
});

/** Why a change was refused, from the network's result (binary, base64) and its diagnostic events. */
function refusalOf(resultXdr: unknown, events: readonly unknown[] | undefined): { reason: SendProblem; code?: number } {
  const code = contractCodeInEvents(events);
  if (code !== undefined) return { reason: refusalFromContractCode(code), code };
  if (typeof resultXdr !== 'string') return { reason: 'rejected' };
  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr, 'base64').result();
    const outcome = result.switch().name;
    if (outcome === 'txFailed') {
      for (const operation of result.results()) {
        const inner = operation.tr();
        if (inner.switch().name !== 'invokeHostFunction') continue;
        const name = inner.invokeHostFunctionResult().switch().name;
        if (Object.hasOwn(HOST_FUNCTION_REFUSALS, name)) return { reason: HOST_FUNCTION_REFUSALS[name] };
      }
      return { reason: 'rejected' };
    }
    return { reason: refusalFromCode(outcome) ?? 'rejected' };
  } catch {
    return { reason: 'rejected' };
  }
}

/**
 * Sends a change the wallet signed and waits until the network confirms it, at
 * most about thirty checks a second apart.
 *
 * The signature is checked first: a change signed for any other network is
 * refused here (`not-signed-for-testnet`, `not-sent`) and never sent.
 */
export async function sendSigned(signedXdr: string, endpoints?: Endpoints): Promise<SendResult> {
  const check = readSignedTransaction(signedXdr);
  if (!check.ok) return { ok: false, status: 'not-sent', reason: check.reason };
  const hash = check.hash;
  const { server, pollIntervalMs } = connect(endpoints);
  let sent: rpc.Api.RawSendTransactionResponse;
  try {
    sent = await server._sendTransaction(check.transaction);
  } catch (thrown) {
    const problem = networkProblem(thrown);
    if (problem === 'busy') return { ok: false, status: 'not-sent', reason: 'busy', hash };
    return { ok: false, status: 'pending', reason: problem, hash };
  }
  const status = isRecord(sent) ? sent.status : undefined;
  if (status === 'ERROR') {
    return { ok: false, status: 'not-sent', hash, ...refusalOf(sent.errorResultXdr, sent.diagnosticEventsXdr) };
  }
  if (status === 'TRY_AGAIN_LATER') return { ok: false, status: 'not-sent', reason: 'busy', hash };
  if (status !== 'PENDING' && status !== 'DUPLICATE') return { ok: false, status: 'pending', reason: 'unexpected-answer', hash };

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    await sleep(pollIntervalMs);
    let found: rpc.Api.RawGetTransactionResponse;
    try {
      found = await server._getTransaction(hash);
    } catch {
      continue; // A missed check is not an answer; ask again.
    }
    if (!isRecord(found)) continue;
    if (found.status === rpc.Api.GetTransactionStatus.SUCCESS) return { ok: true, hash, status: 'success' };
    if (found.status === rpc.Api.GetTransactionStatus.FAILED) {
      return { ok: false, status: 'failed', hash, ...refusalOf(found.resultXdr, found.diagnosticEventsXdr) };
    }
  }
  return { ok: false, status: 'pending', reason: 'still-pending', hash };
}
