/**
 * What the wallet panel shows, decided from what it knows.
 *
 * The panel (`wallet-panel.tsx`) finds things out one at a time: where the
 * page is showing, whether Freighter is in this browser, the connected wallet
 * and its network, its test money, the fundraiser, and what this wallet gave
 * to it. {@link panelView} turns what is known so far into exactly one thing
 * to show, so every combination is decided here, in one place, and the checks
 * in `tests/` hold it without a browser, a wallet or a network.
 *
 * The rules it keeps:
 *  - Inside Tellop's preview no wallet can run, so the panel only says how to
 *    open the app in a browser, and draws no button to connect.
 *  - A browser without Freighter gets words and a resting connect button,
 *    never a button that always refuses.
 *  - A wallet on another network is asked to switch to the test network.
 *  - Donating, collecting and taking money back all need test money for the
 *    network's small fee, so none of them is offered until the wallet has
 *    some; the panel offers free test money first.
 *  - Which fundraiser action is offered follows the contract's own rules
 *    (`contracts/fundraiser/REVIEW.md`): donate while it runs and is not
 *    paused; once it has ended, collect the money if the goal was reached and
 *    it is not paid out yet, or take a donation back if the goal was missed.
 *
 * Pure, with no network and no clock.
 */

import type { FundraiserReading } from '../lib/stellar/fundraiser.ts';
import { balanceToStroops } from '../lib/stellar/network.ts';
import type { StellarProblem } from '../lib/stellar/network.ts';

/** The person's wallet, as far as the panel has found out. */
export type WalletState =
  /** Not looked yet: the first paint, on the server and in the browser alike. */
  | { readonly kind: 'checking' }
  /** Inside Tellop's preview, where no wallet can run. */
  | { readonly kind: 'preview' }
  /** No Freighter in this browser. */
  | { readonly kind: 'missing' }
  /** Freighter is here; the person has not connected it on this visit. */
  | { readonly kind: 'ready'; readonly problem: StellarProblem | null }
  /** Waiting for the person to answer Freighter. */
  | { readonly kind: 'connecting' }
  | { readonly kind: 'wrong-network'; readonly address: string; readonly busy: boolean }
  | { readonly kind: 'connected'; readonly address: string };

/** The connected wallet's test money. */
export type BalanceState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'not-funded' }
  | { readonly kind: 'funded'; readonly testMoney: string }
  | { readonly kind: 'problem'; readonly reason: StellarProblem };

/** What the connected wallet has given to the fundraiser and not had back. */
export type ContributionState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'known'; readonly amount: string }
  | { readonly kind: 'problem'; readonly reason: StellarProblem };

export type PanelInput = {
  readonly wallet: WalletState;
  /** Read only once a wallet is connected; ignored before. */
  readonly balance: BalanceState;
  /** Whether this app's fundraiser has been published. */
  readonly published: boolean;
  /** The published fundraiser as last read, or `null` while it is being read. */
  readonly fundraiser: FundraiserReading | null;
  readonly contribution: ContributionState;
};

/** The fundraiser part of the panel. */
export type FundraiserStep =
  | { readonly kind: 'not-published' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'problem'; readonly reason: StellarProblem }
  | { readonly kind: 'donate'; readonly given: string | null }
  | { readonly kind: 'paused'; readonly given: string | null }
  | { readonly kind: 'collect'; readonly given: string | null }
  | { readonly kind: 'paid-out'; readonly given: string | null }
  | { readonly kind: 'refund'; readonly given: string }
  | { readonly kind: 'nothing-to-refund' };

export type PanelView =
  | { readonly kind: 'checking' }
  | { readonly kind: 'preview' }
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'connect'; readonly busy: boolean; readonly problem: StellarProblem | null }
  | { readonly kind: 'wrong-network'; readonly address: string; readonly busy: boolean }
  | {
      readonly kind: 'wallet';
      readonly address: string;
      readonly balance: BalanceState;
      /** Sending test money: only with test money to send. */
      readonly canSend: boolean;
      /** `null` until the wallet has test money: every fundraiser action needs some. */
      readonly fundraiser: FundraiserStep | null;
    };

/** Whether an amount of test money ("0", "12.5") is more than nothing. */
function isSomething(amount: string): boolean {
  const stroops = balanceToStroops(amount);
  return stroops !== null && stroops > BigInt(0);
}

/** What this wallet gave, when it is known and more than nothing. */
function givenAmount(contribution: ContributionState): string | null {
  return contribution.kind === 'known' && isSomething(contribution.amount) ? contribution.amount : null;
}

/** The fundraiser part, for a connected wallet that has test money. */
export function fundraiserStep(
  published: boolean,
  fundraiser: FundraiserReading | null,
  contribution: ContributionState,
): FundraiserStep {
  if (!published) return { kind: 'not-published' };
  if (fundraiser === null) return { kind: 'reading' };
  if (!fundraiser.ok) return { kind: 'problem', reason: fundraiser.reason };
  const given = givenAmount(contribution);
  if (fundraiser.state === 'running') return fundraiser.paused ? { kind: 'paused', given } : { kind: 'donate', given };
  if (fundraiser.state === 'succeeded') return fundraiser.withdrawn ? { kind: 'paid-out', given } : { kind: 'collect', given };
  // Ended short of the goal: whether there is anything to take back depends on this wallet.
  if (contribution.kind === 'reading') return { kind: 'reading' };
  if (contribution.kind === 'problem') return { kind: 'problem', reason: contribution.reason };
  return given === null ? { kind: 'nothing-to-refund' } : { kind: 'refund', given };
}

/** The one thing the panel shows now. */
export function panelView(input: PanelInput): PanelView {
  const { wallet } = input;
  switch (wallet.kind) {
    case 'checking':
      return { kind: 'checking' };
    case 'preview':
      return { kind: 'preview' };
    case 'missing':
      return { kind: 'no-wallet' };
    case 'ready':
      return { kind: 'connect', busy: false, problem: wallet.problem };
    case 'connecting':
      return { kind: 'connect', busy: true, problem: null };
    case 'wrong-network':
      return { kind: 'wrong-network', address: wallet.address, busy: wallet.busy };
    case 'connected': {
      const funded = input.balance.kind === 'funded';
      return {
        kind: 'wallet',
        address: wallet.address,
        balance: input.balance,
        canSend: funded,
        fundraiser: funded ? fundraiserStep(input.published, input.fundraiser, input.contribution) : null,
      };
    }
  }
}

/** A wallet address shortened for reading: its first and last four characters. */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
