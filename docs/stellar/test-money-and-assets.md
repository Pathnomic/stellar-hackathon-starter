# Test money, assets and trustlines

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/assets/SKILL.md` (Overview, Stellar Assets (Classic), Trustlines: Create Trustline and Check Trustline Status, Querying Assets: Get Account Balances, Best Practices: Trustline Management and Security). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** in this app the money is the test network's own asset (native), shown to people as "test money" and never by its code; the fundraiser takes only that. Other assets and trustlines matter only if the person asks for them, and every payment is still built and sent through `lib/stellar/`.

> **Kit note:** the examples print with `console` and `throw` English errors; this app shows every expected state in words from `lib/i18n/locales/`, writes no error to the console for one, and its calls answer `{ ok: false, reason }` (AGENTS.md rule 3 and section 11).

Stellar's native token mechanism: classic asset issuance, trustlines, and the Stellar Asset Contract (SAC) bridge that makes classic assets usable from smart contracts. Default to classic assets over custom contract tokens unless you need custom logic.

## Overview

Stellar has two token mechanisms:

1. **Stellar Assets (Classic)**: Built-in, highly efficient, full ecosystem support
2. **Contract tokens (SEP-41)**: Custom contracts with flexible logic

**Recommendation**: Prefer Stellar Assets unless you need custom token logic.

## Stellar Assets (Classic)

### Asset Types

| Type | Description |
|------|-------------|
| Native (XLM) | Stellar's native currency, no trustline needed |
| Credit | Issued by an account, requires trustline |
| Liquidity Pool Shares | Represent LP positions |

### Asset Identifiers

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

// Native XLM
const xlm = StellarSdk.Asset.native();

// Credit asset (code + issuer)
const usdc = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
);

// Asset code rules:
// - 1-4 chars: alphanumeric (credit_alphanum4)
// - 5-12 chars: alphanumeric (credit_alphanum12)
```

> **Cut for this kit:** Issuing Assets and Asset Flags: issuing, authorizing and clawing back an asset of your own needs a key held in code, which this app never has.

## Trustlines

> **Kit note:** a trustline is a change to the person's own account, so it is signed in their wallet like any payment.

### Create Trustline

```typescript
const changeTrustTx = new StellarSdk.TransactionBuilder(userAccount, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(
    StellarSdk.Operation.changeTrust({
      asset: asset,
      limit: "10000", // Max amount to hold (see "Remove Trustline" for limit: "0")
    })
  )
  .setTimeout(180)
  .build();
```

> **Cut for this kit:** Remove Trustline.

### Check Trustline Status

```typescript
const account = await server.loadAccount(userPublicKey);
const trustline = account.balances.find(
  (b) =>
    b.asset_type !== "native" &&
    b.asset_code === "USDC" &&
    b.asset_issuer === usdcIssuer
);

if (trustline) {
  console.log("Balance:", trustline.balance);
  console.log("Limit:", trustline.limit);
  console.log("Authorized:", trustline.is_authorized);
}
```

> **Cut for this kit:** Stellar Asset Contract (its client side is in `contract-calls.md`) and When to Use What (choosing how to issue a token).

## Querying Assets

### Get Account Balances

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

> **Cut for this kit:** Find Assets, Get Asset Statistics and SEP Standards for Assets (issuer and anchor topics).

## Best Practices

> **Cut for this kit:** Asset Issuance.

### Trustline Management
- Check trustline exists before sending payments
- Handle trustline creation in onboarding flow
- Respect trustline limits
- Monitor for frozen/deauthorized status
- Before removing a trustline (`limit: "0"`): zero the balance, cancel offers
  buying the asset, and exit liquidity pools that reference it

### Security
- Validate asset issuer, not just code
- Be cautious of assets with clawback enabled
- Verify stellar.toml from authoritative source
- Use well-known asset lists for common tokens
- **Some live assets have no `stellar.toml` at all.** A missing `home_domain`
  is not evidence of a scam — USDT0 ships without one. Validate by issuer
  plus SAC derivation, never by the presence of `home_domain` or a
  `[[CURRENCIES]]` entry
- **When `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED` are both set, check the
  issuer lock *and* the admin roles before listing the asset.** Those flags
  mean balances can be frozen or clawed back. A contract SAC admin does not
  contain that power on its own: an issuer whose master key still signs can
  mint, freeze and claw back directly, whatever the admin contract allows. So
  confirm the master key weight is `0`, then identify who holds the admin
  contract's roles
