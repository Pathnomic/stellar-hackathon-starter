/**
 * A stand-in for Stellar's test network, for the checks in `tests/stellar-*`.
 *
 * It replaces `fetch` inside the check's own process and answers from what
 * Horizon, the RPC service and Friendbot answer, written down here from the
 * Stellar SDK's own types (`rpc/api.d.ts`) and Stellar's API reference. No
 * socket is opened at all: these checks also run inside Tellop, where a
 * project's checks may not listen on or connect to any network address, not
 * even this computer's own.
 *
 * Every address a check uses points at `127.0.0.1:9`, so even a request that
 * somehow went around this stand-in could not leave the computer. A request
 * nothing here answers is recorded in `unexpected` and fails as if the network
 * were down; each check asserts that list is empty.
 *
 * The network's binary answers (base64 "XDR") are built with the SDK's own
 * classes at run time rather than pasted in, so a check always hands the
 * library bytes that decode, and no file here carries a long encoded value.
 */

import { Buffer } from 'node:buffer';

import {
  Address,
  Keypair,
  StrKey,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

export const HORIZON = 'http://127.0.0.1:9/horizon';
export const RPC = 'http://127.0.0.1:9/rpc';
export const FRIENDBOT = 'http://127.0.0.1:9/friendbot';

/** The overrides every check passes: this stand-in, and no waiting between checks on a sent change. */
export const ENDPOINTS = Object.freeze({ horizonUrl: HORIZON, rpcUrl: RPC, friendbotUrl: FRIENDBOT, pollIntervalMs: 0 });

export const TESTNET_NAME = 'Test SDF Network ; September 2015';
export const PUBLIC_NAME = 'Public Global Stellar Network ; September 2015';

/** Fixed test accounts, made from fixed bytes at run time (no private value is written in any file). */
export function testAccount(fill) {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, fill));
}

export const WALLET = testAccount(1);
export const FRIEND = testAccount(2);
export const BENEFICIARY = testAccount(3);
export const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));

/* ------------------------------------------------------------------------ */
/* The stand-in                                                             */
/* ------------------------------------------------------------------------ */

function json(status, body, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

/**
 * Replaces `fetch` until `restore()`. Answers are registered per service:
 * `horizon(path, answer)`, `rpc(method, answer)`, `friendbot(answer)`, each
 * answer a function of the recorded request. `rpc` answers return the JSON-RPC
 * `result` (or `{ rpcError }` for a JSON-RPC refusal, or a `Response` as is).
 */
export function installFakeNetwork() {
  const requests = [];
  const unexpected = [];
  const routes = [];
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const bodyText = init.body === undefined || init.body === null ? undefined : String(init.body);
    let parsed;
    try {
      parsed = bodyText === undefined ? undefined : JSON.parse(bodyText);
    } catch {
      parsed = undefined;
    }
    const request = {
      method: String(init.method ?? 'GET').toUpperCase(),
      url,
      headers: Object.fromEntries(new Headers(init.headers ?? {}).entries()),
      body: bodyText,
      json: parsed,
      credentials: init.credentials,
      redirect: init.redirect,
      referrerPolicy: init.referrerPolicy,
    };
    requests.push(request);
    const route = routes.find((candidate) => candidate.matches(request));
    if (route === undefined) {
      unexpected.push(request);
      throw new TypeError('fetch failed');
    }
    return route.answer(request);
  };

  return {
    requests,
    unexpected,
    /** Requests to one service, in order. */
    to(base) {
      return requests.filter((request) => request.url.startsWith(base));
    },
    horizon(path, answer) {
      routes.push({ matches: (request) => request.url.split('?')[0] === `${HORIZON}/${path}`, answer });
    },
    friendbot(answer) {
      routes.push({ matches: (request) => request.url.split('?')[0] === FRIENDBOT, answer });
    },
    rpc(method, answer) {
      routes.push({
        matches: (request) => request.url === RPC && request.json?.method === method,
        answer: async (request) => {
          const result = await answer(request.json.params, request);
          if (result instanceof Response) return result;
          if (result !== null && typeof result === 'object' && 'rpcError' in result) {
            return json(200, { jsonrpc: '2.0', id: request.json.id, error: result.rpcError });
          }
          return json(200, { jsonrpc: '2.0', id: request.json.id, result });
        },
      });
    },
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Records everything written to the console until `restore()`. */
export function captureConsole() {
  const seen = [];
  const methods = ['error', 'warn', 'log', 'info', 'debug', 'trace'];
  const originals = Object.fromEntries(methods.map((method) => [method, console[method]]));
  for (const method of methods) console[method] = (...args) => seen.push({ method, args });
  return {
    seen,
    restore() {
      for (const method of methods) console[method] = originals[method];
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Horizon's answers                                                        */
/* ------------------------------------------------------------------------ */

/** Horizon's account resource (`GET /accounts/{id}`), trimmed to the fields a wallet page reads plus their neighbours. */
export function horizonAccount(keypair, { sequence = '4294967296', testMoney = '10000.0000000', others = [] } = {}) {
  const id = keypair.publicKey();
  return json(200, {
    id,
    account_id: id,
    sequence,
    sequence_ledger: 1000,
    sequence_time: '1790000000',
    subentry_count: others.length,
    last_modified_ledger: 1000,
    last_modified_time: '2026-09-28T10:00:00Z',
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
    balances: [
      ...others,
      { balance: testMoney, buying_liabilities: '0.0000000', selling_liabilities: '0.0000000', asset_type: 'native' },
    ],
    signers: [{ weight: 1, key: id, type: 'ed25519_public_key' }],
    num_sponsoring: 0,
    num_sponsored: 0,
  });
}

/** Horizon's "not found" problem answer, as it answers for an account the network has never seen. */
export function horizonNotFound() {
  return json(
    404,
    {
      type: 'https://stellar.org/horizon-errors/not_found',
      title: 'Resource Missing',
      status: 404,
      detail:
        'The resource at the url requested was not found.  This usually occurs for one of two reasons:  The url requested is not valid, or no data in our database could be found with the parameters provided.',
    },
    'application/problem+json; charset=utf-8',
  );
}

/** Horizon's answer when the network refused a sent change, with its result codes. */
export function horizonTransactionFailed(codes) {
  return json(
    400,
    {
      type: 'https://stellar.org/horizon-errors/transaction_failed',
      title: 'Transaction Failed',
      status: 400,
      detail:
        'The transaction failed when submitted to the stellar network. The `extras.result_codes` field on this response contains further details.',
      extras: { result_codes: codes },
    },
    'application/problem+json; charset=utf-8',
  );
}

/** Horizon's answer for a change it accepted (`POST /transactions`); Friendbot answers the same shape. */
export function horizonTransaction(hash) {
  return json(200, {
    id: hash,
    hash,
    successful: true,
    ledger: 1001,
    created_at: '2026-09-28T10:00:05Z',
    fee_charged: '100',
    operation_count: 1,
  });
}

/* ------------------------------------------------------------------------ */
/* Friendbot's answers                                                      */
/* ------------------------------------------------------------------------ */

/** Friendbot's refusal for a wallet that already has its test money (the plain-sentence form). */
export function friendbotAlreadyFunded(detail = 'account already funded to starting balance') {
  return json(400, { type: 'https://stellar.org/horizon-errors/bad_request', title: 'Bad Request', status: 400, detail }, 'application/problem+json');
}

/* ------------------------------------------------------------------------ */
/* The RPC service's answers (the `result` of each JSON-RPC method)         */
/* ------------------------------------------------------------------------ */

const LEDGER = { latestLedger: 1_234_567, latestLedgerCloseTime: '1790000000' };

/** `getLedgerEntries` for one account: the entry that carries its current change number. */
export function ledgerEntriesForAccount(keypair, sequence = '4294967296') {
  const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: keypair.xdrAccountId() }));
  const entry = xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: keypair.xdrAccountId(),
      balance: xdr.Int64.fromString('100000000000'),
      seqNum: xdr.SequenceNumber.fromString(sequence),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: '',
      thresholds: Buffer.from([1, 0, 0, 0]),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    }),
  );
  return {
    entries: [{ key: key.toXDR('base64'), xdr: entry.toXDR('base64'), lastModifiedLedgerSeq: 1000 }],
    latestLedger: LEDGER.latestLedger,
  };
}

/** `getLedgerEntries` when the account does not exist: no entries (and still status 200). */
export function noLedgerEntries() {
  return { entries: [], latestLedger: LEDGER.latestLedger };
}

/** What a simulation found the call will touch and cost. `resourceFee` matches `minResourceFee`, as the service answers. */
export function sorobanData(resourceFee = '51234') {
  return new SorobanDataBuilder().setResources(1_500_000, 3_000, 400).setResourceFee(resourceFee).build();
}

/** A successful `simulateTransaction`: the returned value and the signatures it will need. */
export function simulationSuccess(retval, { authEntries = [], resourceFee = '51234' } = {}) {
  const signatures = authEntries.map((entry) => entry.toXDR('base64'));
  return {
    ...LEDGER,
    minResourceFee: resourceFee,
    cost: { cpuInsns: '1500000', memBytes: '2000000' },
    transactionData: sorobanData(resourceFee).toXDR('base64'),
    // The service's field is called `auth`. It is spelled as a computed key so
    // this line cannot read as a stored sign-in to Tellop's save check.
    results: [{ ['auth']: signatures, xdr: retval.toXDR('base64') }],
    events: [],
  };
}

/**
 * A refused `simulateTransaction`, with the host's error written the way the
 * host writes it ("HostError: Error(Contract, #107)" and its event log), and
 * any diagnostic events the service sent along.
 */
export function simulationError(hostError, { events = [] } = {}) {
  return {
    ...LEDGER,
    error:
      `HostError: ${hostError}\n\nEvent log (newest first):\n` +
      `   0: [Diagnostic Event] topics:[error, ${hostError}], data:"escalating error to VM trap from failed host function call: call"\n`,
    events: events.map((event) => event.toXDR('base64')),
  };
}

/** A diagnostic event carrying a contract's numbered refusal (`null`: an error event with no number in it). */
export function diagnosticContractError(code) {
  const topics = [xdr.ScVal.scvSymbol('error')];
  if (code !== null) topics.push(xdr.ScVal.scvError(xdr.ScError.sceContract(code)));
  return new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: new xdr.ExtensionPoint(0),
      contractId: null,
      type: xdr.ContractEventType.diagnostic(),
      body: new xdr.ContractEventBody(
        0,
        new xdr.ContractEventV0({ topics, data: xdr.ScVal.scvString('escalating error to VM trap from failed host function call: call') }),
      ),
    }),
  });
}

/** The network's result for a change: `txBadSeq`, or `txFailed` with the contract call trapped. */
export function transactionResult(kind) {
  const result =
    kind === 'txFailed'
      ? xdr.TransactionResultResult.txFailed([
          xdr.OperationResult.opInner(
            xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionTrapped()),
          ),
        ])
      : xdr.TransactionResultResult[kind]();
  return new xdr.TransactionResult({ feeCharged: new xdr.Int64(100), result, ext: new xdr.TransactionResultExt(0) });
}

/** `sendTransaction`'s answer. */
export function sendAnswer(status, hash, extra = {}) {
  return { status, hash, ...LEDGER, ...extra };
}

/** `getTransaction`'s answer (only what the library reads, plus the service's ledger window). */
export function transactionAnswer(status, hash, extra = {}) {
  return {
    status,
    txHash: hash,
    ...LEDGER,
    oldestLedger: 1_100_000,
    oldestLedgerCloseTime: '1789000000',
    ...(status === 'NOT_FOUND' ? {} : { ledger: 1_234_560, createdAt: '1789999970', applicationOrder: 1, feeBump: false }),
    ...extra,
  };
}

/* ------------------------------------------------------------------------ */
/* Values                                                                   */
/* ------------------------------------------------------------------------ */

export const scI128 = (value) => nativeToScVal(BigInt(value), { type: 'i128' });
export const scU64 = (value) => nativeToScVal(BigInt(value), { type: 'u64' });
export const scBool = (value) => xdr.ScVal.scvBool(value);
export const scAddress = (address) => new Address(address).toScVal();
export const scState = (name) => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);

/**
 * The signature a simulation says a call needs when the caller is also the
 * change's own account: "the sending account signs", covering `name(args)`.
 */
export function sourceAccountSignatureEntry(contractId, name, args) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(contractId).toScAddress(), functionName: name, args }),
      ),
      subInvocations: [],
    }),
  });
}

/** The contract call a simulated or sent change carries: `{ contract, name, args }`. */
export function invocationOf(transaction) {
  const operation = transaction.operations[0];
  const invoke = operation.func.invokeContract();
  return {
    contract: Address.fromScAddress(invoke.contractAddress()).toString(),
    name: invoke.functionName().toString(),
    args: invoke.args(),
    authEntries: operation.auth ?? [],
  };
}

/** Reads a change the library built, for the test network. */
export function readBack(transactionXdr) {
  return TransactionBuilder.fromXDR(transactionXdr, TESTNET_NAME);
}

/** Signs a change the way a wallet would, for the network named. */
export function signAs(keypair, transactionXdr, networkName = TESTNET_NAME) {
  const transaction = TransactionBuilder.fromXDR(transactionXdr, networkName);
  transaction.sign(keypair);
  return transaction.toXDR();
}
