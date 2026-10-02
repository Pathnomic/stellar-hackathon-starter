# Stellar hackathon starter

A starter for a hackathon web app that takes test payments on Stellar's test
network, in Next.js and TypeScript. Its page is a fundraiser: people connect
the Freighter wallet, see their test balance, get free test money from
Friendbot and send test payments through Horizon, and a Soroban contract holds
what they give in escrow until the goal is reached or the deadline passes.

It is the Stellar starting kit of Tellop, the app builder made by Pathnomic
Labs, published on its own under the Apache License 2.0.

> **Test network only.** The app knows only Stellar's test network and refuses
> anything signed for another. The contract has been reviewed, not audited
> (`contracts/fundraiser/REVIEW.md`). Use neither with real money.

## What is here

| Path | What it holds |
|---|---|
| `app/` | The fundraiser page, the wallet panel and a small notes example |
| `lib/stellar/` | Every call to Stellar: Freighter, Horizon, Friendbot, the contract, amounts |
| `lib/stellar/example-data.ts` | The example fundraiser the page shows until a contract is published |
| `lib/data/`, `prisma/` | The app's own storage (Node's built-in SQLite) and its two seeded test users |
| `lib/i18n/` | Every word on the page, in English and Turkish |
| `stellar/fundraiser.settings.json` | The goal, end date and beneficiary a contract is published with |
| `tests/` | Offline tests: a fake Stellar network stands in, and nothing reaches the internet |
| `contracts/fundraiser/` | The escrow fundraising contract in Rust, its tests and its review notes |
| `docs/stellar/` | A Stellar guide for AI coding agents, trimmed from Stellar's official Skills |
| `AGENTS.md` | The kit's Stellar rules for AI coding agents |
| `GUIDE.md` | Making a Stellar app from this kit in Tellop, with no code, in English and Turkish |

## Run it

You need Node.js 24, pnpm 11, and Chrome with the
[Freighter](https://www.freighter.app) extension.

1. In Freighter, open Settings, then Network, and choose **Test Net**.
2. Install and start the app:

   ```sh
   pnpm install
   pnpm dev
   ```

3. Open <http://localhost:3000> in Chrome and connect Freighter from the page.
   A new account can get free test money from the page (Friendbot) and then
   send a test payment.

Until a contract is published (below), the fundraiser shows its example goal
as a preview. The app keeps what people save in `.data/`, which Git ignores. It
never reads secrets from a file, and refuses to start while a `.env` file
exists (`lib/guard-no-plaintext-secrets.mjs`).

## Test it

The app's tests run offline:

```sh
pnpm install && pnpm test
```

The contract's tests (`rust-toolchain.toml` pins Rust 1.98.1, which rustup
installs on first use):

```sh
cd contracts/fundraiser && cargo test
```

`.github/workflows/test.yml` runs both on every push to `main` and every pull
request, together with `cargo clippy --all-targets -- -D warnings` and
`cargo fmt --check`.

## The contract's release, and checking its hash

A release is built on GitHub, never on a laptop. Pushing a tag that starts with
`v` runs `.github/workflows/release.yml`: it runs the tests above, then
[`stellar-expert/soroban-build-workflow`](https://github.com/stellar-expert/soroban-build-workflow)
at commit `88068ec50cba931a96436869727ed08edeb76ade` (its `v27.0.0`). That workflow builds the
contract with `stellar contract build --optimize` (Stellar CLI
27.0.0), records this repository inside the file (SEP-55), attaches
`fundraiser_v<version>.wasm` to a GitHub release named
`v<version>_contracts_fundraiser_fundraiser_cli27.0.0`, and attests the
file with GitHub's build provenance.

To check a downloaded release file:

```sh
gh attestation verify fundraiser_v1.0.0.wasm --repo Pathnomic/stellar-hackathon-starter \
  --signer-repo stellar-expert/soroban-build-workflow
shasum -a 256 fundraiser_v1.0.0.wasm
```

The attestation is signed by the build workflow's own repository, which is why
`--signer-repo` names it. It records the SHA-256 it attests, the commit it was
built from and the workflow run; the second command prints the file's hash to
compare.

To rebuild it yourself, use the same Stellar CLI (27.0.0) and the
pinned Rust:

```sh
cd contracts/fundraiser
stellar contract build --optimize --package fundraiser --out-dir out \
  --meta source_repo=github:Pathnomic/stellar-hackathon-starter
shasum -a 256 out/fundraiser.wasm
```

The release is built on Linux (x86-64). A rebuild elsewhere should give the
same bytes but is not guaranteed to, which is why the attested file is the one
to publish.

`contracts/fundraiser/REVIEW.md` rebuilds the contract the plain way, with
`cargo build`: that is the build the review checked, and its SHA-256 was
`8a394dfc3f4147a9f094d5edd09a776b69f973eb3e5a5ea141ba1e2b416b0156`. It is not the release file: the release trims the
contract's interface description and carries the repository record, so its
hash differs.

## Publish the contract on the test network

Download a release file and check it as above. Read the settings the way the
app does:

```sh
node -e "import('./lib/stellar/deployment.ts').then((m) => console.log(m.readSettingsText(require('node:fs').readFileSync('stellar/fundraiser.settings.json', 'utf8'))))"
```

It prints the goal in test money, and the deadline in Unix seconds (UTC); a
date alone ends at the following midnight, UTC. The end date must be ahead and
at most 90 days away, so change it in the settings file first if it is not.
Then, with the Stellar CLI:

```sh
stellar keys generate fundraiser-owner --network testnet --fund
stellar contract id asset --asset native --network testnet
stellar contract deploy --wasm fundraiser_v1.0.0.wasm \
  --source fundraiser-owner --network testnet -- \
  --owner <G…> --beneficiary <G…> --token <C…> \
  --goal <stroops> --deadline <seconds>
```

`--token` is the address the second command printed (the test money's own
contract). `--goal` counts stroops: 10,000,000 make one unit of test money.
`"app-account"` as the beneficiary means the account you publish from, and the
owner may pause the fundraiser. Then record what was published in
`stellar/deployment.json`, which the app reads through `loadDeployment()`:

```json
{
  "network": "testnet",
  "contractId": "C…",
  "accountAddress": "G…",
  "wasmSha256": "…",
  "publishedAt": "2026-10-01T12:00:00.000Z",
  "transactions": { "upload": "…", "create": "…" }
}
```

`accountAddress` is the account that published it, `wasmSha256` the release
file's hash, and `upload` and `create` the hashes of the two transactions the
CLI sent. Stellar resets its test network about four times a year, deleting
every account and contract; after a reset the page says so, and you publish
again.

## Where it comes from

Inside Tellop, a person describes an app and Tellop builds it from this kit;
`GUIDE.md` walks through it, from a new app to a test payment on Stellar
Expert. Comments and tests mention Tellop's in-app preview, its save checks
and the general rules it gives every app (sections 1 to 10 of its rulebook);
this repository carries only the Stellar rules, in `AGENTS.md`. Outside Tellop
the app runs as an ordinary Next.js app.

## License

Apache License 2.0: see `LICENSE` and `NOTICE`. `docs/stellar/` is made from
Stellar's `stellar-dev-skill` (Apache-2.0); its `NOTICE` names the source and
every change.
