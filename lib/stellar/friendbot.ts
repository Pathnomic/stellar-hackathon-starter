/**
 * Free test money for a wallet, from Friendbot (the test network's faucet).
 *
 * Friendbot gives a new wallet its first test money, and that is also what makes
 * the wallet exist on the network. It gives only once: asking again for a wallet
 * that already exists is answered `already-funded`, which is a normal result,
 * not an error.
 *
 * Call it only when the person asks for test money for their connected wallet.
 * The request is a plain read (`GET ?addr=...`) with no headers of its own, no
 * cookies and a bounded wait (`http.ts`).
 */

import { isRecord, requestJson } from './http.ts';
import { isAccountAddress, isTransactionHash, resolveEndpoints } from './network.ts';
import type { Endpoints } from './network.ts';

/** Friendbot waits for the network to confirm before it answers; that can take a while. */
const FRIENDBOT_TIMEOUT_MS = 30_000;

export type FundResult =
  | {
      readonly ok: true;
      readonly state: 'funded';
      /** The reference code of the change that paid the wallet, when Friendbot gave one. */
      readonly hash: string | null;
    }
  | { readonly ok: true; readonly state: 'already-funded' }
  | {
      readonly ok: false;
      readonly reason: 'invalid-address' | 'unreachable' | 'busy' | 'rejected' | 'unexpected-answer';
    };

/*
 * How Friendbot says "this wallet already has its test money". It has said it
 * three ways over time, so all three are read: the plain sentence, the name the
 * JavaScript SDK looks for, and the network's own "already exists" code.
 */
function alreadyFunded(body: unknown): boolean {
  if (!isRecord(body)) return false;
  const detail = typeof body.detail === 'string' ? body.detail : '';
  if (/already funded/i.test(detail) || detail.includes('createAccountAlreadyExist')) return true;
  const extras = isRecord(body.extras) ? body.extras : undefined;
  const codes = extras !== undefined && isRecord(extras.result_codes) ? extras.result_codes : undefined;
  return codes !== undefined && Array.isArray(codes.operations) && codes.operations.includes('op_already_exists');
}

/** Asks Friendbot to give `address` its test money. */
export async function fundWithTestMoney(address: string, endpoints?: Endpoints): Promise<FundResult> {
  if (!isAccountAddress(address)) return { ok: false, reason: 'invalid-address' };
  const { friendbotUrl } = resolveEndpoints(endpoints);
  const url = new URL(friendbotUrl);
  url.searchParams.set('addr', address);
  const answer = await requestJson(url.href, { method: 'GET', timeoutMs: FRIENDBOT_TIMEOUT_MS });
  if (answer.kind === 'unreachable') return { ok: false, reason: 'unreachable' };
  if (answer.status === 200) {
    const hash = isRecord(answer.body) && isTransactionHash(answer.body.hash) ? answer.body.hash : null;
    return { ok: true, state: 'funded', hash };
  }
  if (alreadyFunded(answer.body)) return { ok: true, state: 'already-funded' };
  if (answer.status === 429 || answer.status === 503) return { ok: false, reason: 'busy' };
  if (answer.status >= 500) return { ok: false, reason: 'unreachable' };
  if (answer.status >= 400) return { ok: false, reason: 'rejected' };
  return { ok: false, reason: 'unexpected-answer' };
}
