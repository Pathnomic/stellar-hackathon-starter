/**
 * A wallet's test money and a test money payment, against a stand-in Horizon.
 *
 * What is held here: a wallet the network has never seen is an ordinary answer
 * (`not-funded`), not a thrown error and not a line in the console; a payment is
 * built for the test network, to the right person, for the right amount, and
 * refused before any request when the address or amount is wrong; and a signed
 * payment is sent only when it was signed for the test network. Every request
 * is checked for its shape too: no cookies, no extra headers, no redirects.
 *
 * The stand-in (`tests/fixtures/stellar/fake-network.mjs`) replaces `fetch` in
 * this process only; nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Asset } from '@stellar/stellar-sdk';

import { buildPayment, loadBalances, submitSigned } from '../lib/stellar/horizon.ts';
import { readSignedTransaction } from '../lib/stellar/network.ts';
import {
  ENDPOINTS,
  FRIEND,
  HORIZON,
  PUBLIC_NAME,
  TESTNET_NAME,
  WALLET,
  captureConsole,
  horizonAccount,
  horizonNotFound,
  horizonTransaction,
  horizonTransactionFailed,
  installFakeNetwork,
  readBack,
  signAs,
} from './fixtures/stellar/fake-network.mjs';

const ME = WALLET.publicKey();
const YOU = FRIEND.publicKey();
const POOL = 'dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7';

/** Runs `check` against a fresh stand-in, then asserts the console stayed silent and every request was answered. */
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

/** The promises every request made here keeps. */
function assertPlainRequest(request, method) {
  assert.equal(request.method, method);
  assert.equal(request.credentials, 'omit');
  assert.equal(request.redirect, 'error');
  assert.equal(request.referrerPolicy, 'no-referrer');
  const extra = Object.keys(request.headers).filter((name) => name !== 'content-type');
  assert.deepEqual(extra, [], 'no header of its own');
}

test('a funded wallet: its test money and what else it holds, from one plain read', async () => {
  await withNetwork(async (network) => {
    network.horizon(`accounts/${ME}`, () =>
      horizonAccount(WALLET, {
        testMoney: '9999.9999900',
        others: [
          {
            balance: '25.5000000',
            limit: '922337203685.4775807',
            buying_liabilities: '0.0000000',
            selling_liabilities: '0.0000000',
            is_authorized: true,
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: YOU,
          },
          { balance: '3.0000000', limit: '922337203685.4775807', liquidity_pool_id: POOL, asset_type: 'liquidity_pool_shares' },
        ],
      }),
    );
    const result = await loadBalances(ME, ENDPOINTS);
    assert.deepEqual(result, {
      ok: true,
      state: 'funded',
      address: ME,
      testMoney: '9999.99999',
      others: [
        { kind: 'asset', code: 'USDC', issuer: YOU, balance: '25.5' },
        { kind: 'pool-share', poolId: POOL, balance: '3' },
      ],
    });
    assert.equal(network.requests.length, 1);
    assert.equal(network.requests[0].url, `${HORIZON}/accounts/${ME}`);
    assertPlainRequest(network.requests[0], 'GET');
    assert.equal(network.requests[0].body, undefined);
  });
});

test('a wallet the network has never seen is "not funded": an answer, not an error, and nothing in the console', async () => {
  await withNetwork(async (network) => {
    network.horizon(`accounts/${ME}`, () => horizonNotFound());
    assert.deepEqual(await loadBalances(ME, ENDPOINTS), { ok: true, state: 'not-funded', address: ME });
  });
});

test('a service that cannot be reached, is busy or answers nonsense is named, never thrown', async () => {
  const cases = [
    [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    [() => new Response('upstream down', { status: 502 }), 'unreachable'],
    [() => new Response('{"status":429}', { status: 429 }), 'busy'],
    [() => new Response('<html>hello</html>', { status: 200 }), 'unexpected-answer'],
    [() => new Response(JSON.stringify({ id: ME, balances: [{ asset_type: 'native', balance: 'lots' }] }), { status: 200 }), 'unexpected-answer'],
  ];
  for (const [answer, reason] of cases) {
    await withNetwork(async (network) => {
      network.horizon(`accounts/${ME}`, answer);
      assert.deepEqual(await loadBalances(ME, ENDPOINTS), { ok: false, reason });
    });
  }
});

test('an address that is not a valid G address is refused before anything is asked', async () => {
  await withNetwork(async (network) => {
    for (const bad of [ME.toLowerCase(), `${ME}A`, 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L', '']) {
      assert.deepEqual(await loadBalances(bad, ENDPOINTS), { ok: false, reason: 'invalid-address' });
    }
    assert.equal(network.requests.length, 0);
  });
});

test('a payment is built for the test network, to the right wallet, for the right amount, and unsigned', async () => {
  await withNetwork(async (network) => {
    network.horizon(`accounts/${ME}`, () => horizonAccount(WALLET, { sequence: '4294967296' }));
    const before = Math.floor(Date.now() / 1000);
    const result = await buildPayment({ from: ME, to: YOU, amount: '12.5' }, ENDPOINTS);
    assert.equal(result.ok, true);

    const payment = readBack(result.xdr);
    assert.equal(payment.networkPassphrase, TESTNET_NAME);
    assert.equal(payment.source, ME);
    assert.equal(payment.sequence, '4294967297');
    assert.equal(payment.signatures.length, 0);
    assert.equal(payment.operations.length, 1);
    const [operation] = payment.operations;
    assert.equal(operation.type, 'payment');
    assert.equal(operation.destination, YOU);
    assert.equal(operation.amount, '12.5000000');
    assert.equal(operation.asset.equals(Asset.native()), true);
    const expires = Number(payment.timeBounds.maxTime);
    assert.ok(expires >= before + 299 && expires <= before + 301 + 5, `valid for five minutes, got ${expires - before}s`);

    // Signed with the test network's name it is a payment the test network
    // accepts; the same bytes signed with the main network's name are refused.
    assert.equal(readSignedTransaction(signAs(WALLET, result.xdr)).ok, true);
    assert.deepEqual(readSignedTransaction(signAs(WALLET, result.xdr, PUBLIC_NAME)), {
      ok: false,
      reason: 'not-signed-for-testnet',
    });
    assertPlainRequest(network.requests[0], 'GET');
  });
});

test('a wrong address or amount is refused before the network is asked', async () => {
  await withNetwork(async (network) => {
    const cases = [
      [{ from: ME, to: YOU.toLowerCase(), amount: '1' }, 'invalid-address'],
      [{ from: ME, to: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L', amount: '1' }, 'invalid-address'],
      [{ from: 'me', to: YOU, amount: '1' }, 'invalid-address'],
      [{ from: ME, to: YOU, amount: '0' }, 'invalid-amount'],
      [{ from: ME, to: YOU, amount: '-5' }, 'invalid-amount'],
      [{ from: ME, to: YOU, amount: '1.12345678' }, 'invalid-amount'],
      [{ from: ME, to: YOU, amount: '1e3' }, 'invalid-amount'],
      [{ from: ME, to: YOU, amount: Number.NaN }, 'invalid-amount'],
    ];
    for (const [request, reason] of cases) {
      assert.deepEqual(await buildPayment(request, ENDPOINTS), { ok: false, reason }, JSON.stringify(request));
    }
    assert.equal(network.requests.length, 0);
  });
});

test('a payment from a wallet with no test money yet is "not funded"', async () => {
  await withNetwork(async (network) => {
    network.horizon(`accounts/${ME}`, () => horizonNotFound());
    assert.deepEqual(await buildPayment({ from: ME, to: YOU, amount: 5 }, ENDPOINTS), { ok: false, reason: 'not-funded' });
  });
});

async function signedPayment() {
  const setup = installFakeNetwork();
  try {
    setup.horizon(`accounts/${ME}`, () => horizonAccount(WALLET));
    const built = await buildPayment({ from: ME, to: YOU, amount: '3' }, ENDPOINTS);
    assert.equal(built.ok, true);
    const signedXdr = signAs(WALLET, built.xdr);
    return { signedXdr, hash: readBack(signedXdr).hash().toString('hex') };
  } finally {
    setup.restore();
  }
}

test('a signed payment is sent as a plain form, and its reference code comes back', async () => {
  const { signedXdr, hash } = await signedPayment();
  await withNetwork(async (network) => {
    network.horizon('transactions', () => horizonTransaction(hash));
    assert.deepEqual(await submitSigned(signedXdr, ENDPOINTS), { ok: true, hash });
    const [sent] = network.requests;
    assert.equal(sent.url, `${HORIZON}/transactions`);
    assertPlainRequest(sent, 'POST');
    assert.equal(sent.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.deepEqual([...new URLSearchParams(sent.body).entries()], [['tx', signedXdr]]);
  });
});

test("the network's refusals come back named, with its own codes and the reference code", async () => {
  const { signedXdr, hash } = await signedPayment();
  const cases = [
    [{ transaction: 'tx_failed', operations: ['op_underfunded'] }, 'not-enough-test-money'],
    [{ transaction: 'tx_failed', operations: ['op_no_destination'] }, 'destination-not-funded'],
    [{ transaction: 'tx_bad_seq' }, 'out-of-date'],
    [{ transaction: 'tx_too_late' }, 'expired'],
    [{ transaction: 'tx_failed', operations: ['op_something_new'] }, 'rejected'],
  ];
  for (const [codes, reason] of cases) {
    await withNetwork(async (network) => {
      network.horizon('transactions', () => horizonTransactionFailed(codes));
      assert.deepEqual(await submitSigned(signedXdr, ENDPOINTS), {
        ok: false,
        reason,
        hash,
        codes: { operations: [], ...codes },
      });
    });
  }
});

test('when Horizon stops waiting, the payment is "still pending" with its reference code, not failed', async () => {
  const { signedXdr, hash } = await signedPayment();
  await withNetwork(async (network) => {
    network.horizon('transactions', () =>
      new Response(JSON.stringify({ type: 'https://stellar.org/horizon-errors/timeout', title: 'Timeout', status: 504 }), {
        status: 504,
      }),
    );
    assert.deepEqual(await submitSigned(signedXdr, ENDPOINTS), { ok: false, reason: 'still-pending', hash });
  });
});

test('nothing unsigned, signed for another network or unreadable is ever sent', async () => {
  const setup = installFakeNetwork();
  setup.horizon(`accounts/${ME}`, () => horizonAccount(WALLET));
  const built = await buildPayment({ from: ME, to: YOU, amount: '3' }, ENDPOINTS);
  setup.restore();
  await withNetwork(async (network) => {
    const cases = [
      [built.xdr, 'not-signed-for-testnet'],
      [signAs(WALLET, built.xdr, PUBLIC_NAME), 'not-signed-for-testnet'],
      [signAs(FRIEND, built.xdr), 'not-signed-for-testnet'],
      ['not a change', 'not-a-transaction'],
    ];
    for (const [signedXdr, reason] of cases) {
      assert.deepEqual(await submitSigned(signedXdr, ENDPOINTS), { ok: false, reason });
    }
    assert.equal(network.requests.length, 0);
  });
});
