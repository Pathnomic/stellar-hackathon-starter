/**
 * The Freighter wallet in a page, with the page and the extension stood in for.
 *
 * Freighter's library talks to the extension by `window.postMessage` to the
 * page's own origin and waits for a reply; an extension that is not installed
 * never replies, and the library gives up after two seconds. So the stand-in
 * here is a `window` whose `postMessage` either answers the way the extension
 * does or stays silent - the same absence the library and `freighter.ts` see
 * in a real browser. The two-second wait is run on a mock clock.
 *
 * Held here: no extension, a page inside Tellop's preview, and a page with an
 * opaque origin are all "not available", with nothing in the console, and the
 * last two never even ask; a wallet on another network is refused before it is
 * asked to sign; what the wallet is handed names the test network and the
 * connected account; and what comes back is used only if it is exactly the
 * prepared change, signed by that account, for the test network.
 *
 * `window` must exist before Freighter's library loads (it decides once
 * whether it is in a browser), so the library is imported after the stand-in.
 */

import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { Account, Asset, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

import { FRIEND, PUBLIC_NAME, TESTNET_NAME, WALLET, captureConsole } from './fixtures/stellar/fake-network.mjs';

const ME = WALLET.publicKey();
const REQUEST = 'FREIGHTER_EXTERNAL_MSG_REQUEST';
const RESPONSE = 'FREIGHTER_EXTERNAL_MSG_RESPONSE';
const APP_PAGE = Object.freeze({ protocol: 'http:', origin: 'http://fundraiser.localhost:3000' });
const PREVIEW_PAGE = Object.freeze({ protocol: 'tellop-run:', origin: 'tellop-run://0123456789abcdef0123456789abcdef.invalid' });

const listeners = new Set();
const posted = [];
let extension = null;

const page = {
  location: APP_PAGE,
  postMessage(message, targetOrigin) {
    posted.push({ message, targetOrigin });
    if (extension === null || message?.source !== REQUEST) return;
    const reply = extension(message);
    setImmediate(() => {
      for (const listener of [...listeners]) {
        listener({ source: page, data: { source: RESPONSE, messagedId: message.messageId, ...reply } });
      }
    });
  },
  addEventListener(type, listener) {
    if (type === 'message') listeners.add(listener);
  },
  removeEventListener(type, listener) {
    listeners.delete(listener);
  },
};
globalThis.window = page;

const { connectWallet, freighterStatus, insideTellopPreview, signWithWallet } = await import('../lib/stellar/freighter.ts');
const { readSignedTransaction } = await import('../lib/stellar/network.ts');

/** An extension that answers like Freighter, set up as described. */
function freighter({ allowed = true, network = TESTNET_NAME, refuse = null, signFor = null, swap = false } = {}) {
  return (message) => {
    switch (message.type) {
      case 'REQUEST_CONNECTION_STATUS':
        return { isConnected: true };
      case 'REQUEST_ALLOWED_STATUS':
        return { isAllowed: allowed };
      case 'REQUEST_PUBLIC_KEY':
        return { publicKey: allowed ? ME : '' };
      case 'REQUEST_ACCESS':
        return refuse === 'access' ? { apiError: { code: -4, message: 'The user rejected this request.' } } : { publicKey: ME };
      case 'REQUEST_NETWORK_DETAILS':
        return {
          networkDetails: {
            network: network === TESTNET_NAME ? 'TESTNET' : 'PUBLIC',
            networkPassphrase: network,
            networkUrl: 'https://horizon-testnet.stellar.org',
          },
        };
      case 'SUBMIT_TRANSACTION': {
        if (refuse === 'sign') return { apiError: { code: -4, message: 'The user rejected this request.' } };
        if (refuse === 'broken') return { apiError: { code: -1, message: 'The wallet encountered an internal error.' } };
        const source = swap ? payment('2') : message.transactionXdr;
        const signing = TransactionBuilder.fromXDR(source, signFor ?? message.networkPassphrase);
        signing.sign(WALLET);
        return { signedTransaction: signing.toXDR(), signerAddress: ME };
      }
      default:
        return {};
    }
  };
}

/** An unsigned test money payment from `from`, for the test network. */
function payment(amount = '1', from = ME) {
  return new TransactionBuilder(new Account(from, '41'), { fee: '100', networkPassphrase: TESTNET_NAME })
    .addOperation(Operation.payment({ destination: FRIEND.publicKey(), asset: Asset.native(), amount }))
    .setTimeout(300)
    .build()
    .toXDR();
}

/** Resets the page and the extension, runs `check`, and asserts the console stayed silent. */
async function inPage({ location = APP_PAGE, installed = null } = {}, check) {
  page.location = location;
  extension = installed;
  posted.length = 0;
  const quiet = captureConsole();
  try {
    await check();
  } finally {
    quiet.restore();
  }
  assert.deepEqual(quiet.seen, [], 'nothing was written to the console');
}

const asked = () => posted.map(({ message }) => message.type);

test('a browser without Freighter: "not available" after the library\'s wait, asked once, silently', async () => {
  await inPage({}, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const status = freighterStatus();
      mock.timers.tick(2000);
      assert.deepEqual(await status, { available: false });
      assert.deepEqual(posted, [
        { message: { source: REQUEST, messageId: posted[0].message.messageId, type: 'REQUEST_CONNECTION_STATUS' }, targetOrigin: APP_PAGE.origin },
      ]);

      const connecting = connectWallet();
      mock.timers.tick(2000);
      assert.deepEqual(await connecting, { ok: false, reason: 'wallet-missing' });

      const signing = signWithWallet(payment(), ME);
      mock.timers.tick(2000);
      assert.deepEqual(await signing, { ok: false, reason: 'wallet-missing' });
      assert.deepEqual(asked(), ['REQUEST_CONNECTION_STATUS', 'REQUEST_CONNECTION_STATUS', 'REQUEST_CONNECTION_STATUS']);
    } finally {
      mock.timers.reset();
    }
  });
});

test("inside Tellop's preview nothing asks for the wallet: the page is told to open in the browser", async () => {
  await inPage({ location: PREVIEW_PAGE, installed: freighter() }, async () => {
    assert.equal(insideTellopPreview(), true);
    assert.deepEqual(await freighterStatus(), { available: false });
    assert.deepEqual(await connectWallet(), { ok: false, reason: 'open-in-browser' });
    assert.deepEqual(await signWithWallet(payment(), ME), { ok: false, reason: 'open-in-browser' });
    assert.deepEqual(posted, [], 'no message was posted');
  });
});

test('a page with no real origin (a local file, a sandboxed frame) never asks either', async () => {
  await inPage({ location: { protocol: 'file:', origin: 'null' }, installed: freighter() }, async () => {
    assert.equal(insideTellopPreview(), false);
    assert.deepEqual(await freighterStatus(), { available: false });
    assert.deepEqual(await connectWallet(), { ok: false, reason: 'wallet-missing' });
    assert.deepEqual(posted, []);
  });
});

test('installed but not yet allowed: available, not connected, and no window opened', async () => {
  await inPage({ installed: freighter({ allowed: false }) }, async () => {
    assert.deepEqual(await freighterStatus(), { available: true, connected: false });
    assert.equal(asked().includes('REQUEST_ACCESS'), false);
  });
});

test('allowed: the address, and whether the wallet is set to the test network', async () => {
  await inPage({ installed: freighter() }, async () => {
    assert.deepEqual(await freighterStatus(), { available: true, connected: true, address: ME, network: 'testnet' });
  });
  await inPage({ installed: freighter({ network: PUBLIC_NAME }) }, async () => {
    assert.deepEqual(await freighterStatus(), { available: true, connected: true, address: ME, network: 'other' });
  });
});

test('connecting: the address on the test network; another network, a "no" and a wallet error are each named', async () => {
  const cases = [
    [freighter(), { ok: true, address: ME }],
    [freighter({ network: PUBLIC_NAME }), { ok: false, reason: 'wrong-network', address: ME }],
    [freighter({ refuse: 'access' }), { ok: false, reason: 'declined' }],
    [(message) => (message.type === 'REQUEST_ACCESS' ? { apiError: { code: -1, message: 'internal' } } : freighter()(message)), { ok: false, reason: 'wallet-error' }],
  ];
  for (const [installed, expected] of cases) {
    await inPage({ installed }, async () => {
      assert.deepEqual(await connectWallet(), expected);
    });
  }
});

test('signing hands the wallet the test network and the connected account, and checks what comes back', async () => {
  await inPage({ installed: freighter() }, async () => {
    const unsigned = payment();
    const signed = await signWithWallet(unsigned, ME);
    assert.equal(signed.ok, true);
    const check = readSignedTransaction(signed.signedXdr);
    assert.equal(check.ok, true);
    assert.equal(check.hash, TransactionBuilder.fromXDR(unsigned, TESTNET_NAME).hash().toString('hex'));
    const request = posted.find(({ message }) => message.type === 'SUBMIT_TRANSACTION').message;
    assert.equal(request.networkPassphrase, TESTNET_NAME);
    assert.equal(request.accountToSign, ME);
    assert.equal(request.transactionXdr, unsigned);
  });
});

test('a wallet on another network is refused before it is asked to sign', async () => {
  await inPage({ installed: freighter({ network: PUBLIC_NAME }) }, async () => {
    assert.deepEqual(await signWithWallet(payment(), ME), { ok: false, reason: 'wrong-network' });
    assert.equal(asked().includes('SUBMIT_TRANSACTION'), false);
  });
});

test("what comes back is used only if it is exactly the prepared change, signed for the test network", async () => {
  const cases = [
    [freighter({ signFor: PUBLIC_NAME }), 'not-signed-for-testnet'],
    [freighter({ swap: true }), 'wallet-error'],
    [freighter({ refuse: 'sign' }), 'declined'],
    [freighter({ refuse: 'broken' }), 'wallet-error'],
  ];
  for (const [installed, reason] of cases) {
    await inPage({ installed }, async () => {
      assert.deepEqual(await signWithWallet(payment(), ME), { ok: false, reason });
    });
  }
});

test("a change that is not the connected account's own, or not a change at all, is never handed to the wallet", async () => {
  await inPage({ installed: freighter() }, async () => {
    assert.deepEqual(await signWithWallet(payment('1', FRIEND.publicKey()), ME), { ok: false, reason: 'wrong-account' });
    assert.deepEqual(await signWithWallet('not a change', ME), { ok: false, reason: 'not-a-transaction' });
    assert.deepEqual(await signWithWallet(payment(), ME.toLowerCase()), { ok: false, reason: 'invalid-address' });
    assert.deepEqual(posted, []);
  });
});
