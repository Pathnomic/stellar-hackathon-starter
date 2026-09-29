# Wallet and payments in the page

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/dapp/SKILL.md` (Goals, Recommended Dependencies, Wallet Integration: Freighter, Transaction Building, Transaction Submission, Transaction UX Checklist). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** the examples import `horizon`, `rpc` and `config` from `@/lib/stellar`, a file of upstream's own; this app's `lib/stellar/` has none of those names. Read the examples to learn what the network does, then call or extend `lib/stellar/` (AGENTS.md section 11).

> **Kit note:** the examples print with `console` and `throw` English errors; this app shows every expected state in words from `lib/i18n/locales/`, writes no error to the console for one, and its calls answer `{ ok: false, reason }` (AGENTS.md rule 3 and section 11).

Client-side development with `@stellar/stellar-sdk`, wallet connection, signing, and submitting transactions. Covers both classic Stellar operations and smart contract invocation from the browser or Node.js.

## Goals

> **Kit note:** in this app the single instance is `lib/stellar/`, and the wallet is Freighter only.

- Single SDK instance for the app (RPC/Horizon + transaction building)
- Freighter wallet integration (or multi-wallet via Stellar Wallets Kit)
- Clean separation of client/server in Next.js
- Transaction sending with proper confirmation handling

## Recommended Dependencies

> **Kit note:** both packages are already installed (`@stellar/stellar-sdk` 16.3.0, `@stellar/freighter-api` 6.0.1); install nothing (AGENTS.md rule 7).

> **Requires Node.js 22+.** As of SDK v16, Node 22 is the minimum (older Node produces an `EBADENGINE` warning). v16 also folded `@stellar/stellar-base` into `@stellar/stellar-sdk`, is ESM-first, and uses native `fetch` instead of axios. If you still import `@stellar/stellar-base` directly, switch the import to `@stellar/stellar-sdk` and uninstall the base package (keeping both breaks `instanceof` checks). See the [migration guide](https://stellar.github.io/js-stellar-sdk/guides/00-migration).

> **Cut for this kit:** the install commands, and the multi-wallet library they offered.

> **Sourcing:** SDK mechanics below (init, transaction building, contract invocation, submission, data fetching, error handling) track the official [JS SDK docs](https://stellar.github.io/js-stellar-sdk/) (which also publish [`llms.txt`](https://stellar.github.io/js-stellar-sdk/llms.txt) / [`llms-full.txt`](https://stellar.github.io/js-stellar-sdk/llms-full.txt) bundles for agents). Wallet integrations (Freighter, Stellar Wallets Kit), passkey smart accounts, and the OpenZeppelin relayer are separate packages, not part of the JS SDK — verify those against their own upstream docs.

## Wallet Integration

> **Kit note:** `lib/stellar/freighter.ts` already does this (`freighterStatus()`, `connectWallet()`, `signWithWallet()`), stays silent inside Tellop's preview where no wallet can run, and checks the wallet is on the test network; call it rather than the Freighter package.

### Freighter (Primary Browser Wallet)
```typescript
// hooks/useFreighter.ts
import { useState, useEffect, useCallback } from "react";
import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction,
  getNetwork,
} from "@stellar/freighter-api";

export function useFreighter() {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    const { isConnected: installed, error } = await isConnected();
    if (error || !installed) return;

    // getAddress returns address: "" until the app has been granted access,
    // so a non-empty address means we're already authorized.
    const { address: addr, error: addressError } = await getAddress();
    if (addressError || !addr) return;

    const { network: net, error: networkError } = await getNetwork();
    if (networkError) return;
    setConnected(true);
    setAddress(addr);
    setNetwork(net);
  };

  const connect = useCallback(async () => {
    const { isConnected: installed, error } = await isConnected();
    if (error || !installed) {
      throw new Error("Freighter extension not installed");
    }

    // requestAccess prompts the user and returns the granted address.
    const { address: addr, error: accessError } = await requestAccess();
    if (accessError) throw new Error(accessError.message);

    const { network: net, error: networkError } = await getNetwork();
    if (networkError) throw new Error(networkError.message);
    setConnected(true);
    setAddress(addr);
    setNetwork(net);

    return addr;
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
    setAddress(null);
    setNetwork(null);
  }, []);

  const sign = useCallback(
    async (xdr: string, networkPassphrase: string) => {
      if (!connected) throw new Error("Wallet not connected");
      const { signedTxXdr, error } = await signTransaction(xdr, {
        networkPassphrase,
      });
      if (error) throw new Error(error.message);
      return signedTxXdr;
    },
    [connected]
  );

  return { connected, address, network, connect, disconnect, sign };
}
```

> **Cut for this kit:** Stellar Wallets Kit, a multi-wallet library this app does not have (AGENTS.md rule 7).

## Transaction Building

> **Kit note:** `buildPayment()` in `lib/stellar/horizon.ts` builds this payment, for the test network only. Contract calls are in `contract-calls.md`.

### Basic Payment
```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { horizon, config } from "@/lib/stellar";

export async function buildPaymentTx(
  sourceAddress: string,
  destinationAddress: string,
  amount: string,
  asset: StellarSdk.Asset = StellarSdk.Asset.native()
) {
  const account = await horizon.loadAccount(sourceAddress);

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destinationAddress,
        asset: asset,
        amount: amount,
      })
    )
    .setTimeout(180)
    .build();

  return transaction.toXDR();
}
```

## Transaction Submission

> **Kit note:** `submitSigned()` (a payment, `lib/stellar/horizon.ts`) and `sendSigned()` (the contract, `lib/stellar/fundraiser.ts`) do this, wait a bounded time, and answer a reason instead of throwing.

### Submit and Wait for Confirmation
```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, horizon, config } from "@/lib/stellar";

export async function submitTransaction(signedXdr: string) {
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    config.networkPassphrase
  );

  // For smart contract transactions, use RPC
  if (transaction.operations.some(op => op.type === "invokeHostFunction")) {
    return submitSorobanTransaction(signedXdr);
  }

  // For classic transactions, use Horizon
  return submitClassicTransaction(signedXdr);
}

async function submitSorobanTransaction(signedXdr: string) {
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    config.networkPassphrase
  ) as StellarSdk.Transaction;

  const response = await rpc.sendTransaction(transaction);

  if (response.status === "ERROR") {
    throw new Error(`Send failed: ${response.errorResult}`);
  }

  // Poll for completion. pollTransaction handles the retry loop (default 5
  // attempts, 1s apart — tune with { attempts, sleepStrategy }) instead of a
  // hand-rolled while loop that can spin forever.
  const getResponse = await rpc.pollTransaction(response.hash);

  if (getResponse.status === "SUCCESS") {
    return {
      hash: response.hash,
      result: getResponse.returnValue,
    };
  }

  throw new Error(`Transaction failed: ${getResponse.status}`);
}

async function submitClassicTransaction(signedXdr: string) {
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    config.networkPassphrase
  ) as StellarSdk.Transaction;

  const response = await horizon.submitTransaction(transaction);
  return {
    hash: response.hash,
    ledger: response.ledger,
  };
}
```

## Transaction UX Checklist

> **Kit note:** the app's wallet panel (`app/wallet-panel.tsx`, `app/wallet-actions.tsx`) follows this list. Every message is plain words from `lib/i18n/locales/` (never "transaction" or "XDR"), and a finished payment is shown as a Stellar Expert link outside the preview rather than its raw hash.

- [ ] Show loading state during wallet signing
- [ ] Display transaction hash immediately after submission
- [ ] Track confirmation status (pending → success/failed)
- [ ] Handle common errors with clear messages:
  - Wallet not connected
  - User rejected signing
  - Insufficient XLM for fees
  - Account not funded
  - Network mismatch (wallet on wrong network)
  - Transaction timeout/expired
- [ ] Prevent double-submission while processing
- [ ] Show destination and amount before signing

> **Cut for this kit:** `skills/dapp/react.md`'s ready-made components: they use plain buttons and fields, fixed colours and English words, which this app's rules refuse (AGENTS.md rules 5, 6 and 6a). `app/wallet-panel.tsx` is this app's own version.
