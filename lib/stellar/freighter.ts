/**
 * The person's Freighter wallet: is it here, connect it, and sign with it.
 *
 * Freighter is a browser extension. It lives only in the person's own browser
 * (Chrome, Brave, Firefox...), never inside Tellop's preview, and never on the
 * server. Its absence is a normal state, not an error: every function here
 * answers it with a result, never throws for it and never writes to the
 * console.
 *
 *  - Inside Tellop's preview (`insideTellopPreview()`), the page should say
 *    "open this app in your browser to use your wallet" (Tellop has a button for
 *    that). Nothing here even asks for the wallet there.
 *  - In a browser without Freighter, {@link freighterStatus} takes about two
 *    seconds to answer `{ available: false }`: that is how long the Freighter
 *    library waits for an extension that never replies.
 *
 * Everything is signed for the test network only: the network name handed to
 * the wallet is the test network's, a wallet set to another network is refused
 * before it is asked to sign (`wrong-network`), and what comes back is checked
 * to be signed for the test network before a page can send it.
 */

import freighterApi from '@stellar/freighter-api';
import { Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

import { TESTNET_PASSPHRASE, isAccountAddress, readSignedTransaction } from './network.ts';

/** Freighter's own code for "the person said no". */
const DECLINED_CODE = -4;

type PageLocation = { readonly protocol?: unknown; readonly origin?: unknown };

function pageLocation(): PageLocation | undefined {
  if (typeof window === 'undefined') return undefined;
  const location: unknown = window.location;
  return typeof location === 'object' && location !== null ? (location as PageLocation) : undefined;
}

/** Whether this page is showing inside Tellop's preview, where no wallet can run. */
export function insideTellopPreview(): boolean {
  return pageLocation()?.protocol === 'tellop-run:';
}

/*
 * Whether it is worth asking for the wallet at all: a page in a real browser
 * tab, outside Tellop's preview, with a real origin. The Freighter library
 * talks to the extension with `window.postMessage` addressed to the page's own
 * origin; a page with an opaque origin ("null": a local file, a sandboxed
 * frame) cannot be addressed that way, and the library would write an error to
 * the console trying.
 */
function walletCanBeHere(): boolean {
  const location = pageLocation();
  if (location === undefined || insideTellopPreview()) return false;
  return typeof location.origin === 'string' && location.origin !== '' && location.origin !== 'null';
}

type WalletError = { readonly code?: unknown } | undefined;

function declinedOr(error: WalletError): 'declined' | 'wallet-error' {
  return error?.code === DECLINED_CODE ? 'declined' : 'wallet-error';
}

/** Asks whether the extension is installed. Freighter's library gives up after about two seconds. */
async function extensionPresent(): Promise<boolean> {
  const answer = await freighterApi.isConnected();
  return answer.error === undefined && Boolean(answer.isConnected);
}

export type WalletStatus =
  | { readonly available: false }
  | { readonly available: true; readonly connected: false }
  | {
      readonly available: true;
      readonly connected: true;
      readonly address: string;
      /** `other` means the wallet is set to a network other than the test network. */
      readonly network: 'testnet' | 'other';
    };

/**
 * Whether Freighter is here and whether this app is already connected to it.
 * Asks nothing of the person: no window opens.
 */
export async function freighterStatus(): Promise<WalletStatus> {
  if (!walletCanBeHere()) return { available: false };
  try {
    if (!(await extensionPresent())) return { available: false };
    const allowed = await freighterApi.isAllowed();
    if (allowed.error !== undefined || allowed.isAllowed !== true) return { available: true, connected: false };
    const current = await freighterApi.getAddress();
    if (current.error !== undefined || !isAccountAddress(current.address)) return { available: true, connected: false };
    const network = await freighterApi.getNetwork();
    const onTestnet = network.error === undefined && network.networkPassphrase === TESTNET_PASSPHRASE;
    return { available: true, connected: true, address: current.address, network: onTestnet ? 'testnet' : 'other' };
  } catch {
    return { available: false };
  }
}

export type ConnectResult =
  | { readonly ok: true; readonly address: string }
  | { readonly ok: false; readonly reason: 'open-in-browser' | 'wallet-missing' | 'declined' | 'wallet-error' }
  /** Connected, but the wallet is set to another network: ask the person to switch it to the test network. */
  | { readonly ok: false; readonly reason: 'wrong-network'; readonly address: string };

/**
 * Connects the wallet: Freighter asks the person to allow this app, then this
 * checks the wallet is set to the test network.
 */
export async function connectWallet(): Promise<ConnectResult> {
  if (insideTellopPreview()) return { ok: false, reason: 'open-in-browser' };
  if (!walletCanBeHere()) return { ok: false, reason: 'wallet-missing' };
  try {
    if (!(await extensionPresent())) return { ok: false, reason: 'wallet-missing' };
    const access = await freighterApi.requestAccess();
    if (access.error !== undefined) return { ok: false, reason: declinedOr(access.error) };
    if (!isAccountAddress(access.address)) return { ok: false, reason: 'wallet-error' };
    const network = await freighterApi.getNetwork();
    if (network.error !== undefined) return { ok: false, reason: declinedOr(network.error) };
    if (network.networkPassphrase !== TESTNET_PASSPHRASE) {
      return { ok: false, reason: 'wrong-network', address: access.address };
    }
    return { ok: true, address: access.address };
  } catch {
    return { ok: false, reason: 'wallet-error' };
  }
}

export type SignResult =
  | { readonly ok: true; readonly signedXdr: string }
  | {
      readonly ok: false;
      readonly reason:
        | 'open-in-browser'
        | 'wallet-missing'
        | 'invalid-address'
        | 'not-a-transaction'
        | 'wrong-account'
        | 'wrong-network'
        | 'declined'
        | 'not-signed-for-testnet'
        | 'wallet-error';
    };

/**
 * Asks the wallet to sign a change this library prepared (`buildPayment`,
 * `buildContribute`, `buildWithdraw`, `buildRefund`) with `address`, the
 * connected account, for the test network.
 *
 * The change must be the connected account's own, the wallet must be set to the
 * test network, and what comes back must be exactly that change, signed by that
 * account for the test network.
 */
export async function signWithWallet(unsignedXdr: string, address: string): Promise<SignResult> {
  if (insideTellopPreview()) return { ok: false, reason: 'open-in-browser' };
  if (!walletCanBeHere()) return { ok: false, reason: 'wallet-missing' };
  if (!isAccountAddress(address)) return { ok: false, reason: 'invalid-address' };
  let unsigned: Transaction;
  try {
    const decoded = TransactionBuilder.fromXDR(unsignedXdr, TESTNET_PASSPHRASE);
    if (!(decoded instanceof Transaction)) return { ok: false, reason: 'not-a-transaction' };
    unsigned = decoded;
  } catch {
    return { ok: false, reason: 'not-a-transaction' };
  }
  if (unsigned.source !== address) return { ok: false, reason: 'wrong-account' };
  try {
    // Asked first: without the extension, Freighter's other questions never return.
    if (!(await extensionPresent())) return { ok: false, reason: 'wallet-missing' };
    const network = await freighterApi.getNetwork();
    if (network.error !== undefined) return { ok: false, reason: declinedOr(network.error) };
    if (network.networkPassphrase !== TESTNET_PASSPHRASE) return { ok: false, reason: 'wrong-network' };
    const signed = await freighterApi.signTransaction(unsignedXdr, { networkPassphrase: TESTNET_PASSPHRASE, address });
    if (signed.error !== undefined) return { ok: false, reason: declinedOr(signed.error) };
    const check = readSignedTransaction(signed.signedTxXdr);
    if (!check.ok) return { ok: false, reason: check.reason };
    if (check.hash !== unsigned.hash().toString('hex')) return { ok: false, reason: 'wallet-error' };
    return { ok: true, signedXdr: signed.signedTxXdr };
  } catch {
    return { ok: false, reason: 'wallet-error' };
  }
}
