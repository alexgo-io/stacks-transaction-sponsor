import { TransactionVersion } from '@stacks/common';
import { hashSha256Sync } from '@stacks/encryption';
import { getAddressFromPrivateKey } from '@stacks/transactions';
import assert from 'node:assert';
import {
  kSponsorAccountCount,
  kSponsorAddress,
  kSponsorSecretKey,
  kStacksNetworkType,
} from './config';

export interface SponsorAccount {
  address: string;
  secretKey: string;
}

const accounts: SponsorAccount[] = [];

export function getSponsorAccounts(): SponsorAccount[] {
  if (accounts.length > 0) return accounts;
  const transactionVersion =
    kStacksNetworkType === 'mainnet'
      ? TransactionVersion.Mainnet
      : TransactionVersion.Testnet;
  accounts.push({
    address: kSponsorAddress,
    secretKey: kSponsorSecretKey,
  });
  assert(
    kSponsorAddress ===
      getAddressFromPrivateKey(kSponsorSecretKey, transactionVersion),
    `Sponsor address ${kSponsorAddress} does not match with the address from private key`,
  );
  let secretKey = kSponsorSecretKey;
  for (let i = 0; i < kSponsorAccountCount - 1; i++) {
    const sk = hashSha256Sync(Buffer.from(secretKey, 'hex'));
    secretKey = `${Buffer.from(sk, sk.byteOffset, sk.byteLength).toString(
      'hex',
    )}01`;
    const address = getAddressFromPrivateKey(secretKey, transactionVersion);
    accounts.push({
      address,
      secretKey,
    });
  }
  return accounts;
}
