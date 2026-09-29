# Calling the contract from the page

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/dapp/SKILL.md` (Smart Contract Invocation), `skills/data/SKILL.md` (Simulate Transaction, Send Transaction), `skills/dapp/data-fetching.md` (Contract State), `skills/assets/SKILL.md` (Stellar Asset Contract), `skills/smart-contracts/development.md` (TTL management, Fees and resource limits: first paragraphs) and `skills/smart-contracts/security.md` (Client-side checklist). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** this app calls one contract, the fundraiser, through `lib/stellar/fundraiser.ts` (`readFundraiser`, `readContribution`, `buildContribute`, `buildWithdraw`, `buildRefund`, `sendSigned`). Read this file to understand or extend those calls, never to write a contract: this project holds no contract source, and the person publishes Tellop's own from Tellop's Stellar page (AGENTS.md section 11).

> **Kit note:** the examples import `horizon`, `rpc` and `config` from `@/lib/stellar`, a file of upstream's own; this app's `lib/stellar/` has none of those names. Read the examples to learn what the network does, then call or extend `lib/stellar/` (AGENTS.md section 11).

> **Kit note:** the examples print with `console` and `throw` English errors; this app shows every expected state in words from `lib/i18n/locales/`, writes no error to the console for one, and its calls answer `{ ok: false, reason }` (AGENTS.md rule 3 and section 11).

## Invoking a contract

### Smart Contract Invocation (`contract.Client`)

> **Kit note:** the fundraiser's calls in `lib/stellar/fundraiser.ts` take the low-level path below (build, simulate, assemble) rather than `contract.Client`, and the person signs in Freighter through `signWithWallet()`; nothing here ever uses `basicNodeSigner` or a key in code.

The canonical way to call a Stellar smart contract from JS is the `contract.Client`, not hand-built `Contract.call` + `assembleTransaction`. The client reads the contract's interface from the network, so each method is callable by name and returns an `AssembledTransaction`. You get a native JS result and don't build ScVals by hand.

```typescript
import { contract } from "@stellar/stellar-sdk";
import { config } from "@/lib/stellar";

// Describe just the methods you call. `Client.from<T>()` uses this to type
// the returned client, so calls are checked and autocompleted — no codegen.
// For a contract with many methods, generate this interface from its spec
// with the SDK's binding CLI instead of writing it by hand.
interface CounterContract {
  increment: (
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<number>>;
}

// `signTransaction` comes from the wallet (e.g. Freighter/Wallets Kit in the
// browser). `contract.basicNodeSigner(keypair, networkPassphrase)` is the
// Node equivalent for scripts and tests.
export async function getCounterClient(
  contractId: string,
  publicKey: string,
  signTransaction: contract.ClientOptions["signTransaction"],
) {
  return contract.Client.from<CounterContract>({
    contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    publicKey,
    signTransaction,
  });
}

// Preview (free simulation) then sign + send to apply on-chain.
export async function increment(client: contract.Client & CounterContract) {
  const tx = await client.increment();
  console.log("preview:", tx.result); // predicted return value, no signature
  const sent = await tx.signAndSend(); // submits and polls to completion
  return sent.result;
}
```

`AssembledTransaction` also supports fine-grained control (`{ fee, simulate, timeoutInSeconds }` as a second arg) and multi-party auth via `tx.needsNonInvokerSigningBy()` / `tx.signAuthEntries()`. See [Invoke a Contract](https://stellar.github.io/js-stellar-sdk/guides/06-invoke-a-contract) and [Authorize a Contract Call](https://stellar.github.io/js-stellar-sdk/guides/07-contract-auth).

<details>
<summary><b>Advanced: low-level invocation without a client</b></summary>

Use this only when you need direct control over the transaction (e.g. batching a contract call with classic operations). Otherwise prefer `contract.Client` above.

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc, config } from "@/lib/stellar";

export async function invokeContract(
  sourceAddress: string,
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[]
) {
  const account = await rpc.getAccount(sourceAddress);
  const contract = new StellarSdk.Contract(contractId);

  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(180)
    .build();

  // `prepareTransaction` simulates and applies footprint/auth/fees in one step.
  // (Equivalent to simulateTransaction + rpc.assembleTransaction.)
  const prepared = await rpc.prepareTransaction(transaction);
  return prepared.toXDR();
}
```

**Building ScVal arguments by hand** (only needed for the low-level path — `contract.Client` converts native JS args for you):

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const addressVal = StellarSdk.Address.fromString(address).toScVal();
const i128Val = StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" });
const u32Val = StellarSdk.nativeToScVal(42, { type: "u32" });
const stringVal = StellarSdk.nativeToScVal("hello", { type: "string" });
const symbolVal = StellarSdk.nativeToScVal("transfer", { type: "symbol" });

// Struct
const structVal = StellarSdk.nativeToScVal(
  { name: "Token", decimals: 7 },
  {
    type: {
      name: ["symbol", null],
      decimals: ["u32", null],
    },
  }
);

// Vec of i128 — the element type is applied to each item
const vecVal = StellarSdk.nativeToScVal(
  [1, 2, 3].map((n) => BigInt(n)),
  { type: "i128" }
);
```

</details>

## Simulating and sending

#### Simulate Transaction

> **Kit note:** `sendSigned()` in `lib/stellar/fundraiser.ts` sends and waits a bounded time; never write a waiting loop of your own.

```typescript
const simulation = await rpc.simulateTransaction(transaction);

if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
  console.error("Simulation failed:", simulation.error);
} else if (StellarSdk.rpc.Api.isSimulationSuccess(simulation)) {
  console.log("Cost:", simulation.cost);
  console.log("Result:", simulation.result);
}
```

#### Send Transaction

```typescript
const response = await rpc.sendTransaction(signedTransaction);

if (response.status === "PENDING") {
  // Poll for result
  let result = await rpc.getTransaction(response.hash);
  while (result.status === "NOT_FOUND") {
    await new Promise(r => setTimeout(r, 1000));
    result = await rpc.getTransaction(response.hash);
  }

  if (result.status === "SUCCESS") {
    console.log("Success:", result.returnValue);
  } else {
    console.error("Failed:", result.status);
  }
}
```

## Reading contract state

### Contract State

> **Kit note:** `readFundraiser()` and `readContribution()` are this app's reads; `readFundraiser()` is the one request a page may make while it loads, once the contract is published (AGENTS.md rule 3).

For a read-only contract call, `rpc.Server` has one-line shortcuts that build the contract interface for you (including the built-in spec for Stellar Asset Contracts), so no client setup or manual ScVal work is needed:

```typescript
import { rpc } from "@/lib/stellar";

// Run a read-only method and get the decoded result directly.
const { result: balance, isReadCall } = await rpc.queryContract<bigint>(
  tokenId,
  "balance",
  { id: "G..." } // named args, keyed by parameter name; omit for no-arg methods
);

// Discover a contract's callable methods from just its ID.
const methods = await rpc.getContractMethods(tokenId);
// [{ name: "balance", inputs: [{ name: "id", type: "Address" }], outputs: ["I128"] }, ...]
```

`isReadCall` is per-call: `false` means the `result` is only a simulation preview of a call that would change state (apply it by signing a transaction via `contract.Client`).

<details>
<summary><b>Advanced: read a raw ledger entry</b></summary>

Reach for `getLedgerEntries` only when you need a specific storage key that isn't exposed as a contract method.

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc } from "@/lib/stellar";

export async function getContractData(
  contractId: string,
  key: StellarSdk.xdr.ScVal
) {
  const ledgerKey = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: new StellarSdk.Address(contractId).toScAddress(),
      key: key,
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
    })
  );

  const entries = await rpc.getLedgerEntries(ledgerKey);

  if (entries.entries.length === 0) {
    return null;
  }

  return StellarSdk.scValToNative(
    entries.entries[0].val.contractData().val()
  );
}
```

</details>

## Stellar Asset Contract (SAC)

> **Kit note:** the fundraiser holds its test money through the test network's own asset contract, whose address the contract is given when it is published; a page never needs to.

SAC provides a smart-contract interface for Stellar Assets, enabling smart contract interactions.

> **Cut for this kit:** Deploy SAC for Existing Asset (a command-line step).

### SAC Address Derivation

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

const asset = new StellarSdk.Asset("USDC", issuerPublicKey);
const contractId = asset.contractId(StellarSdk.Networks.TESTNET);
// Returns the deterministic SAC contract address
```

> **Cut for this kit:** Using SAC in Smart Contracts (contract code).

### SAC vs Custom Token Interface

SAC implements the standard SEP-41 token interface:
- `balance(id: Address) -> i128`
- `transfer(from: Address, to: Address, amount: i128)`
- `approve(from: Address, spender: Address, amount: i128, expiration_ledger: u32)`
- `allowance(from: Address, spender: Address) -> i128`
- `decimals() -> u32`
- `name() -> String`
- `symbol() -> Symbol`

## Stored data and fees

### TTL management

> **Kit note:** the library answers `archived` when stored contract data has to be restored before a change can go through; see `errors.md`.

Every entry has a TTL counted in ledgers (~5s each, 17,280/day) and is archived (persistent/instance) or deleted (temporary) when it expires. Mainnet floors and ceiling (network-configured): new persistent entries start with ~120 days of TTL, temporary entries ~1 day, and no entry can exceed ~180 days (3,110,400 ledgers).

> **Cut for this kit:** the contract code for extending TTLs.

## Fees and resource limits

> **Kit note:** the library simulates every change it prepares, so fees and resources are sized before the person signs.

Contract transactions pay an inclusion fee (classic surge-priced mechanic) plus a resource fee based on declared consumption: CPU instructions, ledger reads/writes (entries and bytes), transaction size, events size, and rent. Rent/events are refundable if unused; instructions and I/O are charged as declared — so submitters simulate first to size the declaration, and a transaction that exceeds its declaration fails. If actual state diverges from simulation (concurrent writes), costs can shift — leave headroom.

> **Cut for this kit:** the main network's limits table and the advice for contract authors.

## Before sending

### Client-side

> **Kit note:** the library checks the network name before a signature and simulates before sending, and the contract's address comes only from `loadDeployment()`.

- [ ] Network passphrase validated before signing
- [ ] Transactions simulated before submission
- [ ] Operation details displayed clearly; confirmation for high-value actions
- [ ] Contract addresses verified against known deployments
- [ ] Trustline status checked before transfers
