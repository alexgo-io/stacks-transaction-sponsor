import assert from 'node:assert';

export function getOptionalEnv(envKey: string) {
  return process.env[envKey];
}

export function getRequiredEnv(envKey: string) {
  const value = process.env[envKey];
  assert(value != null, `Env ${envKey} is not configured.`);
  return value;
}

export const kStacksNetworkType = getRequiredEnv('STACKS_NETWORK_TYPE') as
  | 'mocknet'
  | 'mainnet';
assert(
  kStacksNetworkType === 'mainnet' || kStacksNetworkType === 'mocknet',
  `Invalid STACKS_NETWORK_TYPE: ${kStacksNetworkType}`,
);

export const kStacksEndpoint = getRequiredEnv('STACKS_API_URL');
export const kStacksBroadcastEndpoints: string[] = (() => {
  const config = getOptionalEnv('STACKS_BROADCAST_ENDPOINTS');
  if (config == null) return [];
  const endpoints = config.split(',');
  for (const url of endpoints) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`invalid broadcast endpoint ${url}`);
    }
  }
  return endpoints;
})();
export const kDeployerAddress = getRequiredEnv('DEPLOYER_ACCOUNT_ADDRESS');
export const kNoopStxReceiver = getRequiredEnv('NOOP_STX_RECEIVER');
export const kSponsorAddress = getRequiredEnv('SPONSOR_ACCOUNT_ADDRESS');
export const kSponsorSecretKey = getRequiredEnv('SPONSOR_ACCOUNT_SECRETKEY');
export const kSponsorAccountCount = Number(
  getOptionalEnv('SPONSOR_ACCOUNT_COUNT') ?? 1,
);

export const kMaxTransactionsPerBlock = Number(
  getOptionalEnv('MAX_TX_PER_BLOCK') ?? 20,
);
export const kSponsorWalletCount = Number(
  BigInt(getOptionalEnv('SPONSOR_WALLET_COUNT') ?? '1'),
);
export const kBaseFee = 10000n;
export const kRbfMinFee = 1500n;
export const kFeeIncrement = 500n;

export const kDefaultGotRequestOptions = {
  timeout: { request: 5000 },
};
