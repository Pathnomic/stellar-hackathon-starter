/**
 * The test network's addresses, and the checks every other Stellar call leans on.
 *
 * `lib/stellar/network.ts` is where "only Stellar's test network" is decided:
 * the network name is a constant, anything else is refused by name, and an
 * override of the service addresses exists only for these checks and cannot
 * reach a real service. The address, amount and link checks are called with
 * the near misses a page could hand them. Nothing here reaches the network.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Account, Asset, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

import {
  NotTestnetError,
  STELLAR_PROBLEMS,
  TESTNET,
  TESTNET_PASSPHRASE,
  assertTestnet,
  explorerAccountUrl,
  explorerContractUrl,
  explorerTxUrl,
  formatTestMoney,
  isAccountAddress,
  isContractAddress,
  isTestnet,
  readSignedTransaction,
  resolveEndpoints,
  toStroops,
} from '../lib/stellar/network.ts';
import { CONTRACT_ID, FRIEND, PUBLIC_NAME, WALLET, signAs } from './fixtures/stellar/fake-network.mjs';

const HASH = 'a'.repeat(64);

test('the network is the test network, by the exact name the SDK gives it', () => {
  assert.equal(TESTNET_PASSPHRASE, 'Test SDF Network ; September 2015');
  assert.equal(TESTNET_PASSPHRASE, Networks.TESTNET);
  assert.deepEqual(
    { ...TESTNET },
    {
      passphrase: TESTNET_PASSPHRASE,
      horizonUrl: 'https://horizon-testnet.stellar.org',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      friendbotUrl: 'https://friendbot.stellar.org',
      explorerUrl: 'https://stellar.expert/explorer/testnet',
    },
  );
  assert.equal(Object.isFrozen(TESTNET), true);
  assert.throws(() => {
    TESTNET.passphrase = Networks.PUBLIC;
  }, TypeError);
});

test('the main network, and every other name, is refused by name', () => {
  assert.doesNotThrow(() => assertTestnet(TESTNET_PASSPHRASE));
  for (const other of [PUBLIC_NAME, Networks.PUBLIC, Networks.FUTURENET, `${TESTNET_PASSPHRASE} `, '', undefined, null, 42]) {
    assert.equal(isTestnet(other), false, String(other));
    assert.throws(
      () => assertTestnet(other),
      (error) => error instanceof NotTestnetError && error.code === 'not-testnet',
      String(other),
    );
  }
});

test('with no overrides every call uses the test network, and the network name has no override at all', () => {
  const plain = resolveEndpoints();
  assert.deepEqual(plain, {
    horizonUrl: TESTNET.horizonUrl,
    rpcUrl: TESTNET.rpcUrl,
    friendbotUrl: TESTNET.friendbotUrl,
    pollIntervalMs: 1000,
    rpcAllowsHttp: false,
  });
  assert.throws(() => resolveEndpoints({ networkPassphrase: PUBLIC_NAME }), TypeError);
  assert.throws(() => resolveEndpoints({ passphrase: PUBLIC_NAME }), TypeError);
});

test("an override may point only at this computer or a reserved test name, never at a real service", () => {
  const local = resolveEndpoints({ rpcUrl: 'http://127.0.0.1:9/rpc', horizonUrl: 'https://horizon.fixture.test' });
  assert.equal(local.rpcUrl, 'http://127.0.0.1:9/rpc');
  assert.equal(local.rpcAllowsHttp, true);
  assert.equal(local.horizonUrl, 'https://horizon.fixture.test');
  assert.equal(local.friendbotUrl, TESTNET.friendbotUrl);
  for (const refused of [
    'https://horizon.stellar.org',
    'https://soroban-mainnet.stellar.org',
    'http://horizon-testnet.stellar.org',
    'https://127.0.0.1.example.com',
    'ftp://127.0.0.1/rpc',
    'http://user:pw@127.0.0.1/rpc',
    'http://127.0.0.1/rpc?next=https://horizon.stellar.org',
    'not an address',
  ]) {
    assert.throws(() => resolveEndpoints({ rpcUrl: refused }), TypeError, refused);
  }
});

test('an account address is a G address with a valid checksum, and nothing near it', () => {
  const good = WALLET.publicKey();
  assert.equal(isAccountAddress(good), true);
  const brokenChecksum = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;
  for (const near of [good.toLowerCase(), brokenChecksum, good.slice(1), `${good} `, CONTRACT_ID, `M${good.slice(1)}`, '', 7]) {
    assert.equal(isAccountAddress(near), false, String(near));
  }
  assert.equal(isContractAddress(CONTRACT_ID), true);
  assert.equal(isContractAddress(good), false);
  assert.equal(isContractAddress(CONTRACT_ID.toLowerCase()), false);
});

test('the explorer links are built only from valid values', () => {
  const account = WALLET.publicKey();
  assert.equal(explorerAccountUrl(account), `https://stellar.expert/explorer/testnet/account/${account}`);
  assert.equal(explorerContractUrl(CONTRACT_ID), `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`);
  assert.equal(explorerTxUrl(HASH), `https://stellar.expert/explorer/testnet/tx/${HASH}`);

  for (const bad of [account.toLowerCase(), CONTRACT_ID, `${account}/../../x`, '', undefined]) {
    assert.equal(explorerAccountUrl(bad), null, String(bad));
  }
  for (const bad of [account, CONTRACT_ID.slice(0, 55), `${CONTRACT_ID}?x=1`, null]) {
    assert.equal(explorerContractUrl(bad), null, String(bad));
  }
  for (const bad of [HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, `${'g'.repeat(64)}`, `../${HASH.slice(3)}`, 64]) {
    assert.equal(explorerTxUrl(bad), null, String(bad));
  }
});

test('an amount is positive, has at most 7 decimals, and is read exactly as written', () => {
  assert.equal(toStroops('12.5'), BigInt(125_000_000));
  assert.equal(toStroops('0.0000001'), BigInt(1));
  assert.equal(toStroops('922337203685.4775807'), BigInt('9223372036854775807'));
  assert.equal(toStroops(0.1), BigInt(1_000_000));
  assert.equal(toStroops(250), BigInt(2_500_000_000));
  for (const bad of ['0', '0.0', '-1', '1e3', ' 1', '1 ', '1,5', '.5', '1.', '01', '0.12345678', '922337203685.4775808', '', 0, -1, 0.12345678, 1e-8, Number.NaN, Infinity, 1e21, BigInt(1), null]) {
    assert.equal(toStroops(bad), null, String(bad));
  }
  assert.equal(formatTestMoney(BigInt(125_000_000)), '12.5');
  assert.equal(formatTestMoney(BigInt(10_000) * BigInt(10_000_000)), '10000');
  assert.equal(formatTestMoney(BigInt(1)), '0.0000001');
  assert.equal(formatTestMoney(BigInt(0)), '0');
});

test('a signed change is accepted only when its own account signed it for the test network', () => {
  const unsigned = new TransactionBuilder(new Account(WALLET.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(Operation.payment({ destination: FRIEND.publicKey(), asset: Asset.native(), amount: '1' }))
    .setTimeout(300)
    .build()
    .toXDR();

  const good = readSignedTransaction(signAs(WALLET, unsigned));
  assert.equal(good.ok, true);
  assert.match(good.hash, /^[0-9a-f]{64}$/);

  assert.deepEqual(readSignedTransaction(unsigned), { ok: false, reason: 'not-signed-for-testnet' });
  assert.deepEqual(readSignedTransaction(signAs(WALLET, unsigned, PUBLIC_NAME)), { ok: false, reason: 'not-signed-for-testnet' });
  assert.deepEqual(readSignedTransaction(signAs(FRIEND, unsigned)), { ok: false, reason: 'not-signed-for-testnet' });
  for (const junk of ['', 'AAAA', 'not base64 at all', 12, undefined]) {
    assert.deepEqual(readSignedTransaction(junk), { ok: false, reason: 'not-a-transaction' }, String(junk));
  }
});

test('every reason is named once, and none is a sentence', () => {
  assert.equal(new Set(STELLAR_PROBLEMS).size, STELLAR_PROBLEMS.length);
  assert.equal(Object.isFrozen(STELLAR_PROBLEMS), true);
  for (const reason of STELLAR_PROBLEMS) assert.match(reason, /^[a-z]+(?:-[a-z]+)*$/, reason);
  assert.equal(StrKey.isValidContract(CONTRACT_ID), true);
});
