import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  broadcastTransaction,
  makeSTXTokenTransfer,
} from '@stacks/transactions';
import got from 'got-cjs';
import { getAccountNonces } from 'ts-clarity';
import { getSponsorAccounts } from '../accounts';
import { kStacksEndpoint, kStacksNetworkType } from '../config';
import { stringify } from '../util';

async function main() {
  const network =
    kStacksNetworkType === 'mainnet'
      ? new StacksMainnet({ url: kStacksEndpoint })
      : new StacksMocknet({ url: kStacksEndpoint });
  const accounts = getSponsorAccounts();
  const balances = await Promise.all(
    accounts.map(async account => {
      const url = network.getAccountExtendedBalancesApiUrl(account.address);
      const { stx } = await got.get(url).json<{ stx: { balance: bigint } }>();
      return Number(stx.balance) / 1e6;
    }),
  );
  accounts.forEach((account, i) => {
    console.log(
      `Account #${i + 1} ${account.address} STX balance: ${balances[i].toFixed(
        3,
      )}`,
    );
  });
  // Don't use this for mainnet, there will be nonce issue if we use the first account to send gas to the rest.
  // Use another account to send gas to these sponsor accounts
  if (kStacksNetworkType === 'mainnet') {
    console.log('Skip sending gas for mainnet');
    return;
  }
  const { possible_next_nonce } = await getAccountNonces(accounts[0].address, {
    stacksEndpoint: network.coreApiUrl,
  });
  let nonce = BigInt(possible_next_nonce);
  for (let i = 1; i < accounts.length; i++) {
    if (balances[i] < 10) {
      console.log(
        `Sending 10 STX from ${accounts[0].address} to ${accounts[i].address}...`,
      );
      const tx = await makeSTXTokenTransfer({
        senderKey: accounts[0].secretKey,
        network,
        fee: 1500,
        nonce,
        recipient: accounts[i].address,
        amount: 10e6,
        anchorMode: 'any',
      });
      const rs = await broadcastTransaction(tx, network);
      if (rs.reason == null) {
        nonce++;
        console.log(`Tx ${tx.txid()} broadcasted`);
      } else {
        console.log(
          `Tx ${tx.txid()} failed with reason: ${rs.reason}, ${stringify(
            rs.reason_data,
          )}`,
        );
      }
    }
  }
}

main().catch(console.error);
