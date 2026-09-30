import { assertNoPlaintextSecretFiles } from './lib/guard-no-plaintext-secrets.mjs';

/**
 * The app's Next.js settings. Deliberately almost empty: nothing here reaches
 * into Next internals, so the file stays something the app can own.
 *
 * Six settings below are load-bearing, each measured when it was added. Do not
 * remove any of them without re-measuring what happens.
 */

// A plaintext secrets file in the project is a refusal, not a warning. Runs on
// `dev`, `build` and `start`, because the config is loaded for all three.
assertNoPlaintextSecretFiles(import.meta.dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Next 16.3 writes a block into AGENTS.md (and creates AGENTS.md and
  // CLAUDE.md when neither exists) whenever `next dev` finds an AI coding tool
  // in its environment. This kit's AGENTS.md is Tellop's rulebook for the app's
  // AI and changes only when Tellop changes it, so that rewrite is off.
  agentRules: false,
  // The Stellar SDK decodes addresses with base32.js, which calls `new Buffer()`.
  // Bundled into the server's files, that prints Node's deprecation warning while
  // a page is drawn, and React's development mode replays it into the page's
  // console at error level, which fails Tellop's page check on the first load of
  // a published fundraiser after every start. Loaded from node_modules instead,
  // the warning never reaches the page (measured 2026-09-28).
  serverExternalPackages: ['@stellar/stellar-sdk'],
  // Tellop's preview shows the app at a random `.invalid` address, and in development
  // Next refuses its own development files - its overlay's font among them - to
  // a page whose host it does not know. Without this line every page of the app
  // makes a refused request there, and Tellop's page check fails every try.
  // `.invalid` is a name no public site can have, and `*` stands for exactly
  // one label, so this names Tellop's preview and nothing wider. It applies
  // only when Tellop's practice runtime starts the app, which sets
  // TELLOP_PRIVATE_PRACTICE to 1: run anywhere else, the server listens on the
  // network, and a hostile resolver (a rogue network's DNS, a hosts entry, a
  // proxy) can give any page a `.invalid` name, so a project run outside Tellop
  // keeps Next's own default. Next reads it only when the app's server starts,
  // so an edit here waits for the next start. Development only: a production
  // server never checks it.
  ...(process.env.TELLOP_PRIVATE_PRACTICE === '1' ? { allowedDevOrigins: ['*.invalid'] } : {}),
  turbopack: {
    // Without this the bundler walks UP looking for a lockfile, finds whatever
    // repository the project happens to sit inside, then watches all of it and
    // reports error paths relative to it. Pinning the root to the app keeps the
    // watcher and every reported path inside the user's own project - which is
    // also what makes the paths in a structured error safe to reason about.
    root: import.meta.dirname,
  },
  experimental: {
    // Next 16 turns React's debug channel on in development, and a page's first
    // load then waits for its debug data on the live-refresh socket before any of
    // its own code runs. Tellop's page check looks at the app from a browser with
    // no live-refresh lane, so with the channel on the page is shown but never
    // runs there, and the check is blind to every error the app's code throws.
    // Off, the debug data rides in the page itself and the check sees the app's
    // own code run; removing this line blinds the check again. Development only:
    // a production build never opens the channel.
    reactDebugChannel: false,
  },
};

export default nextConfig;
