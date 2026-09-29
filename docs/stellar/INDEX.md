# Stellar guide for this app

This folder is the guide to Stellar for the AI that builds this app. Read this
page first, then only the file that answers the question in front of you: each
one is short enough to read whole in a single look.

**Start with this app's own library.** Every Stellar call this app makes is in
`lib/stellar/`, and its first lines (`lib/stellar/index.ts`) say what each file
there does. The rules for working on a Stellar app are section 11 of
`AGENTS.md`, together with its rules 2, 3, 5, 7, 9 and 10. Where this guide and
`AGENTS.md` differ, `AGENTS.md` wins.

**Where this guide comes from.** The topic files below are trimmed from
Stellar's own developer skills, `stellar-dev-skill`
(https://github.com/stellar/stellar-dev-skill, Apache-2.0), at commit
`73b609d5e837ee6ab07ec14a413b6c225f777686`, by Pathnomic Labs for the Tellop
Stellar kit. Upstream text is kept as written. Our additions are the file
headers and one line each, starting **Kit note** (where this app does something
its own way) or **Cut for this kit** (what was removed, and why). The code in
these files shows how Stellar works; in this app, call or extend `lib/stellar/`
rather than copying it.

| File | What it covers | Read it when |
|---|---|---|
| `wallet-and-payments.md` | Freighter: connecting, the network it is set to, signing; building a payment and sending it; what a payment screen must show while it works | You change how a person connects, pays, donates or sees a payment go through |
| `reading-the-network.md` | The SDK's two services: RPC (what each method reads, its limits) and Horizon (accounts, balances, payments, history, pages of results) | You show something new read from the network, such as a list of recent payments |
| `contract-calls.md` | Calling a contract from the page: simulating, preparing, sending, reading its state, the asset contract that holds test money, stored data that expires, fees, the checks before sending | You change or add a call to the fundraiser's contract |
| `test-money-and-assets.md` | The test network's own money and other assets, trustlines, reading balances | The person asks about any money other than test money |
| `test-network.md` | The test network's addresses, Friendbot's free test money, the quarterly resets, and where to read more | You need an address, or to understand why an account or contract is gone |
| `errors.md` | Errors from RPC and Horizon, rate limits, contract data that expired | A Stellar call answers with a reason the page does not handle yet |
| `LICENSE` | The Apache License 2.0, under which Stellar publishes the material this guide is made from | You pass this guide on |
| `NOTICE` | Where the material came from, at which commit, and which files Pathnomic Labs changed | You pass this guide on |

**Not here, on purpose:** writing, building or publishing a smart contract, the
command-line tools, the main network, and Stellar's other skills (cross-chain,
zero-knowledge proofs, agent payments, standards and anchors). This app never
writes a contract: the fundraiser's is `contracts/fundraiser/`, published as
`README.md` describes.
