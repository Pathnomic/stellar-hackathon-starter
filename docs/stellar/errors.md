# When something goes wrong

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/data/SKILL.md` (Best Practices: Error Handling, Rate Limiting) and `skills/smart-contracts/development.md` (Troubleshooting: the two rows about stored data). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** the library already reads these answers into `STELLAR_PROBLEMS` reasons: `refusalFromCode()` in `lib/stellar/horizon.ts` for the result codes, `fundraiserErrorName()` in `lib/stellar/fundraiser.ts` for the contract's own errors, and every page shows words for a reason through `problemWords()` in `app/stellar-problems.ts`. A code the library does not know yet goes into those readers, with a reason and its words in both languages; never a second reader.

> **Kit note:** the examples import `horizon`, `rpc` and `config` from `@/lib/stellar`, a file of upstream's own; this app's `lib/stellar/` has none of those names. Read the examples to learn what the network does, then call or extend `lib/stellar/` (AGENTS.md section 11).

> **Kit note:** the examples print with `console` and `throw` English errors; this app shows every expected state in words from `lib/i18n/locales/`, writes no error to the console for one, and its calls answer `{ ok: false, reason }` (AGENTS.md rule 3 and section 11).

## Errors and rate limits

### Error Handling

```typescript
// RPC errors
try {
  const result = await rpc.sendTransaction(tx);
} catch (error) {
  if (error.code === 400) {
    // Invalid transaction
  } else if (error.code === 503) {
    // Service unavailable
  }
}

// Horizon errors
try {
  const result = await horizon.submitTransaction(tx);
} catch (error) {
  const extras = error.response?.data?.extras;
  if (extras?.result_codes) {
    // Detailed error codes
    console.log("Transaction:", extras.result_codes.transaction);
    console.log("Operations:", extras.result_codes.operations);
  }
}
```

### Rate Limiting

> **Kit note:** the library answers `busy` when a service asks it to slow down; show it in words and let the person try again, rather than retrying in a loop.

Both RPC and Horizon have rate limits:
- Use exponential backoff for retries
- Cache responses where appropriate
- Consider running your own nodes for high-volume applications

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) {
        // Rate limited - exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
```

## Stored contract data that expired

> **Kit note:** the library answers `archived` for this, and `problemWords()` has its words; a person never reads "TTL".

| Symptom | Cause | Fix |
|---------|-------|-----|
| Calls fail after inactivity, data "missing" | Storage TTL expired → archived | Extend TTLs proactively; simulation auto-restores archived persistent entries |
| Temporary data vanished | Wrong storage type | Use `persistent()` for data that must survive |

> **Cut for this kit:** the rows about building contracts and the command-line tool.
