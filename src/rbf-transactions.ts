import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  TxRejectedReason,
  broadcastTransaction,
  deserializeTransaction,
  estimateTransactionFeeWithFallback,
  sponsorTransaction,
} from '@stacks/transactions';
import assert from 'assert';
import { getAccountNonces } from 'ts-clarity';
import { SponsorAccount } from './accounts';
import {
  kFeeIncrement,
  kStacksBroadcastEndpoints,
  kStacksNetworkType,
} from './config';
import { UserOperation, getPgPool, sql } from './db';
import { loadGasConfig } from './gas';
import { stringify } from './util';

export async function rbfIfNecessary(
  network: StacksMocknet | StacksMainnet,
  stacks_tip_height: number,
  account: SponsorAccount,
) {
  const { last_executed_tx_nonce } = await getAccountNonces(account.address, {
    stacksEndpoint: network.coreApiUrl,
  });
  const pgPool = await getPgPool();
  const submittedTransactions = await pgPool.any(sql.type(
    UserOperation,
  )`SELECT * FROM user_operations
      WHERE status = 'submitted' AND sponsor = ${account.address}
      ORDER BY sponsor_nonce ASC`);
  const processedTx = new Set<bigint>();
  const replaceInvalidTx = async (invalidTx: UserOperation, reason: string) => {
    assert(invalidTx.sponsor_nonce != null);
    let nextValidTx: UserOperation | null = null;
    const pendingTransactions = await pgPool.any(sql.type(UserOperation)`
      SELECT * FROM user_operations WHERE status = 'pending' ORDER BY id ASC`);
    for (const tx of pendingTransactions) {
      const { last_executed_tx_nonce: user_last_executed_nonce } =
        await getAccountNonces(tx.sender, {
          stacksEndpoint: network.coreApiUrl,
        });
      if (tx.nonce > BigInt(user_last_executed_nonce)) {
        nextValidTx = tx;
        break;
      }
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET status = 'failed',
              error = 'user nonce increased without any sponsored transaction settled',
              updated_at = NOW()
          WHERE id = ${tx.id}`);
      processedTx.add(tx.id);
    }
    if (nextValidTx == null) {
      // if no pending tx to replace it, then try with last submitted
      for (let i = submittedTransactions.length - 1; i >= 0; i--) {
        const tx = submittedTransactions[i];
        if (
          processedTx.has(tx.id) ||
          tx.sponsor_nonce == null ||
          tx.sponsor_nonce <= invalidTx.sponsor_nonce
        ) {
          continue;
        }
        const { last_executed_tx_nonce: user_last_executed_nonce } =
          await getAccountNonces(tx.sender, {
            stacksEndpoint: network.coreApiUrl,
          });
        if (tx.nonce > BigInt(user_last_executed_nonce)) {
          nextValidTx = tx;
          break;
        }
        await pgPool.query(sql.void`
          UPDATE user_operations
            SET status = 'failed',
                error = 'user nonce increased without any sponsored transaction settled',
                sponsor_nonce = NULL,
                updated_at = NOW()
            WHERE id = ${tx.id}`);
        await pgPool.query(sql.void`
          UPDATE sponsor_records
            SET status = 'failed',
                error = 'user nonce increased without any sponsored transaction settled',
                updated_at = NOW()
            WHERE tx_id = ${sql.val(tx.tx_id)}
              AND status = 'submitted'`);
        processedTx.add(tx.id);
      }
    }
    if (nextValidTx != null) {
      // found the replacement
      const user_tx = deserializeTransaction(nextValidTx.raw_tx);
      const user_tx_id = user_tx.txid();
      const fee = nextValidTx.fee + 10n;
      const replacement_sponsor_nonce = nextValidTx.sponsor_nonce;
      const sponsored_tx = await sponsorTransaction({
        transaction: user_tx,
        sponsorPrivateKey: account.secretKey,
        network,
        fee,
        sponsorNonce: invalidTx.sponsor_nonce,
      });
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET sponsor_tx_id = ${sql.hex(sponsored_tx.txid())},
              sponsor = ${account.address},
              sponsor_nonce = ${invalidTx.sponsor_nonce},
              submit_block_height = ${stacks_tip_height},
              fee = ${fee},
              status = 'submitted',
              updated_at = NOW()
          WHERE id = ${nextValidTx.id}`);
      if (replacement_sponsor_nonce != null) {
        await pgPool.query(sql.void`
          UPDATE sponsor_records
            SET status = 'failed',
                error = 'replaced by smaller sponsor nonce',
                updated_at = NOW()
          WHERE tx_id = ${sql.hex(user_tx_id)}
            AND sponsor_nonce = ${replacement_sponsor_nonce}`);
      }
      console.log(
        `Replacement for tx 0x${invalidTx.tx_id.toString('hex')} sponsor nonce ${invalidTx.sponsor_nonce}, replaced by tx 0x${nextValidTx.tx_id.toString('hex')} using sponsor tx 0x${sponsored_tx.txid()} fee ${fee}, previous nonce ${nextValidTx.sponsor_nonce ?? 'N/A'}`,
      );

      try {
        // record first and then submit
        await pgPool.query(sql.void`
          INSERT INTO "public"."sponsor_records"
            (tx_id, raw_tx, sender, nonce, contract_address, function_name, args, fee, sponsor, sponsor_tx_id, sponsor_nonce, submit_block_height, status, created_at, updated_at) VALUES
            (
              ${sql.binary(nextValidTx.tx_id)},
              ${sql.binary(nextValidTx.raw_tx)},
              ${nextValidTx.sender}, ${nextValidTx.nonce},
              ${nextValidTx.contract_address},
              ${nextValidTx.function_name},
              ${JSON.stringify(nextValidTx.args)},
              ${fee},
              ${account.address},
              ${sql.hex(sponsored_tx.txid())},
              ${invalidTx.sponsor_nonce},
              ${stacks_tip_height},
              'pending',
              NOW(),
              NOW()
            )`);
        const rs = await broadcastTransaction(sponsored_tx, network);
        if (rs.reason == null) {
          await pgPool.query(sql.void`
            UPDATE sponsor_records
              SET status = 'submitted',
                  updated_at = NOW()
            WHERE tx_id = ${sql.hex(user_tx_id)}
              AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
        } else {
          console.error(
            `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
              rs.reason
            }, reason_data: ${stringify(rs.reason_data)}`,
          );
          await pgPool.query(sql.void`
            DELETE FROM sponsor_records
            WHERE tx_id = ${sql.hex(user_tx_id)}
              AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
        }
      } catch (e: unknown) {
        // ignore the error if submission failed, and it will be retried during next RBF
        console.warn(
          `failed to submit replacement tx, error: ${(e as Error).stack ?? e}`,
        );
      }
    }
    // Note: there is still an edge case:
    //       reorg happens and user's transaction gets reverted, sponsored transaction becomes settled.
    await pgPool.query(sql.void`
      UPDATE user_operations
        SET status = 'failed',
            error = ${reason},
            sponsor_nonce = NULL,
            updated_at = NOW()
        WHERE id = ${invalidTx.id}`);
    await pgPool.query(sql.void`
      UPDATE sponsor_records
        SET status = 'failed',
            error = ${reason},
            updated_at = NOW()
        WHERE tx_id = ${sql.val(invalidTx.tx_id)}
          AND status = 'submitted'`);
  };

  for (const tx of submittedTransactions) {
    if (processedTx.has(tx.id)) continue;
    if (
      tx.sponsor == null ||
      tx.sponsor_nonce == null ||
      tx.sponsor_tx_id == null ||
      tx.submit_block_height == null
    ) {
      console.error(`Unexpected tx status for 0x${tx.tx_id.toString('hex')}`);
      continue;
    }
    if (tx.sponsor_nonce <= BigInt(last_executed_tx_nonce)) {
      console.warn(
        `Tx ${tx.id} with sponsor ${tx.sponsor} nonce ${tx.sponsor_nonce} still pending, but last executed nonce is ${last_executed_tx_nonce}`,
      );
      continue;
    }
    if (
      tx.submit_block_height + 2n > BigInt(stacks_tip_height) ||
      // skip 1 block before next RBF
      (BigInt(stacks_tip_height) - tx.submit_block_height) % 2n === 1n
    ) {
      continue;
    }
    const { last_executed_tx_nonce: user_last_executed_nonce } =
      await getAccountNonces(tx.sender, { stacksEndpoint: network.coreApiUrl });
    if (tx.nonce <= BigInt(user_last_executed_nonce)) {
      // the nonce might have been used by another non-sponsor transaction
      // double check the sponsor nonce in case it change in the middle of somewhere
      const { last_executed_tx_nonce } = await getAccountNonces(
        account.address,
        { stacksEndpoint: network.coreApiUrl },
      );
      if (tx.sponsor_nonce > BigInt(last_executed_tx_nonce)) {
        await replaceInvalidTx(
          tx,
          'user nonce increased without any sponsored transaction settled',
        );
        continue;
      }
    }
    const user_tx = deserializeTransaction(tx.raw_tx);
    const user_tx_id = user_tx.txid();
    let gas = tx.fee + kFeeIncrement;
    try {
      const gasConfig = await loadGasConfig(user_tx);
      gas = (tx.fee * (100n + gasConfig.incrementRate)) / 100n;
      const estimatedGas = BigInt(
        await estimateTransactionFeeWithFallback(user_tx, network),
      );
      if (estimatedGas > gas) gas = estimatedGas;
      if (gas < gasConfig.baseGas) gas = gasConfig.baseGas;
      if (gas > gasConfig.gasCap) gas = gasConfig.gasCap;
    } catch (e) {
      console.error(`Fail to load gas config for tx 0x${user_tx_id}`);
    }
    if (gas <= tx.fee) {
      console.warn(`RBF tx 0x${user_tx_id} gas reached cap`);
      gas = tx.fee + 10n;
    }
    const sponsored_tx = await sponsorTransaction({
      transaction: user_tx,
      sponsorPrivateKey: account.secretKey,
      network,
      fee: gas,
      sponsorNonce: tx.sponsor_nonce,
    });
    // record first and then submit
    await pgPool.query(sql.typeAlias(
      'void',
    )`INSERT INTO "public"."sponsor_records"
      (tx_id, raw_tx, sender, nonce, contract_address, function_name, args, fee, sponsor, sponsor_tx_id, sponsor_nonce, submit_block_height, status, created_at, updated_at) VALUES
      (
        ${sql.binary(tx.tx_id)},
        ${sql.binary(tx.raw_tx)},
        ${tx.sender}, ${tx.nonce},
        ${tx.contract_address},
        ${tx.function_name},
        ${JSON.stringify(tx.args)},
        ${gas},
        ${account.address},
        ${sql.hex(sponsored_tx.txid())},
        ${tx.sponsor_nonce},
        ${stacks_tip_height},
        'pending',
        NOW(),
        NOW()
      )`);
    const rs = await broadcastTransaction(sponsored_tx, network);
    if (rs.reason == null) {
      // if broadcast endpoint is configured, send the transaction to that endpoint in case the transaction doesn't show up in the explorer.
      setImmediate(() => {
        Promise.all(
          kStacksBroadcastEndpoints.map(async url => {
            try {
              const network =
                kStacksNetworkType === 'mainnet'
                  ? new StacksMainnet({ url })
                  : new StacksMocknet({ url });
              await broadcastTransaction(sponsored_tx, network);
            } catch (e) {
              console.warn(
                `Fail to broadcast transaction ${sponsored_tx.txid()} to ${url}`,
                e,
              );
            }
          }),
        );
      });
      console.log(
        `RBFed user tx 0x${user_tx_id}, previous tx id 0x${tx.sponsor_tx_id.toString(
          'hex',
        )} fee ${tx.fee}, replaced by 0x${sponsored_tx.txid()} fee ${gas}`,
      );
      await pgPool.transaction(async client => {
        await client.query(sql.typeAlias('void')`
          UPDATE user_operations
            SET sponsor_tx_id = ${sql.hex(sponsored_tx.txid())},
                submit_block_height = ${stacks_tip_height},
                fee = ${gas},
                updated_at = NOW()
            WHERE id = ${tx.id}`);
        await client.query(sql.typeAlias('void')`
          UPDATE sponsor_records
            SET status = 'submitted',
                fee = ${gas},
                updated_at = NOW()
            WHERE tx_id = ${sql.val(tx.tx_id)}
              AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
      });
    } else {
      console.error(
        `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
          rs.reason
        }, reason_data: ${stringify(rs.reason_data)}`,
      );
      await pgPool.query(sql.typeAlias('void')`
        DELETE FROM sponsor_records
          WHERE tx_id = ${sql.val(tx.tx_id)}
            AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
      if (
        rs.reason === TxRejectedReason.BadNonce ||
        rs.reason === TxRejectedReason.ConflictingNonceInMempool
      ) {
        // It should not happen, chain state might have changed
        // Leave it to next round to check during syncing transaction status.
        continue;
      }
      if (
        rs.reason === TxRejectedReason.TooMuchChaining ||
        rs.reason === TxRejectedReason.NotEnoughFunds ||
        rs.reason === TxRejectedReason.ServerFailureDatabase ||
        rs.reason === TxRejectedReason.ServerFailureOther ||
        rs.reason === TxRejectedReason.EstimatorError
      ) {
        // rejected by external reasons, and also affect other tx, so we end current loop
        break;
      }
      // if we're not able to submit the transaction, we need to replace the transaction and mark it as failed
      await replaceInvalidTx(
        tx,
        typeof rs === 'string' ? rs : rs.reason ?? 'N/A',
      );
    }
  }
}
