/**
 * Free test money from Friendbot, against a stand-in.
 *
 * The call is one plain read, `GET ?addr=<wallet>`, with nothing else attached.
 * A wallet that already has its test money is an ordinary answer
 * (`already-funded`) in every way Friendbot has said so; a busy or unreachable
 * Friendbot is named, never thrown, and nothing is written to the console.
 * Nothing reaches the network.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fundWithTestMoney } from '../lib/stellar/friendbot.ts';
import {
  ENDPOINTS,
  FRIENDBOT,
  WALLET,
  captureConsole,
  friendbotAlreadyFunded,
  horizonTransaction,
  horizonTransactionFailed,
  installFakeNetwork,
} from './fixtures/stellar/fake-network.mjs';

const ME = WALLET.publicKey();
const HASH = '3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889';

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

test('a new wallet is funded with one plain read that names only the wallet', async () => {
  await withNetwork(async (network) => {
    network.friendbot(() => horizonTransaction(HASH));
    assert.deepEqual(await fundWithTestMoney(ME, ENDPOINTS), { ok: true, state: 'funded', hash: HASH });
    assert.equal(network.requests.length, 1);
    const [request] = network.requests;
    assert.equal(request.method, 'GET');
    const url = new URL(request.url);
    assert.equal(`${url.origin}${url.pathname}`, FRIENDBOT);
    assert.deepEqual([...url.searchParams.entries()], [['addr', ME]]);
    assert.equal(request.body, undefined);
    assert.deepEqual(request.headers, {}, 'no header of its own');
    assert.equal(request.credentials, 'omit');
  });
});

test('a wallet that already has its test money is "already funded", however Friendbot says it', async () => {
  const answers = [
    () => friendbotAlreadyFunded(),
    () => friendbotAlreadyFunded('createAccountAlreadyExist'),
    () => horizonTransactionFailed({ transaction: 'tx_failed', operations: ['op_already_exists'] }),
  ];
  for (const answer of answers) {
    await withNetwork(async (network) => {
      network.friendbot(answer);
      assert.deepEqual(await fundWithTestMoney(ME, ENDPOINTS), { ok: true, state: 'already-funded' });
    });
  }
});

test('a busy, unreachable or refusing Friendbot is named, never thrown', async () => {
  const cases = [
    [() => new Response('slow down', { status: 429 }), 'busy'],
    [() => new Response('unavailable', { status: 503 }), 'busy'],
    [() => new Response('bad gateway', { status: 502 }), 'unreachable'],
    [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
    [() => new Response(JSON.stringify({ status: 400, detail: 'invalid address' }), { status: 400 }), 'rejected'],
  ];
  for (const [answer, reason] of cases) {
    await withNetwork(async (network) => {
      network.friendbot(answer);
      assert.deepEqual(await fundWithTestMoney(ME, ENDPOINTS), { ok: false, reason });
    });
  }
});

test('an answer without a reference code still counts as funded', async () => {
  await withNetwork(async (network) => {
    network.friendbot(() => new Response(JSON.stringify({ successful: true }), { status: 200 }));
    assert.deepEqual(await fundWithTestMoney(ME, ENDPOINTS), { ok: true, state: 'funded', hash: null });
  });
});

test('an address that is not a valid G address is refused before Friendbot is asked', async () => {
  await withNetwork(async (network) => {
    for (const bad of [ME.toLowerCase(), 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L', `${ME}&addr=x`, '']) {
      assert.deepEqual(await fundWithTestMoney(bad, ENDPOINTS), { ok: false, reason: 'invalid-address' });
    }
    assert.equal(network.requests.length, 0);
  });
});
