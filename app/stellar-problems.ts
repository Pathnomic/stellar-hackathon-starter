/**
 * Words for every reason a call in `lib/stellar/` can answer "no".
 *
 * Every call there answers `{ ok: false, reason }` with one of
 * `STELLAR_PROBLEMS`, and a reason is never a sentence itself: this is where it
 * becomes one, in the reader's language. Each reason has exactly one message
 * key, and each key has words in both `lib/i18n/locales/en.json` and `tr.json`
 * (`tests/stellar-words.test.mjs` holds both to that).
 *
 * The keys are written out one by one rather than built from the reason, so
 * that Tellop's word checks, which look for message keys written in the code,
 * can see every one of them.
 */

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';
import type { StellarProblem } from '../lib/stellar/network.ts';

/** The message key for each reason in `STELLAR_PROBLEMS`. */
export const PROBLEM_MESSAGE_KEYS: Readonly<Record<StellarProblem, string>> = Object.freeze({
  'invalid-address': 'error.stellarInvalidAddress',
  'invalid-contract-id': 'error.stellarInvalidContractId',
  'invalid-amount': 'error.stellarInvalidAmount',
  unreachable: 'error.stellarUnreachable',
  busy: 'error.stellarBusy',
  'unexpected-answer': 'error.stellarUnexpectedAnswer',
  'not-funded': 'error.stellarNotFunded',
  'destination-not-funded': 'error.stellarDestinationNotFunded',
  'not-enough-test-money': 'error.stellarNotEnoughTestMoney',
  'below-minimum': 'error.stellarBelowMinimum',
  'open-in-browser': 'error.stellarOpenInBrowser',
  'wallet-missing': 'error.stellarWalletMissing',
  declined: 'error.stellarDeclined',
  'wrong-network': 'error.stellarWrongNetwork',
  'wrong-account': 'error.stellarWrongAccount',
  'wallet-error': 'error.stellarWalletError',
  'not-a-transaction': 'error.stellarNotATransaction',
  'not-signed-for-testnet': 'error.stellarNotSignedForTestnet',
  'out-of-date': 'error.stellarOutOfDate',
  expired: 'error.stellarExpired',
  'fee-too-low': 'error.stellarFeeTooLow',
  'bad-signature': 'error.stellarBadSignature',
  rejected: 'error.stellarRejected',
  'still-pending': 'error.stellarStillPending',
  'contract-missing': 'error.stellarContractMissing',
  'not-a-fundraiser': 'error.stellarNotAFundraiser',
  archived: 'error.stellarArchived',
  'contract-refused': 'error.stellarContractRefused',
  'goal-not-positive': 'error.stellarGoalNotPositive',
  'deadline-in-past': 'error.stellarDeadlineInPast',
  'amount-not-positive': 'error.stellarAmountNotPositive',
  ended: 'error.stellarEnded',
  'not-ended': 'error.stellarNotEnded',
  'goal-not-reached': 'error.stellarGoalNotReached',
  'goal-reached': 'error.stellarGoalReached',
  'already-withdrawn': 'error.stellarAlreadyWithdrawn',
  'nothing-to-refund': 'error.stellarNothingToRefund',
  overflow: 'error.stellarOverflow',
  paused: 'error.stellarPaused',
  'self-contribution': 'error.stellarSelfContribution',
  'beneficiary-is-contract': 'error.stellarBeneficiaryIsContract',
} satisfies Record<StellarProblem, string>);

/** Used for a reason this page does not know, which only a newer library could send. */
const FALLBACK_REASON_WORDS = PROBLEM_MESSAGE_KEYS['unexpected-answer'];

/** The words for `reason`, in `locale`. */
export function problemWords(reason: StellarProblem, locale: Locale): string {
  const key = Object.hasOwn(PROBLEM_MESSAGE_KEYS, reason) ? PROBLEM_MESSAGE_KEYS[reason] : FALLBACK_REASON_WORDS;
  return t(key, locale);
}
