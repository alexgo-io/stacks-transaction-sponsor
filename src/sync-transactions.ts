import { StacksMainnet, StacksMocknet } from '@stacks/network';
import { getAccountNonces, getTransaction } from 'ts-clarity';
import { SponsorAccount } from './accounts';
import { kFeeIncrement, kStacksEndpoint } from './config';
import { getPgPool, sql } from './db';
import { rbfWithNoop } from './rbf-transactions';

async function syncRbfTransactionStatus(txId: Buffer) {
  const pgPool = await getPgPool();
  const submittedTransactions = await pgPool.any(sql.typeAlias(
    'UserOperation',
  )`SELECT * FROM sponsor_records
    WHERE tx_id = ${sql.binary(txId)}
    ORDER BY id DESC`);
  for (const tx of submittedTransactions) {
    if (
      tx.sponsor == null ||
      tx.sponsor_nonce == null ||
      tx.sponsor_tx_id == null ||
      tx.submit_block_height == null
    ) {
      console.error(`Unexpected tx status for 0x${tx.tx_id.toString('hex')}`);
      continue;
    }
    try {
      const tx_info = await getTransaction(tx.sponsor_tx_id.toString('hex'), {
        stacksEndpoint: kStacksEndpoint,
      });
      if (
        tx_info != null &&
        'canonical' in tx_info &&
        tx_info.canonical === true &&
        tx_info.microblock_canonical === true
      ) {
        await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
            SET status = ${
              tx_info.tx_status === 'success' ? 'success' : 'failed'
            },
            error = ${
              tx_info.tx_status === 'success'
                ? null
                : `${tx_info.tx_status}: ${JSON.stringify(tx_info.tx_result)}`
            },
            sponsor_tx_id = ${sql.binary(tx.sponsor_tx_id)},
            fee = ${String(tx.fee)},
            updated_at = NOW()
          WHERE tx_id = ${sql.binary(txId)}`);
        await pgPool.query(sql.typeAlias('void')`UPDATE sponsor_records
            SET status = ${
              tx_info.tx_status === 'success' ? 'success' : 'failed'
            },
            error = ${
              tx_info.tx_status === 'success'
                ? null
                : `${tx_info.tx_status}: ${JSON.stringify(tx_info.tx_result)}`
            },
            updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
        console.log(
          `Transaction ${tx_info.tx_id} settled with status ${
            tx_info.tx_status
          }: ${JSON.stringify(tx_info.tx_result)}`,
        );
        return;
      }
    } catch (e: any) {
      console.error(
        `Fail to update status for tx 0x${tx.sponsor_tx_id.toString('hex')}: ${
          e.stack || e
        }`,
      );
    }
  }
  await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
      SET status = 'failed',
      error = 'unable to get status from all sponsored tx',
      updated_at = NOW()
    WHERE tx_id = ${sql.binary(txId)}`);
}

export async function syncTransactionStatus(
  network: StacksMocknet | StacksMainnet,
  stacks_tip_height: number,
  account: SponsorAccount,
) {
  const { last_executed_tx_nonce } = await getAccountNonces(account.address, {
    stacksEndpoint: network.coreApiUrl,
  });
  const pgPool = await getPgPool();
  const submittedTransactions = await pgPool.any(sql.typeAlias(
    'UserOperation',
  )`SELECT * FROM user_operations
    WHERE status = 'submitted' AND sponsor = ${account.address}`);
  for (const tx of submittedTransactions) {
    if (
      tx.sponsor == null ||
      tx.sponsor_nonce == null ||
      tx.sponsor_tx_id == null ||
      tx.submit_block_height == null
    ) {
      console.error(`Unexpected tx status for 0x${tx.tx_id.toString('hex')}`);
      continue;
    }
    if (
      tx.submit_block_height == null ||
      tx.submit_block_height >= BigInt(stacks_tip_height)
    ) {
      continue;
    }
    try {
      const tx_info = await getTransaction(tx.sponsor_tx_id.toString('hex'), {
        stacksEndpoint: kStacksEndpoint,
      });
      if (
        tx_info != null &&
        'canonical' in tx_info &&
        tx_info.canonical === true &&
        tx_info.microblock_canonical === true
      ) {
        await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
            SET status = ${
              tx_info.tx_status === 'success' ? 'success' : 'failed'
            },
            error = ${
              tx_info.tx_status === 'success'
                ? null
                : `${tx_info.tx_status}: ${JSON.stringify(tx_info.tx_result)}`
            },
            updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
        await pgPool.query(sql.typeAlias('void')`UPDATE sponsor_records
            SET status = ${
              tx_info.tx_status === 'success' ? 'success' : 'failed'
            },
            error = ${
              tx_info.tx_status === 'success'
                ? null
                : `${tx_info.tx_status}: ${JSON.stringify(tx_info.tx_result)}`
            },
            updated_at = NOW()
          WHERE tx_id = ${sql.binary(tx.tx_id)}
          AND sponsor_tx_id = ${sql.binary(tx.sponsor_tx_id)}`);
        console.log(
          `Transaction ${tx_info.tx_id} settled with status ${
            tx_info.tx_status
          }: ${JSON.stringify(tx_info.tx_result)}`,
        );
      } else if (tx.sponsor_nonce <= last_executed_tx_nonce) {
        await syncRbfTransactionStatus(tx.tx_id);
      } else {
        const { last_executed_tx_nonce } = await getAccountNonces(tx.sender, {
          stacksEndpoint: network.coreApiUrl,
        });
        const user_nonce = BigInt(last_executed_tx_nonce);
        if (tx.nonce <= user_nonce) {
          // if none of the sponsored transactions settles, then it must be the user who RBFed it.
          await rbfWithNoop(
            network,
            account,
            tx.sponsor_nonce,
            tx.fee + kFeeIncrement,
          );
          await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
              SET status = 'failed',
                  error = 'user nonce increased without any sponsored transaction settled',
                  updated_at = NOW()
              WHERE id = ${String(tx.id)}`);
        }
      }
    } catch (e: any) {
      console.error(
        `Fail to update status for tx 0x${tx.sponsor_tx_id.toString('hex')}: ${
          e.stack || e
        }`,
      );
    }
  }
}
