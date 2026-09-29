'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import { t } from '../lib/i18n/index.js';
import type { Locale } from '../lib/i18n/index.js';
import { connectWallet, freighterStatus, insideTellopPreview } from '../lib/stellar/freighter.ts';
import type { ConnectResult } from '../lib/stellar/freighter.ts';
import { fundWithTestMoney } from '../lib/stellar/friendbot.ts';
import { readContribution } from '../lib/stellar/fundraiser.ts';
import { loadBalances } from '../lib/stellar/horizon.ts';
import type { StellarProblem } from '../lib/stellar/network.ts';

import { useFundraiserReading } from './fundraiser-reading.ts';
import { problemWords } from './stellar-problems.ts';
import { CollectAction, DonateForm, OutcomeLine, RefundAction, SendForm, testMoneyWords } from './wallet-actions.tsx';
import type { Outcome } from './wallet-actions.tsx';
import { panelView, shortAddress } from './wallet-view.ts';
import type { BalanceState, ContributionState, FundraiserStep, WalletState } from './wallet-view.ts';

/**
 * A visitor's Freighter wallet on this page: connect it, see its test money,
 * get free test money, send test money, and donate to the fundraiser (or, once
 * it has ended, collect the money or take a donation back).
 *
 * What it shows is decided in `wallet-view.ts`; this file finds things out and
 * draws them. `contractId` is the published fundraiser's address, or `null`
 * before anything is published.
 *
 * The rules that keep the page working inside Tellop, where the app is checked
 * in a browser with no wallet at all:
 *  - Nothing here asks the network for anything until the person presses a
 *    button, apart from the one reading of a published fundraiser, which the
 *    panel shares with the progress card (`fundraiser-reading.ts`). Looking
 *    for Freighter only asks the browser, and without it the panel says so in
 *    words, with the connect button resting.
 *  - Inside Tellop's preview no wallet can run, so the panel only says how to
 *    open the app in a browser, and never even looks for Freighter.
 *  - "No wallet", "not connected" and "no test money yet" are ordinary states,
 *    shown in words and never written to the console.
 */

/** Where people get Freighter: its makers' own site. */
const FREIGHTER_SITE = 'https://www.freighter.app/';

/** What a connect attempt leads to. */
function afterConnect(answer: ConnectResult): WalletState {
  if (answer.ok) return { kind: 'connected', address: answer.address };
  if (answer.reason === 'wrong-network') return { kind: 'wrong-network', address: answer.address, busy: false };
  if (answer.reason === 'wallet-missing') return { kind: 'missing' };
  if (answer.reason === 'open-in-browser') return { kind: 'preview' };
  return { kind: 'ready', problem: answer.reason };
}

export function WalletPanel({ locale, contractId }: { readonly locale: Locale; readonly contractId: string | null }) {
  const [wallet, setWallet] = useState<WalletState>({ kind: 'checking' });
  const [balance, setBalance] = useState<BalanceState>({ kind: 'reading' });
  const [contribution, setContribution] = useState<ContributionState>({ kind: 'reading' });
  const [funding, setFunding] = useState<{ readonly running: boolean; readonly problem: StellarProblem | null }>({
    running: false,
    problem: null,
  });
  const [busy, setBusy] = useState(false);
  const [fundingOutcome, setFundingOutcome] = useState<Outcome | null>(null);
  const [fundraiserOutcome, setFundraiserOutcome] = useState<Outcome | null>(null);
  const shared = useFundraiserReading(contractId);
  const balanceTurn = useRef(0);
  const contributionTurn = useRef(0);

  useEffect(() => {
    if (insideTellopPreview()) {
      setWallet({ kind: 'preview' });
      return undefined;
    }
    let wanted = true;
    void freighterStatus().then((status) => {
      if (wanted) setWallet(status.available ? { kind: 'ready', problem: null } : { kind: 'missing' });
    });
    return () => {
      wanted = false;
    };
  }, []);

  /** Reads the wallet's test money; `keep` leaves the last answer on screen meanwhile. */
  const readBalance = useCallback((address: string, keep: boolean) => {
    balanceTurn.current += 1;
    const turn = balanceTurn.current;
    if (!keep) setBalance({ kind: 'reading' });
    void loadBalances(address).then((answer) => {
      if (turn !== balanceTurn.current) return;
      if (!answer.ok) setBalance({ kind: 'problem', reason: answer.reason });
      else setBalance(answer.state === 'funded' ? { kind: 'funded', testMoney: answer.testMoney } : { kind: 'not-funded' });
    });
  }, []);

  /** Reads what the wallet gave to the fundraiser, when one is published. */
  const readGiven = useCallback(
    (address: string, keep: boolean) => {
      if (contractId === null) return;
      contributionTurn.current += 1;
      const turn = contributionTurn.current;
      if (!keep) setContribution({ kind: 'reading' });
      void readContribution(contractId, address).then((answer) => {
        if (turn !== contributionTurn.current) return;
        setContribution(answer.ok ? { kind: 'known', amount: answer.amount } : { kind: 'problem', reason: answer.reason });
      });
    },
    [contractId],
  );

  const connect = async () => {
    const wrongNetwork = wallet.kind === 'wrong-network';
    setWallet(wrongNetwork ? { ...wallet, busy: true } : { kind: 'connecting' });
    const next = afterConnect(await connectWallet());
    setWallet(next);
    if (next.kind === 'connected') {
      readBalance(next.address, false);
      readGiven(next.address, false);
    }
  };

  const view = panelView({
    wallet,
    balance,
    published: contractId !== null,
    fundraiser: shared.reading,
    contribution,
  });

  const getTestMoney = async (address: string) => {
    setFunding({ running: true, problem: null });
    setBusy(true);
    const answer = await fundWithTestMoney(address);
    setBusy(false);
    setFunding({ running: false, problem: answer.ok ? null : answer.reason });
    if (!answer.ok) return;
    if (answer.state === 'funded') setFundingOutcome({ ok: true, hash: answer.hash, words: t('wallet.funded', locale) });
    readBalance(address, true);
  };

  const onChanged = (address: string) => () => {
    readBalance(address, true);
    readGiven(address, true);
    shared.refresh();
  };

  const tryFundraiserAgain = (address: string) => {
    if (shared.reading !== null && !shared.reading.ok) shared.retry();
    if (contribution.kind === 'problem') readGiven(address, false);
  };

  return (
    <Card data-stellar-wallet-panel="">
      <CardHeader>
        <CardTitle>{t('wallet.title', locale)}</CardTitle>
        <CardDescription>{t('wallet.intro', locale)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {view.kind === 'checking' ? (
          <p className="m-0 text-muted-foreground" role="status">
            {t('wallet.checking', locale)}
          </p>
        ) : null}

        {view.kind === 'preview' ? <p className="m-0">{problemWords('open-in-browser', locale)}</p> : null}

        {view.kind === 'no-wallet' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0">{problemWords('wallet-missing', locale)}</p>
            <div className="flex flex-wrap items-center gap-4">
              <Button disabled>{t('wallet.connect', locale)}</Button>
              <a className="text-sm underline underline-offset-4" href={FREIGHTER_SITE} rel="noopener noreferrer" target="_blank">
                {t('wallet.getFreighter', locale)}
              </a>
            </div>
          </div>
        ) : null}

        {view.kind === 'connect' ? (
          <div className="flex flex-col items-start gap-3">
            {view.problem === null ? null : (
              <p className="m-0 text-sm text-destructive" role="alert">
                {problemWords(view.problem, locale)}
              </p>
            )}
            <Button disabled={view.busy} onClick={connect}>
              {view.busy ? t('wallet.connecting', locale) : t('wallet.connect', locale)}
            </Button>
          </div>
        ) : null}

        {view.kind === 'wrong-network' ? (
          <div className="flex flex-col items-start gap-3">
            <p className="m-0 text-sm" title={view.address}>
              {t('wallet.address', locale)}: {shortAddress(view.address)}
            </p>
            <p className="m-0" role="alert">
              {t('wallet.wrongNetwork', locale)}
            </p>
            <Button disabled={view.busy} onClick={connect} variant="outline">
              {view.busy ? t('wallet.connecting', locale) : t('wallet.checkAgain', locale)}
            </Button>
          </div>
        ) : null}

        {view.kind === 'wallet' ? (
          <>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
              <dt className="text-muted-foreground">{t('wallet.address', locale)}</dt>
              <dd className="m-0" title={view.address}>
                {shortAddress(view.address)}
              </dd>
              <dt className="text-muted-foreground">{t('wallet.balance', locale)}</dt>
              <dd className="m-0">
                {view.balance.kind === 'funded' ? testMoneyWords(view.balance.testMoney, locale) : null}
                {view.balance.kind === 'not-funded' ? testMoneyWords('0', locale) : null}
                {view.balance.kind === 'reading' ? (
                  <span className="text-muted-foreground" role="status">
                    {t('wallet.balanceReading', locale)}
                  </span>
                ) : null}
              </dd>
            </dl>

            <OutcomeLine locale={locale} outcome={fundingOutcome} />

            {view.balance.kind === 'not-funded' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="m-0">{t('wallet.notFunded', locale)}</p>
                {funding.problem === null ? null : (
                  <p className="m-0 text-sm text-destructive" role="alert">
                    {problemWords(funding.problem, locale)}
                  </p>
                )}
                <Button disabled={busy} onClick={() => void getTestMoney(view.address)}>
                  {funding.running ? t('wallet.gettingTestMoney', locale) : t('wallet.getTestMoney', locale)}
                </Button>
              </div>
            ) : null}

            {view.balance.kind === 'problem' ? (
              <div className="flex flex-col items-start gap-3">
                <p className="m-0 text-sm text-destructive" role="alert">
                  {problemWords(view.balance.reason, locale)}
                </p>
                <Button onClick={() => readBalance(view.address, false)} variant="outline">
                  {t('fundraiser.tryAgain', locale)}
                </Button>
              </div>
            ) : null}

            {view.fundraiser === null ? null : (
              <section className="flex flex-col gap-3">
                <FundraiserPart
                  address={view.address}
                  busy={busy}
                  contractId={contractId}
                  locale={locale}
                  onBusy={setBusy}
                  onChanged={onChanged(view.address)}
                  onOutcome={setFundraiserOutcome}
                  onTryAgain={() => tryFundraiserAgain(view.address)}
                  step={view.fundraiser}
                />
                <OutcomeLine locale={locale} outcome={fundraiserOutcome} />
              </section>
            )}

            {view.canSend ? (
              <SendForm
                address={view.address}
                busy={busy}
                locale={locale}
                onBusy={setBusy}
                onChanged={onChanged(view.address)}
              />
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** The fundraiser part of the panel, for a connected wallet with test money. */
function FundraiserPart(props: {
  readonly step: FundraiserStep;
  readonly locale: Locale;
  readonly address: string;
  readonly contractId: string | null;
  readonly busy: boolean;
  readonly onBusy: (busy: boolean) => void;
  readonly onChanged: () => void;
  readonly onOutcome: (outcome: Outcome | null) => void;
  readonly onTryAgain: () => void;
}) {
  const { step, locale, contractId } = props;
  const given =
    'given' in step && step.given !== null && step.kind !== 'refund' ? (
      <p className="m-0 text-sm text-muted-foreground">
        {t('wallet.yourDonations', locale, { amount: testMoneyWords(step.given, locale) })}
      </p>
    ) : null;

  if (step.kind === 'not-published') return <p className="m-0 text-muted-foreground">{t('wallet.notPublished', locale)}</p>;
  if (step.kind === 'reading') {
    return (
      <p className="m-0 text-muted-foreground" role="status">
        {t('fundraiser.reading', locale)}
      </p>
    );
  }
  if (step.kind === 'problem') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0 text-sm text-destructive" role="alert">
          {problemWords(step.reason, locale)}
        </p>
        <Button onClick={props.onTryAgain} variant="outline">
          {t('fundraiser.tryAgain', locale)}
        </Button>
      </div>
    );
  }
  if (step.kind === 'nothing-to-refund') return <p className="m-0">{t('wallet.nothingToRefund', locale)}</p>;
  if (step.kind === 'paused') {
    return (
      <>
        <p className="m-0">{problemWords('paused', locale)}</p>
        {given}
      </>
    );
  }
  if (step.kind === 'paid-out') {
    return (
      <>
        <p className="m-0">{t('wallet.paidOut', locale)}</p>
        {given}
      </>
    );
  }
  // The three that change something need the published fundraiser's address.
  if (contractId === null) return null;
  const actionProps = { ...props, contractId };
  if (step.kind === 'donate') {
    return (
      <>
        <DonateForm {...actionProps} />
        {given}
      </>
    );
  }
  if (step.kind === 'collect') {
    return (
      <>
        <CollectAction {...actionProps} />
        {given}
      </>
    );
  }
  return <RefundAction {...actionProps} given={step.given} />;
}
