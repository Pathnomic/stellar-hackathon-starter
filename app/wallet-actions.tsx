'use client';

import { useEffect, useId, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';
import { insideTellopPreview, signWithWallet } from '../lib/stellar/freighter.ts';
import { buildContribute, buildRefund, buildWithdraw, sendSigned } from '../lib/stellar/fundraiser.ts';
import { buildPayment, submitSigned } from '../lib/stellar/horizon.ts';
import { explorerTxUrl, isAccountAddress } from '../lib/stellar/network.ts';
import type { StellarProblem } from '../lib/stellar/network.ts';

import { amountProblemWords, readAmount } from './amount-text.ts';
import { readableAmount } from './fundraiser-view.ts';
import { problemWords } from './stellar-problems.ts';
import { waitView, watchChanges } from './wallet-wait.ts';
import type { ChangeStage, ChangeWait } from './wallet-wait.ts';

/**
 * The things a connected wallet can do on this page, each one the same three
 * steps: prepare it (the library asks the network what it will take), ask the
 * person to approve it in Freighter, then send it and wait for the answer.
 * While it runs, its button shows a working mark and the step, and a line
 * under it says when Freighter is opening (`wallet-wait.ts`).
 *
 * Every answer is shown in words. A change that went through, or that may
 * still go through, gets a link to Stellar Expert, the public explorer, so the
 * person can see it for themselves; a change that may still go through is
 * never offered again straight away, because both could go through.
 *
 * Only one of these runs at a time (`busy`, held by the panel): two changes
 * from one wallet at once would trip over each other on the network.
 */

/** How a change ended. `hash` is set when the change is, or may be, on the network. */
export type Outcome =
  | { readonly ok: true; readonly hash: string | null; readonly words: string }
  | { readonly ok: false; readonly reason: StellarProblem; readonly hash: string | null };

type Prepared = { readonly ok: true; readonly xdr: string } | { readonly ok: false; readonly reason: StellarProblem };

type Sent = { readonly ok: true; readonly hash: string } | { readonly ok: false; readonly reason: StellarProblem; readonly hash: string | null };

async function runChange(
  address: string,
  prepare: () => Promise<Prepared>,
  send: (signedXdr: string) => Promise<Sent>,
  onStage: (stage: ChangeStage) => void,
): Promise<Sent> {
  onStage('preparing');
  const prepared = await prepare();
  if (!prepared.ok) return { ok: false, reason: prepared.reason, hash: null };
  onStage('approving');
  const signed = await signWithWallet(prepared.xdr, address);
  if (!signed.ok) return { ok: false, reason: signed.reason, hash: null };
  onStage('sending');
  return send(signed.signedXdr);
}

/** A payment, sent through Horizon. Only a payment that may still go through keeps its reference. */
async function sendPayment(signedXdr: string): Promise<Sent> {
  const answer = await submitSigned(signedXdr);
  if (answer.ok) return { ok: true, hash: answer.hash };
  return { ok: false, reason: answer.reason, hash: answer.reason === 'still-pending' ? (answer.hash ?? null) : null };
}

/**
 * A change to the fundraiser. One that reached the network and failed there is
 * on the explorer too; one that may still go through reads as "still going".
 */
async function sendToFundraiser(signedXdr: string): Promise<Sent> {
  const answer = await sendSigned(signedXdr);
  if (answer.ok) return { ok: true, hash: answer.hash };
  if (answer.status === 'pending') return { ok: false, reason: 'still-pending', hash: answer.hash ?? null };
  return { ok: false, reason: answer.reason, hash: answer.status === 'failed' ? (answer.hash ?? null) : null };
}

/** An amount of test money in words: "12.5 test money", "12,5 test parası". */
export function testMoneyWords(amount: string, locale: Locale): string {
  return t('stellar.testMoney', locale, { amount: readableAmount(amount, locale) ?? amount });
}

/** How a change ended, in words, with the explorer link when there is something to see there. */
export function OutcomeLine({ outcome, locale }: { readonly outcome: Outcome | null; readonly locale: Locale }) {
  if (outcome === null) return null;
  // The preview refuses new windows; there is no wallet there to make a change with anyway.
  const link = outcome.hash !== null && !insideTellopPreview() ? explorerTxUrl(outcome.hash) : null;
  return (
    <div className="flex flex-col items-start gap-1">
      {outcome.ok ? (
        <p className="m-0 text-sm" role="status">
          {outcome.words}
        </p>
      ) : (
        <p className="m-0 text-sm text-destructive" role="alert">
          {problemWords(outcome.reason, locale)}
        </p>
      )}
      {link === null ? null : (
        <a className="text-sm underline underline-offset-4" href={link} rel="noopener noreferrer" target="_blank">
          {t('wallet.seeOnExplorer', locale)}
        </a>
      )}
    </div>
  );
}

type ActionProps = {
  readonly locale: Locale;
  /** The connected wallet: it signs, and pays the network's small fee. */
  readonly address: string;
  /** Whether any change is underway on this page. */
  readonly busy: boolean;
  readonly onBusy: (busy: boolean) => void;
  /** Called once a change went through, so the panel reads the wallet and the fundraiser again. */
  readonly onChanged: () => void;
};

type FundraiserActionProps = ActionProps & {
  readonly contractId: string;
  /** Where this action's outcome goes: the panel shows it, so it stays when the action itself is gone. */
  readonly onOutcome: (outcome: Outcome | null) => void;
};

/**
 * One button's wait (`wallet-wait.ts`): followed while the button is on the
 * page, and ended however its work ends.
 */
export function useWait() {
  const [wait, setWait] = useState<ChangeWait | null>(null);
  const [watch] = useState(() => watchChanges(setWait));
  useEffect(() => {
    watch.start();
    return watch.stop;
  }, [watch]);
  return { wait, run: watch.run };
}

/** One change at a time: its steps shown on its button, and the panel busy while it runs. */
function useChange(props: ActionProps) {
  const { wait, run } = useWait();
  const change = (prepare: () => Promise<Prepared>, send: (signedXdr: string) => Promise<Sent>) =>
    run((onStage) => runChange(props.address, prepare, send, onStage), props.onBusy);
  return { wait, run: change };
}

/**
 * A wallet button: its own words at rest; while it works, a working mark and
 * its busy words instead, and under it the lines about Freighter. Those sit in
 * a status area that is always there, so a screen reader hears each line once
 * as it arrives, politely, and nothing here takes the focus. The mark is the
 * kit's spinner, hidden from screen readers: the busy words already say it.
 */
export function ChangeButton(props: {
  readonly wait: ChangeWait | null;
  readonly locale: Locale;
  /** Whether the button rests, as it does while anything on the panel is underway. */
  readonly busy: boolean;
  readonly variant?: 'outline';
  readonly onClick?: () => void;
  readonly type?: 'submit';
  readonly children: ReactNode;
}) {
  const view = waitView(props.wait, props.locale);
  return (
    <div className="flex flex-col items-start">
      <Button disabled={props.busy} onClick={props.onClick} type={props.type} variant={props.variant}>
        {view.working ? (
          <Spinner
            aria-hidden="true"
            aria-label={undefined}
            className="motion-reduce:animate-none"
            data-icon="inline-start"
            role={undefined}
          />
        ) : null}
        {view.step ?? props.children}
      </Button>
      <div aria-atomic="false" role="status">
        {view.lines.map((line) => (
          <p className="m-0 mt-2 text-sm text-muted-foreground" key={line}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Test money to another wallet. */
export function SendForm(props: ActionProps) {
  const { locale, address, busy } = props;
  const ids = useId();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [toProblem, setToProblem] = useState<string | null>(null);
  const [amountProblem, setAmountProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const { wait, run } = useChange(props);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const destination = to.trim();
    const typed = readAmount(amount, locale);
    const destinationWords = isAccountAddress(destination) ? null : problemWords('invalid-address', locale);
    setToProblem(destinationWords);
    setAmountProblem(typed.ok ? null : amountProblemWords(typed.problem, locale));
    setOutcome(null);
    if (destinationWords !== null || !typed.ok) return;
    const result = await run(() => buildPayment({ from: address, to: destination, amount: typed.amount }), sendPayment);
    if (result.ok) {
      setOutcome({ ok: true, hash: result.hash, words: t('wallet.sent', locale, { amount: testMoneyWords(typed.amount, locale) }) });
      setAmount('');
      props.onChanged();
    } else {
      setOutcome(result);
    }
  };

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
      <h3 className="m-0 text-base font-medium">{t('wallet.sendTitle', locale)}</h3>
      <Field data-invalid={toProblem !== null}>
        <FieldLabel htmlFor={`${ids}-to`}>{t('wallet.sendTo', locale)}</FieldLabel>
        <Input
          aria-invalid={toProblem !== null}
          autoCapitalize="characters"
          autoComplete="off"
          disabled={wait !== null}
          id={`${ids}-to`}
          onChange={(event) => setTo(event.target.value)}
          spellCheck={false}
          value={to}
        />
        <FieldDescription>{t('wallet.sendToHint', locale)}</FieldDescription>
        {toProblem === null ? null : <FieldError>{toProblem}</FieldError>}
      </Field>
      <Field data-invalid={amountProblem !== null}>
        <FieldLabel htmlFor={`${ids}-amount`}>{t('wallet.amount', locale)}</FieldLabel>
        <Input
          aria-invalid={amountProblem !== null}
          autoComplete="off"
          disabled={wait !== null}
          id={`${ids}-amount`}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          value={amount}
        />
        {amountProblem === null ? null : <FieldError>{amountProblem}</FieldError>}
      </Field>
      <ChangeButton busy={busy} locale={locale} type="submit" wait={wait}>
        {t('wallet.sendAction', locale)}
      </ChangeButton>
      <OutcomeLine locale={locale} outcome={outcome} />
    </form>
  );
}

/** A donation to the published fundraiser, while it runs. */
export function DonateForm(props: FundraiserActionProps) {
  const { locale, address, busy, contractId, onOutcome } = props;
  const ids = useId();
  const [amount, setAmount] = useState('');
  const [amountProblem, setAmountProblem] = useState<string | null>(null);
  const { wait, run } = useChange(props);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const typed = readAmount(amount, locale);
    setAmountProblem(typed.ok ? null : amountProblemWords(typed.problem, locale));
    onOutcome(null);
    if (!typed.ok) return;
    const result = await run(() => buildContribute({ contractId, from: address, amount: typed.amount }), sendToFundraiser);
    if (result.ok) {
      onOutcome({ ok: true, hash: result.hash, words: t('wallet.donated', locale, { amount: testMoneyWords(typed.amount, locale) }) });
      setAmount('');
      props.onChanged();
    } else {
      onOutcome(result);
    }
  };

  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
      <Field data-invalid={amountProblem !== null}>
        <FieldLabel htmlFor={`${ids}-amount`}>{t('wallet.donateAmount', locale)}</FieldLabel>
        <Input
          aria-invalid={amountProblem !== null}
          autoComplete="off"
          disabled={wait !== null}
          id={`${ids}-amount`}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          value={amount}
        />
        {amountProblem === null ? null : <FieldError>{amountProblem}</FieldError>}
      </Field>
      <ChangeButton busy={busy} locale={locale} type="submit" wait={wait}>
        {t('wallet.donateAction', locale)}
      </ChangeButton>
    </form>
  );
}

/** Paying the money raised to the person the fundraiser is for: anyone may, once it ended at its goal. */
export function CollectAction(props: FundraiserActionProps) {
  const { locale, address, busy, contractId, onOutcome } = props;
  const { wait, run } = useChange(props);

  const collect = async () => {
    if (busy) return;
    onOutcome(null);
    const result = await run(() => buildWithdraw({ contractId, source: address }), sendToFundraiser);
    if (result.ok) {
      onOutcome({ ok: true, hash: result.hash, words: t('wallet.collected', locale) });
      props.onChanged();
    } else {
      onOutcome(result);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="m-0">{t('wallet.collectExplain', locale)}</p>
      <ChangeButton busy={busy} locale={locale} onClick={collect} wait={wait}>
        {t('wallet.collectAction', locale)}
      </ChangeButton>
    </div>
  );
}

/** This wallet's donation back, once the fundraiser ended short of its goal. */
export function RefundAction(props: FundraiserActionProps & { readonly given: string }) {
  const { locale, address, busy, contractId, onOutcome, given } = props;
  const { wait, run } = useChange(props);

  const refund = async () => {
    if (busy) return;
    onOutcome(null);
    const result = await run(() => buildRefund({ contractId, source: address, contributor: address }), sendToFundraiser);
    if (result.ok) {
      onOutcome({ ok: true, hash: result.hash, words: t('wallet.refunded', locale) });
      props.onChanged();
    } else {
      onOutcome(result);
    }
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <p className="m-0">{t('wallet.refundExplain', locale, { amount: testMoneyWords(given, locale) })}</p>
      <ChangeButton busy={busy} locale={locale} onClick={refund} wait={wait}>
        {t('wallet.refundAction', locale)}
      </ChangeButton>
    </div>
  );
}
