# The test network, Friendbot and where to read more

> **About this file:** trimmed by Pathnomic Labs for the Tellop Stellar kit from Stellar's `stellar-dev-skill` (Apache-2.0, https://github.com/stellar/stellar-dev-skill) at commit `73b609d5e837ee6ab07ec14a413b6c225f777686`: `skills/smart-contracts/testing.md` (Testnet) and `skills/standards/resources.md` (Official Documentation, Client SDKs, Test Networks, Block Explorers). Upstream text is kept as written; lines that start **Kit note** or **Cut for this kit** are ours. Where this file and `AGENTS.md` differ, `AGENTS.md` wins.

> **Kit note:** this app knows only the test network: `TESTNET` in `lib/stellar/network.ts` holds its addresses and name, `fundWithTestMoney()` in `lib/stellar/friendbot.ts` asks Friendbot for free test money, and the person's Freighter must be set to the test network too. Inside Tellop the page reaches only Horizon, RPC and Friendbot on the test network (AGENTS.md rule 3); the links below are for reading, never for the app to call.

## Testnet

> **Cut for this kit:** the command-line setup (no command-line tool reaches this app).

- RPC: `https://soroban-testnet.stellar.org` · Horizon: `https://horizon-testnet.stellar.org`
- Passphrase: `"Test SDF Network ; September 2015"` · Friendbot: `https://friendbot.stellar.org`
- **Testnet resets quarterly** — everything is deleted. Script your deployments; never treat testnet state as durable.
- Testnet runs the next protocol version before mainnet — it's where you verify against an upcoming upgrade.

> **Kit note:** after a reset the app's published contract and every test account are gone; the page shows that as an ordinary state, never an error (AGENTS.md section 11).

## Official Documentation

### Stellar Developer Docs
- [Stellar Documentation](https://developers.stellar.org/docs) - Primary documentation
- [Build Smart Contracts](https://developers.stellar.org/docs/build/smart-contracts) - smart contract guides
- [Build Apps](https://developers.stellar.org/docs/build/apps) - Client application guides
- [Tools & SDKs](https://developers.stellar.org/docs/tools) - Available tooling
- [Networks](https://developers.stellar.org/docs/networks) - Network configuration
- [Learn Fundamentals](https://developers.stellar.org/docs/learn/fundamentals) - Core concepts
- [Security Best Practices](https://developers.stellar.org/docs/build/security-docs)

### API References
- [Stellar RPC Methods](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods) - RPC API
- [Horizon API](https://developers.stellar.org/docs/data/apis/horizon/api-reference) - REST API (legacy-focused)
- [Oracle Providers](https://developers.stellar.org/docs/data/oracles/oracle-providers)

### Client SDKs (Application Development)
- [JavaScript SDK](https://github.com/stellar/js-stellar-sdk) - `@stellar/stellar-sdk`
- [SDK Documentation](https://developers.stellar.org/docs/tools/sdks/client-sdks)

> **Cut for this kit:** the SDKs for other languages, the contract SDK, the command-line tools and local development.

### Test Networks
- [Testnet Info](https://developers.stellar.org/docs/networks/testnet)
- [Friendbot](https://friendbot.stellar.org) - Testnet faucet

### Block Explorers

> **Kit note:** Stellar Expert is for people to look at, through the app's links outside the preview; the page itself never calls its API.

- [StellarExpert](https://stellar.expert) - Network explorer & analytics
- [StellarExpert API](https://stellar.expert/openapi.html) - Free REST API (no auth, CORS-enabled)
- [Stellar Lab](https://lab.stellar.org) - Developer tools
- [StellarChain](https://stellarchain.io) - Alternative explorer
