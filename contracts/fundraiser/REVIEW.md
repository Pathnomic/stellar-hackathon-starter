# Fundraiser contract: review notes

Reviewed by the Tellop team at Pathnomic Labs, 2026-09-28, and checked again the same day by a reviewer who had not written it (see "Independent review").

**Reviewed, not audited.** No outside security firm has checked this contract.
**Stellar's test network (Testnet) only.** Do not publish it on Mainnet or use it for real money.

## What it promises

People send money to the contract while a fundraiser runs. If the amount raised reaches the goal by the deadline, the whole balance goes to the beneficiary. If not, every supporter can get back exactly what they put in. Nobody can move money any other way: there is no admin transfer, no upgrade, and no call that says where money goes except `refund(contributor)`, which only pays a contributor their own recorded amount.

## Who can do what

| Call | Who | When | What it does |
|---|---|---|---|
| `__constructor(owner, beneficiary, token, goal, deadline)` | whoever publishes it, once | goal above 0, deadline after now, beneficiary not the contract itself | Fixes the settings for good, the owner included. |
| `contribute(from, amount)` | `from` only, signing this call | before the deadline, not paused, amount above 0, `from` not the contract itself | Moves `amount` from `from` to the contract and records it. |
| `withdraw()` | anyone | after the deadline, goal reached, first time only | Pays the contract's whole balance to the beneficiary. |
| `refund(contributor)` | anyone | after the deadline, goal missed, something recorded | Pays that contributor their recorded amount and clears it. |
| `pause()`, `unpause()` | the owner only | any time | Stops or restarts `contribute`. Nothing else. |
| `goal`, `deadline`, `total`, `beneficiary`, `token`, `contribution(of)`, `state`, `is_paused`, `withdrawn` | anyone | any time | Read only. `state` is `Running`, `Succeeded` or `Failed`. `withdrawn` is true once the beneficiary has been paid. |

The owner is the `owner` argument given at creation, fixed forever: no call can change or remove it. It need not be the account that published the contract. The owner and pause parts are OpenZeppelin Stellar Contracts (`Ownable`, `Pausable`, `#[only_owner]`).

`contribute` answers in this order. The contract's own address as `from` is refused with `SelfContribution` (111), before any signature check. Then `from` must sign. After the deadline the answer is `Ended` (103), even while paused. Before it, a paused contract answers `Paused` (110). Last, an amount of zero or less is refused with `AmountNotPositive` (102).

## Promises and the tests that prove them

The tests are in `src/test.rs`; run them with `cargo test --locked`. A star marks a test that was also seen to fail when the matching line of the contract was broken on purpose, and to pass again once the line was put back.

| Promise | Test |
|---|---|
| The goal must be above zero and the deadline in the future. | t01 |
| On success the beneficiary gets the whole balance, including money sent straight to the contract. | t02 |
| No withdraw before the deadline, and only one withdraw. | t03* |
| On failure each supporter gets exactly their own amount back, once. | t04* |
| After the deadline only one way out is open: no refund if the goal was reached, no withdraw if it was missed, neither before the deadline. | t03, t04, t05 |
| Contributions only while running, and only amounts above zero. | t06 |
| Only a supporter can commit their own money, by signing `contribute` itself. Someone else's signature, no signature, or a signature for the token transfer alone is refused. | t07* |
| Pause stops only contributions. Withdraw and refund work while paused. Only the owner can pause or unpause. | t08* |
| No amount wraps around: numbers near the largest the contract can hold are refused with `Overflow`. | t09* |
| One event per money movement, carrying the address and the amount. | t10, t11 |
| A failed token transfer leaves nothing behind, and the token's own refusal comes through unchanged. | t12 |
| Every write keeps the records alive until the deadline plus a 30-day refund window. `contribute`, `withdraw`, `refund`, `pause` and `unpause` each top the lifetime back up after it has dropped. | t13* |
| `withdrawn` is false until the beneficiary is paid, and true after. | t14* |
| The contract cannot contribute as itself, even with every signature granted. | t15* |
| The contract cannot be its own beneficiary. | t16* |
| After the deadline `contribute` answers `Ended`, whether the pause came before or after the deadline. | t17* |
| A payout or refund the token refuses changes nothing: the withdrawn mark or the supporter's record stays, the money stays in the contract, and a retry fails the same way. Once the destination can receive, a retry pays in full. | t18*, t19* |

## Checked by hand

- **Signatures on every money path.** `contribute` requires `from` to sign the call, with the token transfer nested under it. `withdraw` and `refund` need no signature because their destination is fixed: the beneficiary set at creation, or a contributor's own amount back to that same contributor. The contract pays out through its own call to the token, which only the contract itself can make. The contract has no `__check_auth`, so its own address can never sign a contribution, and `contribute` refuses its own address outright anyway (111).
- **Pause never traps money.** Only `contribute` reads the pause flag, and only after checking the deadline.
- **No other exit.** The built contract exports exactly `__constructor`, `contribute`, `withdraw`, `refund`, `pause`, `unpause` and nine read-only calls (`goal`, `deadline`, `total`, `beneficiary`, `token`, `contribution`, `state`, `is_paused`, `withdrawn`). OpenZeppelin's ownership transfer and renounce calls are not exposed, so the owner stays the `owner` given at creation. The constructor refuses the contract itself as the beneficiary (112), because money paid to itself could never leave.
- **Arithmetic.** Each supporter's amount and the total use `checked_add` and refuse with `Overflow`. The release build keeps overflow checks on. The time-to-ledger arithmetic saturates instead of overflowing.
- **Order of effects.** Each call records its change first, then moves money. A failed transfer fails the whole call, so no record survives it (t12 for `contribute`, t18 for `withdraw`, t19 for `refund`).
- **The outcome cannot flip.** `total` never goes down (refunds and the withdraw leave it alone) and nothing is accepted after the deadline, so once the deadline passes the state is fixed.
- **Record lifetimes.** Every write extends the contract instance (settings, total and the contract code) and the supporter record it touched until the deadline plus 30 days, and never less than 30 days from now, capped at the network's maximum. Ledgers are counted at five seconds each, OpenZeppelin's convention. A record that expires is archived, not deleted, and anyone can restore it, so an expiry cannot lose money.
- **Storage keys.** OpenZeppelin keeps its `Owner`, `PendingOwner` and `Paused` records in the same instance storage as the contract's own, keyed by those names. No key of the contract's own uses them, and a comment on `DataKey` says none ever may.
- **Events.** `contributed`, `withdrawn` and `refunded`, each with the topics `[name, address]` and the amount as data. The token publishes its own `transfer` event beside each one.
- **Error numbers.** The contract's own errors are 100 to 112. When the token refuses a transfer, its own error (1 to 14 for a Stellar Asset Contract) passes through unchanged. A first draft numbered from 1, which made a supporter without enough money show up as `Overflow`; t12 now pins this. A `pause` or `unpause` the owner did not sign is refused by the network's signature check, which carries no contract error number. Pausing twice, or unpausing when not paused, refuses with OpenZeppelin's 1000 (already paused) or 1001 (not paused).

## Known limits

- **Not audited.** Both reviews were done inside the Tellop team.
- **Testnet only.** Stellar resets Testnet a few times a year, with notice; the next announced reset is on 2026-12-16. A reset deletes the contract, its records and its history.
- **Money sent straight to the contract** (not through `contribute`) is not recorded. On success it goes to the beneficiary with the rest. On failure, or if it arrives after the withdraw, nobody can take it out.
- **Anyone can push a fundraiser over its goal** with their own money, the beneficiary included. The contract cannot tell a real supporter from someone topping it up.
- **`total()` never falls.** It counts what came in through `contribute`; refunds and the payout leave it alone. After refunds it overstates what the contract holds. `contribution(of)` and the token balance show what is left.
- **No cancel and no limit on the deadline.** Nobody can end a fundraiser early or refund before the deadline, and the contract does not limit how far away the deadline is. Whoever publishes it has to pick a sensible date.
- **Records the contract does not refresh can be archived.** The money itself sits in the native token's balance record, which the token keeps alive for about 30 days after it last touches it. If contributions stop early, that record can be archived before the payout or the refunds; after the deadline plus 30 days, so can the contract instance. No money is lost, because the network restores an archived record when a transaction includes it. That is why every transaction must be built from a simulation, as Tellop and the kit's library do, so the restore is included. Reading the views of an archived contract needs a restore first.
- **Long fundraisers.** Record lifetimes are capped at the network's maximum. If a fundraiser runs longer than that, a record can be archived before it is used and must be restored first (anyone can). If ledgers close faster than five seconds, lifetimes are shorter in days than planned.
- **Payouts and refunds under 1 test XLM to an account that does not exist yet fail** until someone funds that account: the token opens a new account only with at least 1 XLM. Nothing is lost; the records stay as they were and the call can be retried (t18, t19).
- **The owner can keep contributions paused** until the deadline. The owner cannot move money.
- **The local build's interface description is untrimmed.** OpenZeppelin turns on the SDK's `experimental_spec_shaking_v2` feature. The Stellar CLI (`stellar contract build`, 25.2.0 or newer) trims the interface description to what the contract uses; a plain `cargo build` keeps every type the libraries define, so an explorer may list unused OpenZeppelin types (for example `UpgradeableStorageKey`) for a local build. The contract has no upgrade function, whatever that list says.

## Independent review

On 2026-09-28 a reviewer who had not written the contract checked it against its specification: every call that moves money, signatures, pausing, arithmetic, record lifetimes, events, and what a failed call leaves behind. A fresh build reproduced the pinned SHA-256 of the version it reviewed (`d1a3c1a2a47888169efd42c9dc0bdc5d43f7534ab58b3b0a11117515d3d5a884`). It found no blocking issues. These follow-ups were applied the same day, and the contract was rebuilt and re-pinned:

- A `withdrawn()` view, so the app can show that the money was collected.
- `contribute` refuses the contract's own address, before any signature check (111).
- The constructor refuses the contract itself as the beneficiary (112).
- After the deadline `contribute` answers `Ended`, even while paused.
- A comment on the storage keys: none may share a name with OpenZeppelin's.
- t13 now proves that `contribute`, `withdraw`, `pause` and `unpause` each top up the contract's lifetime; three broken versions that skipped a top-up used to pass it and now fail it.
- t18 and t19: a payout or refund the token refuses changes nothing and can be retried.
- These notes: Testnet's protocol, who the owner is, the error numbers, the reset schedule, archived records, and the new known limits.

Reviewed, not audited. Testnet only.

## Versions

- Rust 1.98.1, pinned in `rust-toolchain.toml`; target `wasm32v1-none`.
- `soroban-sdk` 26.1.1; the contract targets interface version 26. Testnet runs protocol 28 as of 2026-09-28, which accepts it.
- OpenZeppelin Stellar Contracts 0.7.2: `stellar-access` (Ownable), `stellar-contract-utils` (Pausable), `stellar-macros` (`only_owner`). This release requires `soroban-sdk` 26, which is why the SDK is not newer.
- Every dependency is pinned to an exact version in `Cargo.toml`, and `Cargo.lock` is committed.

## Rebuild and compare the hash

```sh
cd contracts/fundraiser   # rust-toolchain.toml selects Rust 1.98.1
cargo test --locked
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 \
  cargo build --target wasm32v1-none --release --locked
shasum -a 256 target/wasm32v1-none/release/fundraiser.wasm
```

At review time this build's SHA-256 was `8a394dfc3f4147a9f094d5edd09a776b69f973eb3e5a5ea141ba1e2b416b0156`. The variable is needed because of the feature above: without it the SDK refuses a plain `cargo build` for this target. The build embeds no file paths, and a clean rebuild on the reviewing machine produced the same bytes.

The published build comes from this repository's release workflow (`.github/workflows/release.yml`), which runs `stellar contract build`, attests the file on GitHub and records the source repository inside the contract (SEP-55). That build's hash differs from the local one; each release lists its own, and `README.md` says how to check it.
