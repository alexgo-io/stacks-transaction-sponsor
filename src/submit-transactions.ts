import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  AuthType,
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
  kBaseFee,
  kMaxTransactionsPerBlock,
  kStacksBroadcastEndpoints,
  kStacksNetworkType,
} from './config';
import { SponsorRecord, UserOperation, getPgPool, sql } from './db';
import { loadGasConfig } from './gas';
import { stringify } from './util';

export async function submitPendingTransactions(
  network: StacksMocknet | StacksMainnet,
  stacks_tip_height: number,
  account: SponsorAccount,
) {
  const pgPool = await getPgPool();
  const submittedTransactions = await pgPool.any(sql.type(UserOperation)`
    SELECT * FROM user_operations
      WHERE status = 'submitted' AND sponsor = ${account.address}
      ORDER BY sponsor_nonce DESC`);
  const pendingTransactions = await pgPool.any(sql.type(UserOperation)`
    SELECT * FROM user_operations
      WHERE status = 'pending' ORDER BY id ASC
      LIMIT ${kMaxTransactionsPerBlock - submittedTransactions.length}`);
  if (submittedTransactions.length >= kMaxTransactionsPerBlock) {
    return {
      loaded: pendingTransactions.length,
      submitted: 0,
    };
  }
  const { possible_next_nonce } = await getAccountNonces(account.address, {
    stacksEndpoint: network.coreApiUrl,
  });
  const onchain_next_nonce = BigInt(possible_next_nonce);
  const last_submitted: UserOperation | null =
    submittedTransactions[0] ??
    (await pgPool.maybeOne(sql.type(UserOperation)`
      SELECT * FROM user_operations
        WHERE sponsor = ${account.address}
          AND sponsor_nonce > 0
        ORDER BY sponsor_nonce DESC LIMIT 1`));
  assert(last_submitted == null || last_submitted.sponsor_nonce != null);

  const nonce =
    last_submitted?.sponsor_nonce == null
      ? onchain_next_nonce
      : last_submitted.sponsor_nonce + 1n;

  if (pendingTransactions.length > 0) {
    console.log(
      `Working on ${pendingTransactions.length} pending operations with sponsor account ${account.address}`,
    );
  }
  let submitted = 0;
  for (let i = 0; i < pendingTransactions.length; i++) {
    const tx = pendingTransactions[i];
    const user_tx = deserializeTransaction(tx.raw_tx);
    const user_tx_id = user_tx.txid();
    const sponsorNonce = nonce + BigInt(submitted);
    if (user_tx.auth.authType !== AuthType.Sponsored) {
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET status = 'failed',
              error = 'not a sponsor transaction',
              updated_at = NOW()
        WHERE id = ${tx.id}`);
      continue;
    }
    try {
      user_tx.verifyOrigin();
    } catch (e) {
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET status = 'failed',
              error = ${String(e)},
              updated_at = NOW()
          WHERE id = ${tx.id}`);
      continue;
    }

    const { last_executed_tx_nonce: user_last_executed_nonce } =
      await getAccountNonces(tx.sender, {
        stacksEndpoint: network.coreApiUrl,
      });
    if (tx.nonce <= BigInt(user_last_executed_nonce)) {
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET status = 'failed',
              error = 'user nonce increased without any sponsored transaction settled',
              sponsor_nonce = NULL,
              updated_at = NOW()
          WHERE id = ${tx.id}`);
      continue;
    }

    let fee = kBaseFee;
    try {
      const gasConfig = await loadGasConfig(user_tx);
      fee = BigInt(await estimateTransactionFeeWithFallback(user_tx, network));
      if (fee < gasConfig.baseGas) fee = gasConfig.baseGas;
      if (fee > gasConfig.gasCap) fee = gasConfig.gasCap;
    } catch (e) {
      console.error(`Fail to load gas config for tx 0x${user_tx_id}`);
    }
    if (sponsorNonce < BigInt(possible_next_nonce)) {
      // current nonce is possibly replaced by a smaller nonce
      const previous = await pgPool.maybeOne(sql.type(SponsorRecord)`
        SELECT * FROM sponsor_records
          WHERE sponsor = ${account.address}
            AND sponsor_nonce = ${sponsorNonce}
          ORDER BY fee DESC LIMIT 1`);
      if (previous != null && previous.fee > fee) {
        fee = previous.fee + 1n;
      }
    }
    console.log(`Submitting user tx 0x${user_tx_id}...`);
    const sponsored_tx = await sponsorTransaction({
      transaction: user_tx,
      sponsorPrivateKey: account.secretKey,
      network,
      fee,
      sponsorNonce,
    });
    // Record first in case of unknown error
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
        ${fee},
        ${account.address},
        ${sql.hex(sponsored_tx.txid())},
        ${sponsorNonce},
        ${stacks_tip_height},
        'pending',
        NOW(),
        NOW()
      )`);
    const rs = await broadcastTransaction(sponsored_tx, network);
    if (rs.reason == null) {
      submitted++;
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
        `Submitted user operation 0x${user_tx_id} with tx 0x${sponsored_tx.txid()} fee ${fee} nonce ${sponsorNonce}`,
      );
      await pgPool.query(sql.void`
        UPDATE "public"."sponsor_records"
          SET status = 'submitted',
              updated_at = NOW()
        WHERE tx_id = ${sql.binary(tx.tx_id)}
          AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
      await pgPool.query(sql.void`
        UPDATE user_operations
          SET sponsor = ${account.address},
              sponsor_tx_id = ${sql.hex(sponsored_tx.txid())},
              sponsor_nonce = ${sponsorNonce},
              submit_block_height = ${stacks_tip_height},
              fee = ${fee},
              status = 'submitted',
              updated_at = NOW()
        WHERE id = ${tx.id}`);
    } else {
      console.error(
        `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
          rs.reason
        }, reason_data: ${stringify(rs)}`,
      );
      await pgPool.query(sql.void`
        DELETE FROM "public"."sponsor_records"
        WHERE tx_id = ${sql.binary(tx.tx_id)}
          AND sponsor_tx_id = ${sql.hex(sponsored_tx.txid())}`);
      if (
        rs.reason === TxRejectedReason.TooMuchChaining ||
        rs.reason === TxRejectedReason.BadNonce ||
        rs.reason === TxRejectedReason.NotEnoughFunds ||
        rs.reason === TxRejectedReason.ConflictingNonceInMempool ||
        rs.reason === TxRejectedReason.ServerFailureDatabase ||
        rs.reason === TxRejectedReason.ServerFailureOther ||
        rs.reason === TxRejectedReason.EstimatorError
      ) {
        // Rejected by external reasons, retry later.
        break;
      }
      await pgPool.query(sql.void`UPDATE user_operations
        SET submit_block_height = ${stacks_tip_height},
            fee = ${fee},
            status = 'failed',
            error = ${rs.reason ?? 'N/A'},
            updated_at = NOW()
        WHERE id = ${tx.id}`);
    }
  }
  return {
    loaded: pendingTransactions.length,
    submitted,
  };
}
