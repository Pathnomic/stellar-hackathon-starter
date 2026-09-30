# Stellar rules for this app

These are the Stellar rules this kit gives an AI coding agent: section 11 of the rulebook the kit carries inside Tellop, Pathnomic Labs' app builder, published here on its own.
Sections 1 to 10 are Tellop's general rules for every app it builds and are not part of this repository; where code or `docs/stellar/` mentions one of them, it means that rulebook.

## 11. Stellar

This app takes test payments on Stellar's test network: a fundraiser people
donate test money to from their own wallet. These rules keep that working, and
safe, whatever else the app becomes.

- **Every Stellar call goes through `lib/stellar/`.** Its first lines
  (`lib/stellar/index.ts`) say what each file does. A person's action goes:
  build or prepare (`buildPayment`, `buildContribute`, `buildWithdraw`,
  `buildRefund`), then `signWithWallet`, then send (`submitSigned` for a
  payment, `sendSigned` for the contract). Every call answers
  `{ ok: true, ... }` or `{ ok: false, reason }`, where `reason` is one of
  `STELLAR_PROBLEMS`; show it with `problemWords(reason, locale)` from
  `app/stellar-problems.ts`, never as the bare reason. Need a call the library
  does not have, such as a list of recent donations? Add it inside
  `lib/stellar/`, beside the calls like it, reaching the network the way they
  do (`requestJson` in `lib/stellar/http.ts`, or the contract connection in
  `lib/stellar/fundraiser.ts`); a new reason goes into `STELLAR_PROBLEMS` with
  its words in both languages. Never write a second way of reaching Stellar,
  never `fetch` a Stellar address from a page or a component, and never write
  signing code of your own.
- **No Stellar secret key or recovery phrase ever enters this app.** Never
  write one into a file, ask a person for one, show one or sign with one in
  code: people approve in their own wallet, which keeps their key.
- **The test network only, never the main network.** `TESTNET` in
  `lib/stellar/network.ts` is the only network this app knows, and the library
  refuses anything signed for another. Never add a network setting, a switch or
  a second set of addresses, and never read one from `process.env`.
- **Never write, change or add a smart contract.** The fundraiser's contract in
  `contracts/fundraiser/` is reviewed (`contracts/fundraiser/REVIEW.md`) and is
  published only as the attested build this repository's release workflow
  makes. Changing it needs a new review and a new release, which a person
  decides. Your part is the app around it.
- **The contract's settings live in `stellar/fundraiser.settings.json`, and
  only there.** It holds exactly three keys: `goal`, a number of test money
  above 0 with at most 7 decimals and at most 1,000,000,000; `endsAt`, a
  `YYYY-MM-DD` day (the fundraiser runs through that whole day, UTC) or a time
  with its offset (`2026-11-15T18:00:00Z`), ahead of now and at most 90 days
  away; and `beneficiary`, `"app-account"` (the app's own Stellar account) or
  a `G…` address. No other key is allowed. `loadSettings()` reads the file
  through these rules, and a contract is published with these values
  (`README.md` says how). The settings are fixed into the contract when it is
  published: a change afterwards reaches no contract already published.
- **Read the published contract only through `loadDeployment()`**, in a server
  component whose page says `export const dynamic = 'force-dynamic'`, and hand
  the contract's address to the page from there. Never import
  `stellar/deployment.json`: it does not exist until the contract is published,
  and an import of a missing file stops the app from building. Never create,
  edit or delete that file; the person who publishes the contract writes it.
  `lib/stellar/server.ts` is server code only: never import it into a component
  that runs in the browser.
- **Freighter lives in the person's own browser.** Inside Tellop's app preview,
  where this kit also runs, there is no wallet: `insideTellopPreview()` is true
  there, and a page with a wallet action shows a one-line hint to open the app
  in a browser instead of a connect button. Keep that hint wherever a wallet
  action is. `freighterStatus()` stays silent where no wallet can run; call it
  rather than the Freighter package itself. Links to Stellar Expert
  (`explorerTxUrl`, `explorerAccountUrl`, `explorerContractUrl`) are shown only
  outside that preview.
  As a page loads, its one wallet call is `freighterStatus()`, and the page
  uses only its `available`: nothing else is asked of Freighter until the
  person presses Connect.
- **Amounts are counted in stroops, as a `bigint`** (10,000,000 stroops make one
  unit of test money): `toStroops()` turns a written amount into one and
  `formatTestMoney()` writes one back. Never do money sums with ordinary
  numbers. Read an amount a person types with `readAmount(typed, locale)` from
  `app/amount-text.ts`, which takes the locale's own decimal mark ("12,5" in
  Turkish) and refuses a thousands separator.
- **Never write a line that reads as a stored sign-in**, such as
  `token: '<value>'` or `auth: <expression>`, or any name that ends in `token`,
  `secret`, `password`, `credential`, `auth` or `_KEY` with twelve or more
  characters written beside it. Secret scanners refuse such a line, and so does
  Tellop when the app is built there. Name such fields for what they
  hold, like `tokenAddress`, `authorizedBy`, `signedEntries` or
  `fallbackWords`, never plain `token`, `secret`, `password` or `auth`, and
  never end a constant's name in `_KEY`.
- **Stellar resets its test network about four times a year**, deleting every
  account and contract on it. A published contract that no longer answers is an
  ordinary state the page shows in words, never an error.
- **The fundraiser's story is told once on the page.** When you write the app's
  own opening, take out the example's heading, story and updates card
  (`example.title`, `example.story`, `example.updates` in `app/page.tsx`), and
  give your own heading `id="fundraiser-title"`, which names the section. The
  "Stellar test network" badge, the test-money line, the progress card and the
  wallet panel stay.
- **For anything else about Stellar, read `docs/stellar/INDEX.md` first.** It is
  a guide made from Stellar's own developer material, trimmed to this kind of
  app, and it says which of its files answers what. Where it and these rules
  differ, these rules win.
