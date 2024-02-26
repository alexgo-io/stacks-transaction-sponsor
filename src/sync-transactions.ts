import { StacksMainnet, StacksMocknet } from '@stacks/network';
import { getAccountNonces, getTransaction } from 'ts-clarity';
import { SponsorAccount } from './accounts';
import { SponsorRecord, getPgPool, sql } from './db';
import { stringify } from './util';

export async function syncTransactionStatus(
  network: StacksMocknet | StacksMainnet,
  account: SponsorAccount,
) {
  const { last_executed_tx_nonce } = await getAccountNonces(account.address, {
    stacksEndpoint: network.coreApiUrl,
  });
  const pgPool = await getPgPool();
  // reset transactions status when reorg happens
  await pgPool.transaction(async client => {
    await client.query(sql.void`
      UPDATE user_operations SET status = 'submitted', error = NULL
      WHERE sponsor = ${account.address} AND sponsor_nonce > ${last_executed_tx_nonce}
        AND status != 'submitted'`);
    await client.query(sql.void`
      UPDATE sponsor_records SET status = 'submitted', error = NULL
      WHERE sponsor = ${account.address} AND sponsor_nonce > ${last_executed_tx_nonce}
        AND status != 'submitted'`);
  });
  const submittedTransactions = SponsorRecord.array().parse(
    await pgPool.any(sql.type(SponsorRecord)`
      SELECT * FROM sponsor_records
        WHERE sponsor = ${account.address}
          AND sponsor_nonce <= ${last_executed_tx_nonce}
          AND sponsor_nonce > ${last_executed_tx_nonce - 100}
          AND status = 'submitted'
        ORDER BY sponsor_nonce ASC, fee DESC`),
  );
  let startNonce = BigInt(last_executed_tx_nonce + 1);
  const transactionsByNonce = new Map<bigint, SponsorRecord[]>();
  for (const tx of submittedTransactions) {
    if (startNonce > tx.sponsor_nonce) startNonce = tx.sponsor_nonce;
    const txs = transactionsByNonce.get(tx.sponsor_nonce) ?? [];
    txs.push(tx);
    transactionsByNonce.set(tx.sponsor_nonce, txs);
  }
  for (
    let nonce = startNonce;
    nonce <= BigInt(last_executed_tx_nonce);
    nonce++
  ) {
    const txs = transactionsByNonce.get(nonce);
    if (txs == null) {
      console.warn(`No submitted transactions for nonce ${nonce}`);
      continue;
    }
    let settled = false;
    const tx_ids = new Set<string>();
    for (const tx of txs) {
      tx_ids.add(tx.tx_id.toString('hex'));
      try {
        const { sponsor_tx_id } = tx;
        const tx_info = await getTransaction(sponsor_tx_id.toString('hex'), {
          stacksEndpoint: network.coreApiUrl,
        });
        if (
          tx_info != null &&
          'canonical' in tx_info &&
          tx_info.canonical === true &&
          tx_info.microblock_canonical === true
        ) {
          await pgPool.transaction(async client => {
            const status =
              tx_info.tx_status === 'success' ? 'success' : 'failed';
            const error =
              status === 'success' ? null : stringify(tx_info.tx_result);
            await client.query(sql.void`
              UPDATE user_operations
                SET status = 'failed',
                    error = 'dropped',
                    updated_at = NOW()
              WHERE sponsor = ${account.address}
                AND sponsor_nonce = ${nonce}
                AND status = 'submitted'
                AND tx_id != ${sql.binary(tx.tx_id)}`);
            await client.query(sql.void`
              UPDATE sponsor_records
                SET status = 'failed',
                    error = 'dropped',
                    updated_at = NOW()
              WHERE sponsor = ${account.address}
                AND sponsor_nonce = ${nonce}
                AND status = 'submitted'
                AND id != ${tx.id}`);
            await client.query(sql.void`
              UPDATE user_operations
                SET status = ${status},
                    sponsor_tx_id = ${sql.binary(sponsor_tx_id)},
                    fee = ${tx.fee},
                    error = ${error},
                    updated_at = NOW()
              WHERE sponsor = ${account.address}
                AND sponsor_nonce = ${nonce}
                AND status = 'submitted'
                AND tx_id = ${sql.binary(tx.tx_id)}`);
            await client.query(sql.void`
              UPDATE sponsor_records
                SET status = ${status},
                    error = ${error},
                    updated_at = NOW()
                WHERE id = ${tx.id}`);
          });
          settled = true;
          console.log(
            `Transaction ${tx_info.tx_id} settled with status ${
              tx_info.tx_status
            }: ${JSON.stringify(tx_info.tx_result)}`,
          );
          break;
        }
      } catch (e: unknown) {
        console.error(
          `Fail to get & update status for tx 0x${tx.sponsor_tx_id.toString('hex')}: ${
            (e as Error).stack || e
          }`,
        );
        throw e;
      }
    }
    if (!settled) {
      await pgPool.transaction(async client => {
        await client.query(sql.void`
          UPDATE sponsor_records
            SET status = 'failed',
                error = 'dropped',
                updated_at = NOW()
          WHERE sponsor = ${account.address}
            AND sponsor_nonce = ${nonce}
            AND status = 'submitted'`);
        for (const tx_id of tx_ids) {
          await client.query(sql.void`
            UPDATE user_operations
              SET status = 'failed',
                  error = 'dropped',
                  updated_at = NOW()
            WHERE sponsor = ${account.address}
              AND sponsor_nonce = ${nonce}
              AND status = 'submitted'
              AND tx_id = ${sql.hex(tx_id)}`);
        }
      });
    }
  }
}
