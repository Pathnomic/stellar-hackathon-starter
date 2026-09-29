# Reading the network: the SDK, RPC and Horizon

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/dapp/SKILL.md` (SDK Initialization), `skills/data/SKILL.md` (Overview, Stellar RPC, Migration: Horizon to RPC, Best Practices), `skills/data/horizon.md` (all but streaming) and `skills/dapp/data-fetching.md` (Account Balance). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** the examples import `horizon`, `rpc` and `config` from `@/lib/stellar`, a file of upstream's own; this app's `lib/stellar/` has none of those names. Read the examples to learn what the network does, then call or extend `lib/stellar/` (AGENTS.md section 11).

> **Kit note:** the examples print with `console` and `throw` English errors; this app shows every expected state in words from `lib/i18n/locales/`, writes no error to the console for one, and its calls answer `{ ok: false, reason }` (AGENTS.md rule 3 and section 11).

> **Kit note:** a page asks the network for nothing while it loads except the published contract's reading, and reads a wallet's balance only after the person has connected that wallet (AGENTS.md rule 3).

API access for reading chain state. Stellar RPC is the preferred entry point for new projects; Horizon remains for legacy and historical-query workflows. For deeper history beyond RPC's 7-day window, use Hubble/Galexie.

## SDK Initialization

> **Kit note:** `TESTNET` in `lib/stellar/network.ts` holds these addresses and the network name; `resolveEndpoints()` hands them to every call.

### Basic Setup
```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

// For Testnet
const testnetServer = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
const testnetRpc = new StellarSdk.rpc.Server("https://soroban-testnet.stellar.org");
const testnetNetworkPassphrase = StellarSdk.Networks.TESTNET;

```

> **Cut for this kit:** the main network's setup, and the environment-based network switch that followed it (this app knows only the test network, AGENTS.md section 11).

## Overview

Stellar provides two API paradigms:

| API | Status | Use Case |
|-----|--------|----------|
| **Stellar RPC** | Preferred | Smart contracts, real-time state, new projects |
| **Horizon** | Legacy-focused | Historical data, legacy applications |

**Recommendation**: Use Stellar RPC for all new projects. Use Horizon mainly for historical queries and legacy compatibility paths.

## Stellar RPC

> **Kit note:** this app reaches RPC for its contract only, through `lib/stellar/fundraiser.ts`, whose connection drops the SDK's own identifying headers so the browser asks the service nothing extra first.

### Endpoints

| Network | RPC URL |
|---------|---------|
| Testnet | `https://soroban-testnet.stellar.org` |

> **Cut for this kit:** the main network, Futurenet and local rows of the address table.

### Setup

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const rpc = new StellarSdk.rpc.Server("https://soroban-testnet.stellar.org");
```

### Key Methods

#### Get Account

```typescript
const account = await rpc.getAccount(publicKey);
// Returns account with sequence number for transaction building
```

#### Get Health

```typescript
const health = await rpc.getHealth();
// { status: "healthy" }
```

#### Get Latest Ledger

```typescript
const ledger = await rpc.getLatestLedger();
// { id: "...", sequence: 123456, protocolVersion: 25 }
```

#### Get Ledger Entries

```typescript
// Read contract storage
const key = StellarSdk.xdr.LedgerKey.contractData(
  new StellarSdk.xdr.LedgerKeyContractData({
    contract: new StellarSdk.Address(contractId).toScAddress(),
    key: StellarSdk.xdr.ScVal.scvSymbol("Counter"),
    durability: StellarSdk.xdr.ContractDataDurability.persistent(),
  })
);

const entries = await rpc.getLedgerEntries(key);
if (entries.entries.length > 0) {
  const value = StellarSdk.scValToNative(
    entries.entries[0].val.contractData().val()
  );
}
```

> **Kit note:** simulating and sending are in `contract-calls.md`.

#### Get Transaction

```typescript
const tx = await rpc.getTransaction(txHash);
// status: "SUCCESS" | "FAILED" | "NOT_FOUND"
// returnValue: ScVal (for contract calls)
// ledger: number
```

#### Get Events

```typescript
const events = await rpc.getEvents({
  startLedger: 1000000,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [
        ["*", StellarSdk.xdr.ScVal.scvSymbol("transfer").toXDR("base64")],
      ],
    },
  ],
});

for (const event of events.events) {
  console.log("Event:", event.topic, event.value);
}
```

### RPC Limitations

- **7-day history for most methods**: `getTransaction`, `getEvents`, etc. only cover recent data
- **`getLedgers` exception**: on a data-lake-backed provider, "Infinite Scroll" pages back past the retention window — as far as that provider's data lake reaches (potentially genesis). On a plain RPC instance it is bounded by `getHealth().oldestLedger`; requests older than that fail with `-32600`. Check before assuming depth.
- **No streaming**: Poll for updates (no WebSocket)
- **Contract-focused**: Limited classic Stellar data

## Migration: Horizon to RPC

### Account Loading

```typescript
// Horizon (old)
const account = await horizonServer.loadAccount(publicKey);

// RPC (new)
const account = await rpc.getAccount(publicKey);
// Note: RPC returns less data, just what's needed for transactions
```

### Transaction Submission

```typescript
// Horizon (for classic transactions)
const result = await horizonServer.submitTransaction(tx);

// RPC (for smart contract transactions)
const response = await rpc.sendTransaction(tx);
const result = await pollForResult(response.hash);
```

### Historical Data

```typescript
// Horizon - full history
const allTxs = await horizonServer
  .transactions()
  .forAccount(publicKey)
  .call();

// RPC - most methods limited to the retention window (~7 days)
// Exception: getLedgers can page further back (Infinite Scroll), but only as far
// as the chosen provider's retention or data-lake integration reaches.
// Always check the floor of the instance you're talking to first:
const { oldestLedger } = await rpc.getHealth();
// For guaranteed full history, use:
// 1. Hubble (SDF's BigQuery dataset)
// 2. Galexie (data pipeline)
// 3. Your own indexer
```

> **Cut for this kit:** Streaming Replacement (asking again on a timer; this app reads again after the person's own step instead, AGENTS.md rule 3), Historical Data Access (Hubble, Galexie, data lakes and indexers, which this app cannot reach) and Network Configuration (the environment-based switch between networks).

## Best Practices

### Use RPC for:
- New application development
- Smart contract interactions
- Transaction simulation and submission
- Real-time account state

### Use Horizon for:
- Historical transaction queries
- Payment streaming
- Legacy application maintenance
- Rich account metadata

> **Kit note:** error handling and rate limits are in `errors.md`.

## Horizon

> **Kit note:** `lib/stellar/horizon.ts` reads balances (`loadBalances`) and sends payments (`buildPayment`, `submitSigned`) through plain requests with no extra headers; a new Horizon read belongs beside them, built on `requestJson` from `lib/stellar/http.ts`.

### Endpoints

| Network | Horizon URL |
|---------|-------------|
| Testnet | `https://horizon-testnet.stellar.org` |

### Setup

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const server = new StellarSdk.Horizon.Server("https://horizon-testnet.stellar.org");
```

### Common Operations

#### Load Account

```typescript
const account = await server.loadAccount(publicKey);
// Full account details including balances, signers, data
```

#### Get Account Balances

```typescript
const account = await server.loadAccount(publicKey);
for (const balance of account.balances) {
  if (balance.asset_type === "native") {
    console.log("XLM:", balance.balance);
  } else {
    console.log(`${balance.asset_code}:`, balance.balance);
  }
}
```

#### Get Transactions

```typescript
// Account transactions
const transactions = await server
  .transactions()
  .forAccount(publicKey)
  .order("desc")
  .limit(10)
  .call();

// Specific transaction
const tx = await server
  .transactions()
  .transaction(txHash)
  .call();
```

#### Get Operations

```typescript
const operations = await server
  .operations()
  .forAccount(publicKey)
  .order("desc")
  .limit(20)
  .call();

for (const op of operations.records) {
  console.log(op.type, op.created_at);
}
```

#### Get Payments

```typescript
const payments = await server
  .payments()
  .forAccount(publicKey)
  .order("desc")
  .call();

for (const payment of payments.records) {
  if (payment.type === "payment") {
    console.log(
      `${payment.from} -> ${payment.to}: ${payment.amount} ${payment.asset_code || "XLM"}`
    );
  }
}
```

#### Get Effects

```typescript
const effects = await server
  .effects()
  .forAccount(publicKey)
  .limit(50)
  .call();
```

> **Cut for this kit:** Streaming (Server-Sent Events): a connection held open and resumed from a stored cursor.

#### Submit Transaction

```typescript
try {
  const result = await server.submitTransaction(signedTransaction);
  console.log("Success:", result.hash);
} catch (error) {
  if (error.response?.data?.extras?.result_codes) {
    console.error("Error codes:", error.response.data.extras.result_codes);
  }
}
```

### Pagination

```typescript
// First page
let page = await server.transactions().forAccount(publicKey).limit(10).call();

// Next page
if (page.records.length > 0) {
  page = await page.next();
}

// Previous page
page = await page.prev();
```

## A balance from the page

### Account Balance

> **Kit note:** `loadBalances()` in `lib/stellar/horizon.ts` does this and answers `not-funded` for a wallet the network has not seen yet, an ordinary state (it gets test money first).

```typescript
import { NotFoundError } from "@stellar/stellar-sdk";
import { horizon } from "@/lib/stellar";

export async function getBalance(address: string) {
  try {
    const account = await horizon.loadAccount(address);
    const nativeBalance = account.balances.find(
      (b) => b.asset_type === "native"
    );
    return nativeBalance?.balance || "0";
  } catch (error) {
    // loadAccount rejects with the typed NotFoundError for an unfunded account.
    if (error instanceof NotFoundError) {
      return "0"; // Account not funded yet
    }
    throw error;
  }
}
```

> For submission failures, Horizon returns result codes under `error.response?.data?.extras?.result_codes` (`transaction` + per-`operation`). See [Handle Errors](https://stellar.github.io/js-stellar-sdk/guides/05-handle-errors).
