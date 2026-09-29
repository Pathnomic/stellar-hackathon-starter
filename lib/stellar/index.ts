/**
 * This app's Stellar library: Stellar's test network only.
 *
 *   network.ts     the test network's addresses, address and amount checks, explorer links
 *   freighter.ts   the person's Freighter wallet: status, connect, sign
 *   horizon.ts     a wallet's balances; building and sending a test money payment
 *   friendbot.ts   free test money for a wallet
 *   fundraiser.ts  the fundraising contract: read it; prepare, send and confirm a change
 *   deployment.ts  checks for `stellar/deployment.json` and `stellar/fundraiser.settings.json`
 *   server.ts      reads those two files from disk (server code only; not exported here)
 *
 * A person's action goes: build (or prepare) → `signWithWallet` → send
 * (`submitSigned` for a payment, `sendSigned` for the contract). Every call
 * answers `{ ok: true, ... }` or `{ ok: false, reason }`, where `reason` is one
 * of `STELLAR_PROBLEMS`; show words for it from `lib/i18n/locales/`.
 *
 * The rules that keep a page working inside Tellop: never ask the network while
 * the page loads, except `readFundraiser` when a contract is published; read
 * balances only after the person has connected a wallet; and treat "no wallet",
 * "not connected" and "no test money yet" as ordinary states, never as errors
 * written to the console.
 */

export {
  MAX_STROOPS,
  NotTestnetError,
  STELLAR_PROBLEMS,
  STROOPS_PER_UNIT,
  TESTNET,
  TESTNET_PASSPHRASE,
  assertTestnet,
  balanceToStroops,
  explorerAccountUrl,
  explorerContractUrl,
  explorerTxUrl,
  formatTestMoney,
  isAccountAddress,
  isContractAddress,
  isTestnet,
  isTransactionHash,
  readSignedTransaction,
  resolveEndpoints,
  toStroops,
} from './network.ts';
export type { Endpoints, ResolvedEndpoints, SignedTransactionCheck, StellarProblem } from './network.ts';

export { connectWallet, freighterStatus, insideTellopPreview, signWithWallet } from './freighter.ts';
export type { ConnectResult, SignResult, WalletStatus } from './freighter.ts';

export { buildPayment, loadBalances, refusalFromCode, submitSigned } from './horizon.ts';
export type {
  BalancesResult,
  BuildResult,
  OtherBalance,
  PaymentRequest,
  RefusalReason,
  ResultCodes,
  SubmitResult,
} from './horizon.ts';

export { fundWithTestMoney } from './friendbot.ts';
export type { FundResult } from './friendbot.ts';

export {
  FUNDRAISER_ERRORS,
  READ_ONLY_SOURCE,
  buildContribute,
  buildRefund,
  buildWithdraw,
  fundraiserErrorName,
  readContribution,
  readFundraiser,
  sendSigned,
} from './fundraiser.ts';
export type {
  ContributeRequest,
  ContributionReading,
  FundraiserErrorName,
  FundraiserReading,
  FundraiserState,
  PreparedCall,
  RefundRequest,
  SendResult,
  WithdrawRequest,
} from './fundraiser.ts';

export {
  DEPLOYMENT_FILE,
  MAX_FILE_BYTES,
  SETTINGS_FILE,
  SETTINGS_LIMITS,
  parseDeployment,
  parseSettings,
  readDeploymentText,
  readSettingsText,
} from './deployment.ts';
export type {
  Deployment,
  DeploymentProblem,
  DeploymentReading,
  Settings,
  SettingsProblem,
  SettingsReading,
} from './deployment.ts';
