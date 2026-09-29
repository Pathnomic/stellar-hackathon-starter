/**
 * The wallet where there is no browser at all: on the server, and in a check.
 *
 * With no page there is no wallet to ask, and that is an answer, not an error:
 * every call says so at once, without throwing and without writing to the
 * console. The browser cases (no extension, Tellop's preview, a connected
 * wallet) are in `tests/stellar-freighter-browser.test.mjs`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { connectWallet, freighterStatus, insideTellopPreview, signWithWallet } from '../lib/stellar/freighter.ts';
import { WALLET, captureConsole } from './fixtures/stellar/fake-network.mjs';

test('with no page, the wallet is simply not available, and nothing is written to the console', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  const quiet = captureConsole();
  let answers;
  try {
    answers = [
      insideTellopPreview(),
      await freighterStatus(),
      await connectWallet(),
      await signWithWallet('AAAA', WALLET.publicKey()),
    ];
  } finally {
    quiet.restore();
  }
  assert.deepEqual(answers, [
    false,
    { available: false },
    { ok: false, reason: 'wallet-missing' },
    { ok: false, reason: 'wallet-missing' },
  ]);
  assert.deepEqual(quiet.seen, []);
});
