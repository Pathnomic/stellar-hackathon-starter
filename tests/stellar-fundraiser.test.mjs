/**
 * The fundraising contract, against a stand-in RPC service.
 *
 * Held here: a read is seven read-only simulations under the all-zero account,
 * sent without the SDK's own identifying headers and without cookies, and the
 * answer carries the goal, total, end, state, pause and payout; a contribution
 * is prepared from a recorded simulation into exactly the change the contract
 * expects (right call, right arguments, the simulation's footprint, fee and
 * signature folded in); every numbered refusal of the contract (100-112) comes
 * back by name; and a signed change is sent, then checked on until the network
 * says yes, no, or the bounded wait runs out.
 *
 * Every answer here is written from the SDK's own types for the RPC service
 * (`simulateTransaction`, `getLedgerEntries`, `sendTransaction`,
 * `getTransaction`) and built with the SDK's classes at run time. Nothing
 * reaches the network.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { xdr } from '@stellar/stellar-sdk';

import {
  FUNDRAISER_ERRORS,
  READ_ONLY_SOURCE,
  buildContribute,
  buildRefund,
  buildWithdraw,
  fundraiserErrorName,
  readContribution,
  readFundraiser,
  sendSigned,
} from '../lib/stellar/fundraiser.ts';
import {
  BENEFICIARY,
  CONTRACT_ID,
  ENDPOINTS,
  FRIEND,
  PUBLIC_NAME,
  RPC,
  TESTNET_NAME,
  WALLET,
  captureConsole,
  diagnosticContractError,
  installFakeNetwork,
  invocationOf,
  ledgerEntriesForAccount,
  noLedgerEntries,
  readBack,
  scAddress,
  scBool,
  scI128,
  scState,
  scU64,
  sendAnswer,
  signAs,
  simulationError,
  simulationSuccess,
  sourceAccountSignatureEntry,
  transactionAnswer,
  transactionResult,
} from './fixtures/stellar/fake-network.mjs';

const ME = WALLET.publicKey();
const DEADLINE = 1_793_000_000;

async function withNetwork(check) {
  const network = installFakeNetwork();
  const quiet = captureConsole();
  try {
    await check(network);
  } finally {
    quiet.restore();
    network.restore();
  }
  assert.deepEqual(quiet.seen, [], 'nothing was written to the console');
  assert.deepEqual(network.unexpected, [], 'every request went to an address the stand-in answers');
}

/** The promises every request to the RPC service keeps. */
function assertRpcRequest(request, method) {
  assert.equal(request.url, RPC);
  assert.equal(request.method, 'POST');
  assert.equal(request.json.jsonrpc, '2.0');
  assert.equal(request.json.method, method);
  assert.deepEqual(Object.keys(request.headers), ['content-type'], 'no identifying headers, nothing but the JSON body type');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.referrerPolicy, 'no-referrer');
  assert.ok(['manual', 'error'].includes(request.redirect), `redirects are not followed silently (${request.redirect})`);
}

/** Answers each read-only view from `views`, by name. */
function answerViews(network, views) {
  network.rpc('simulateTransaction', (params) => {
    const { name } = invocationOf(readBack(params.transaction));
    const answer = views[name];
    return typeof answer === 'function' ? answer() : simulationSuccess(answer);
  });
}

const RUNNING = {
  goal: scI128(2_500_000_000),
  total: scI128(125_000_000),
  deadline: scU64(DEADLINE),
  state: scState('Running'),
  is_paused: scBool(false),
  withdrawn: scBool(false),
  beneficiary: scAddress(BENEFICIARY.publicKey()),
};

test('a published fundraiser is read by seven read-only simulations, nothing signed', async () => {
  await withNetwork(async (network) => {
    answerViews(network, RUNNING);
    assert.deepEqual(await readFundraiser(CONTRACT_ID, ENDPOINTS), {
      ok: true,
      contractId: CONTRACT_ID,
      goal: '250',
      total: '12.5',
      deadline: DEADLINE,
      state: 'running',
      paused: false,
      withdrawn: false,
      beneficiary: BENEFICIARY.publicKey(),
    });
    assert.equal(network.requests.length, 7);
    const asked = [];
    for (const request of network.requests) {
      assertRpcRequest(request, 'simulateTransaction');
      const simulated = readBack(request.json.params.transaction);
      assert.equal(simulated.networkPassphrase, TESTNET_NAME);
      assert.equal(simulated.source, READ_ONLY_SOURCE);
      assert.equal(simulated.signatures.length, 0);
      assert.equal(simulated.operations.length, 1);
      const { contract, name, args } = invocationOf(simulated);
      assert.equal(contract, CONTRACT_ID);
      assert.deepEqual(args, []);
      asked.push(name);
    }
    assert.deepEqual(asked.sort(), ['beneficiary', 'deadline', 'goal', 'is_paused', 'state', 'total', 'withdrawn']);
  });
});

test('a finished fundraiser reads as succeeded or failed, paid out or not', async () => {
  for (const [state, withdrawn, paused] of [
    ['Succeeded', true, false],
    ['Failed', false, true],
  ]) {
    await withNetwork(async (network) => {
      answerViews(network, { ...RUNNING, state: scState(state), withdrawn: scBool(withdrawn), is_paused: scBool(paused) });
      const reading = await readFundraiser(CONTRACT_ID, ENDPOINTS);
      assert.equal(reading.ok, true);
      assert.equal(reading.state, state.toLowerCase());
      assert.equal(reading.withdrawn, withdrawn);
      assert.equal(reading.paused, paused);
    });
  }
});

test('a contract that is not there, or is not this fundraiser, is named, not thrown', async () => {
  const cases = [
    ['Error(Storage, MissingValue)', 'contract-missing'],
    ['Error(WasmVm, MissingValue)', 'not-a-fundraiser'],
    ['Error(Budget, ExceededLimit)', 'unexpected-answer'],
  ];
  for (const [hostError, reason] of cases) {
    await withNetwork(async (network) => {
      network.rpc('simulateTransaction', () => simulationError(hostError));
      assert.deepEqual(await readFundraiser(CONTRACT_ID, ENDPOINTS), { ok: false, reason });
    });
  }
});

test('an unreachable, busy or confused service is named, and an answer of the wrong shape is refused', async () => {
  const cases = [
    [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    [() => new Response('bad gateway', { status: 502 }), 'unreachable'],
    [() => new Response('slow down', { status: 429 }), 'busy'],
    [() => ({ rpcError: { code: -32602, message: 'invalid parameters' } }), 'unexpected-answer'],
    [() => simulationSuccess(xdr.ScVal.scvString('two hundred')), 'unexpected-answer'],
  ];
  for (const [answer, reason] of cases) {
    await withNetwork(async (network) => {
      network.rpc('simulateTransaction', answer);
      assert.deepEqual(await readFundraiser(CONTRACT_ID, ENDPOINTS), { ok: false, reason });
    });
  }
  await withNetwork(async (network) => {
    answerViews(network, { ...RUNNING, state: scState('Exploded') });
    assert.deepEqual(await readFundraiser(CONTRACT_ID, ENDPOINTS), { ok: false, reason: 'unexpected-answer' });
  });
});

test("one supporter's own amount is read with their address", async () => {
  await withNetwork(async (network) => {
    network.rpc('simulateTransaction', (params) => {
      const { name, args } = invocationOf(readBack(params.transaction));
      assert.equal(name, 'contribution');
      assert.deepEqual(args.map((arg) => arg.toXDR('base64')), [scAddress(ME).toXDR('base64')]);
      return simulationSuccess(scI128(30_000_000));
    });
    assert.deepEqual(await readContribution(CONTRACT_ID, ME, ENDPOINTS), { ok: true, amount: '3' });
  });
});

test('a wrong contract address or supporter address is refused before the service is asked', async () => {
  await withNetwork(async (network) => {
    for (const bad of [ME, CONTRACT_ID.toLowerCase(), '', `${CONTRACT_ID}x`]) {
      assert.deepEqual(await readFundraiser(bad, ENDPOINTS), { ok: false, reason: 'invalid-contract-id' });
    }
    assert.deepEqual(await readContribution(CONTRACT_ID, CONTRACT_ID, ENDPOINTS), { ok: false, reason: 'invalid-address' });
    assert.equal(network.requests.length, 0);
  });
});

/** Answers the account lookup and a successful simulation of any call, recording what was simulated. */
function answerPrepare(network, { resourceFee = '51234', signatureEntries = () => [] } = {}) {
  const simulated = [];
  network.rpc('getLedgerEntries', (params) => {
    const key = xdr.LedgerKey.fromXDR(params.keys[0], 'base64');
    assert.equal(params.keys.length, 1);
    assert.equal(key.account().accountId().toXDR('base64'), WALLET.xdrAccountId().toXDR('base64'));
    return ledgerEntriesForAccount(WALLET, '4294967296');
  });
  network.rpc('simulateTransaction', (params) => {
    const transaction = readBack(params.transaction);
    simulated.push(transaction);
    const { name, args } = invocationOf(transaction);
    return simulationSuccess(xdr.ScVal.scvVoid(), {
      authEntries: signatureEntries(name, args),
      resourceFee,
    });
  });
  return simulated;
}

test('a contribution is prepared from a recorded simulation into exactly the change the contract expects', async () => {
  await withNetwork(async (network) => {
    const simulated = answerPrepare(network, {
      signatureEntries: (name, args) => [sourceAccountSignatureEntry(CONTRACT_ID, name, args)],
    });
    const prepared = await buildContribute({ contractId: CONTRACT_ID, from: ME, amount: '12.5' }, ENDPOINTS);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    // What was simulated: the person's own change, unsigned, nothing folded in yet.
    assert.equal(simulated.length, 1);
    assert.equal(simulated[0].source, ME);
    assert.equal(simulated[0].fee, '100');
    assert.deepEqual(invocationOf(simulated[0]).authEntries, []);

    // What comes back: the same call, with the simulation's answers folded in.
    const change = readBack(prepared.xdr);
    assert.equal(change.networkPassphrase, TESTNET_NAME);
    assert.equal(change.source, ME);
    assert.equal(change.sequence, '4294967297');
    assert.equal(change.signatures.length, 0);
    assert.equal(change.fee, String(100 + 51_234));
    const data = change.toEnvelope().v1().tx().ext().sorobanData();
    assert.equal(data.resourceFee().toString(), '51234');
    assert.equal(data.resources().instructions(), 1_500_000);
    const { contract, name, args, authEntries } = invocationOf(change);
    assert.equal(contract, CONTRACT_ID);
    assert.equal(name, 'contribute');
    assert.deepEqual(
      args.map((arg) => arg.toXDR('base64')),
      [scAddress(ME).toXDR('base64'), scI128(125_000_000).toXDR('base64')],
    );
    assert.equal(authEntries.length, 1);
    assert.equal(authEntries[0].credentials().switch().name, 'sorobanCredentialsSourceAccount');
    assert.equal(authEntries[0].rootInvocation().function().contractFn().functionName().toString(), 'contribute');

    const [lookup, simulation] = network.requests;
    assertRpcRequest(lookup, 'getLedgerEntries');
    assertRpcRequest(simulation, 'simulateTransaction');
  });
});

test('withdraw takes no arguments, and a refund names only the supporter', async () => {
  await withNetwork(async (network) => {
    answerPrepare(network);
    const withdraw = await buildWithdraw({ contractId: CONTRACT_ID, source: ME }, ENDPOINTS);
    assert.equal(withdraw.ok, true);
    assert.equal(invocationOf(readBack(withdraw.xdr)).name, 'withdraw');
    assert.deepEqual(invocationOf(readBack(withdraw.xdr)).args, []);

    const refund = await buildRefund({ contractId: CONTRACT_ID, source: ME, contributor: FRIEND.publicKey() }, ENDPOINTS);
    assert.equal(refund.ok, true);
    const call = invocationOf(readBack(refund.xdr));
    assert.equal(call.name, 'refund');
    assert.deepEqual(call.args.map((arg) => arg.toXDR('base64')), [scAddress(FRIEND.publicKey()).toXDR('base64')]);
  });
});

test("every one of the contract's numbered refusals comes back by name, before anything is signed", async () => {
  assert.equal(Object.isFrozen(FUNDRAISER_ERRORS), true);
  assert.deepEqual(
    Object.keys(FUNDRAISER_ERRORS).map(Number),
    Array.from({ length: 13 }, (_, index) => 100 + index),
  );
  const expected = {
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
  };
  const cases = [
    ...Object.entries(expected).map(([code, reason]) => [Number(code), reason]),
    [10, 'not-enough-test-money'],
    [999, 'contract-refused'],
  ];
  for (const [code, reason] of cases) {
    if (code >= 100 && code <= 112) assert.equal(fundraiserErrorName(code), reason);
    await withNetwork(async (network) => {
      network.rpc('getLedgerEntries', () => ledgerEntriesForAccount(WALLET));
      network.rpc('simulateTransaction', () => simulationError(`Error(Contract, #${code})`));
      assert.deepEqual(await buildWithdraw({ contractId: CONTRACT_ID, source: ME }, ENDPOINTS), { ok: false, reason, code });
    });
  }
  assert.equal(fundraiserErrorName(99), undefined);
  assert.equal(fundraiserErrorName('107'), undefined);
});

test("a refusal named only in the service's diagnostic events is still found", async () => {
  await withNetwork(async (network) => {
    network.rpc('getLedgerEntries', () => ledgerEntriesForAccount(WALLET));
    network.rpc('simulateTransaction', () =>
      simulationError('Error(WasmVm, InvalidAction)', { events: [diagnosticContractError(108)] }),
    );
    assert.deepEqual(
      await buildRefund({ contractId: CONTRACT_ID, source: ME, contributor: ME }, ENDPOINTS),
      { ok: false, reason: 'nothing-to-refund', code: 108 },
    );
  });
});

test('a wallet with no test money yet is "not funded" before anything is simulated', async () => {
  await withNetwork(async (network) => {
    network.rpc('getLedgerEntries', () => noLedgerEntries());
    assert.deepEqual(await buildContribute({ contractId: CONTRACT_ID, from: ME, amount: 1 }, ENDPOINTS), {
      ok: false,
      reason: 'not-funded',
    });
    assert.deepEqual(network.requests.map((request) => request.json.method), ['getLedgerEntries']);
  });
});

test('a wrong contract, address or amount is refused before the service is asked', async () => {
  await withNetwork(async (network) => {
    const cases = [
      [{ contractId: ME, from: ME, amount: '1' }, 'invalid-contract-id'],
      [{ contractId: CONTRACT_ID, from: CONTRACT_ID, amount: '1' }, 'invalid-address'],
      [{ contractId: CONTRACT_ID, from: ME, amount: '0' }, 'invalid-amount'],
      [{ contractId: CONTRACT_ID, from: ME, amount: '-1' }, 'invalid-amount'],
      [{ contractId: CONTRACT_ID, from: ME, amount: '0.00000001' }, 'invalid-amount'],
    ];
    for (const [request, reason] of cases) {
      assert.deepEqual(await buildContribute(request, ENDPOINTS), { ok: false, reason }, JSON.stringify(request));
    }
    assert.deepEqual(await buildRefund({ contractId: CONTRACT_ID, source: ME, contributor: 'someone' }, ENDPOINTS), {
      ok: false,
      reason: 'invalid-address',
    });
    assert.equal(network.requests.length, 0);
  });
});

/** A contribution prepared against the stand-in and signed by the wallet, for the test network. */
async function signedContribution(networkName = TESTNET_NAME) {
  const setup = installFakeNetwork();
  try {
    answerPrepare(setup, { signatureEntries: (name, args) => [sourceAccountSignatureEntry(CONTRACT_ID, name, args)] });
    const prepared = await buildContribute({ contractId: CONTRACT_ID, from: ME, amount: '5' }, ENDPOINTS);
    assert.equal(prepared.ok, true);
    const signedXdr = signAs(WALLET, prepared.xdr, networkName);
    return { signedXdr, hash: readBack(prepared.xdr).hash().toString('hex') };
  } finally {
    setup.restore();
  }
}

test('a signed change is sent once and checked on until the network confirms it', async () => {
  const { signedXdr, hash } = await signedContribution();
  await withNetwork(async (network) => {
    network.rpc('sendTransaction', (params) => {
      assert.equal(params.transaction, signedXdr);
      return sendAnswer('PENDING', hash);
    });
    const answers = ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS'];
    network.rpc('getTransaction', (params) => {
      assert.equal(params.hash, hash);
      return transactionAnswer(answers.shift(), hash, {});
    });
    assert.deepEqual(await sendSigned(signedXdr, ENDPOINTS), { ok: true, hash, status: 'success' });
    assert.deepEqual(
      network.requests.map((request) => request.json.method),
      ['sendTransaction', 'getTransaction', 'getTransaction', 'getTransaction'],
    );
    for (const request of network.requests) assertRpcRequest(request, request.json.method);
  });
});

test('a change the contract refused on the network comes back failed, by name', async () => {
  const { signedXdr, hash } = await signedContribution();
  const cases = [
    [{ diagnosticEventsXdr: [diagnosticContractError(103).toXDR('base64')] }, { reason: 'ended', code: 103 }],
    [{ resultXdr: transactionResult('txFailed').toXDR('base64') }, { reason: 'contract-refused' }],
    [{}, { reason: 'rejected' }],
  ];
  for (const [extra, named] of cases) {
    await withNetwork(async (network) => {
      network.rpc('sendTransaction', () => sendAnswer('PENDING', hash));
      network.rpc('getTransaction', () => transactionAnswer('FAILED', hash, extra));
      assert.deepEqual(await sendSigned(signedXdr, ENDPOINTS), { ok: false, status: 'failed', hash, ...named });
    });
  }
});

test('a change the service would not take is "not sent", with the reason', async () => {
  const { signedXdr, hash } = await signedContribution();
  const cases = [
    [sendAnswer('ERROR', hash, { errorResultXdr: transactionResult('txBadSeq').toXDR('base64') }), 'out-of-date'],
    [sendAnswer('ERROR', hash, { errorResultXdr: transactionResult('txInsufficientFee').toXDR('base64') }), 'fee-too-low'],
    [sendAnswer('TRY_AGAIN_LATER', hash), 'busy'],
  ];
  for (const [answer, reason] of cases) {
    await withNetwork(async (network) => {
      network.rpc('sendTransaction', () => answer);
      assert.deepEqual(await sendSigned(signedXdr, ENDPOINTS), { ok: false, status: 'not-sent', reason, hash });
      assert.equal(network.requests.length, 1, 'nothing is checked on when nothing was taken');
    });
  }
});

test('a change still unconfirmed after the bounded wait is "pending" with its reference code', async () => {
  const { signedXdr, hash } = await signedContribution();
  await withNetwork(async (network) => {
    network.rpc('sendTransaction', () => sendAnswer('PENDING', hash));
    network.rpc('getTransaction', () => transactionAnswer('NOT_FOUND', hash));
    assert.deepEqual(await sendSigned(signedXdr, ENDPOINTS), { ok: false, status: 'pending', reason: 'still-pending', hash });
    assert.equal(network.requests.filter((request) => request.json.method === 'getTransaction').length, 30);
  });
});

test('nothing unsigned or signed for another network is ever sent', async () => {
  const { signedXdr: forMainnet } = await signedContribution(PUBLIC_NAME);
  const setup = installFakeNetwork();
  answerPrepare(setup);
  const unsigned = await buildWithdraw({ contractId: CONTRACT_ID, source: ME }, ENDPOINTS);
  setup.restore();
  await withNetwork(async (network) => {
    for (const [candidate, reason] of [
      [forMainnet, 'not-signed-for-testnet'],
      [unsigned.xdr, 'not-signed-for-testnet'],
      [signAs(FRIEND, unsigned.xdr), 'not-signed-for-testnet'],
      ['', 'not-a-transaction'],
    ]) {
      assert.deepEqual(await sendSigned(candidate, ENDPOINTS), { ok: false, status: 'not-sent', reason });
    }
    assert.equal(network.requests.length, 0);
  });
});
