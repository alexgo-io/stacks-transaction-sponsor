import { StacksMainnet, StacksMocknet } from '@stacks/network';
import { getNodeInfo } from 'ts-clarity';
import { getSponsorAccounts } from './accounts';
import { kStacksEndpoint, kStacksNetworkType } from './config';
import { rbfIfNecessary } from './rbf-transactions';
import { submitPendingTransactions } from './submit-transactions';
import { syncTransactionStatus } from './sync-transactions';

async function runWorkerLoop() {
  const network =
    kStacksNetworkType === 'mocknet'
      ? new StacksMocknet({ url: kStacksEndpoint })
      : new StacksMainnet({ url: kStacksEndpoint });
  const info = await getNodeInfo({ stacksEndpoint: kStacksEndpoint });
  const accounts = getSponsorAccounts();
  for (const account of accounts) {
    await syncTransactionStatus(network, account);
    await rbfIfNecessary(network, info.stacks_tip_height, account);
  }
  for (const account of accounts) {
    const { loaded, submitted } = await submitPendingTransactions(
      network,
      info.stacks_tip_height,
      account,
    );
    if (submitted > 0) {
      console.log(
        `Submitted ${submitted} transactions using sponsor account ${account.address}`,
      );
    }
    if (loaded <= 0) break;
  }
}

let running = false;
export function startWorker() {
  running = true;
  setImmediate(async () => {
    while (running) {
      try {
        await runWorkerLoop();
      } catch (e: unknown) {
        console.error(
          `Worker loop failed with error: ${(e as Error).stack || e}`,
        );
      }
      for (let i = 0; running && i < 100; i++) {
        await new Promise(f => setTimeout(f, 100));
      }
    }
  });
}
export function stopWorker() {
  running = false;
}
