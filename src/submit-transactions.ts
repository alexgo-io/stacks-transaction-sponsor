import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  AuthType,
  broadcastTransaction,
  deserializeTransaction,
  estimateContractFunctionCall,
  getNonce,
  sponsorTransaction,
} from '@stacks/transactions';
import { SponsorAccount } from './accounts';
import {
  kBaseFee,
  kMaxTransactionsPerBlock,
  kStacksBroadcastEndpoints,
  kStacksNetworkType,
} from './config';
import { getPgPool, sql } from './db';
import { loadGasConfig } from './gas';
import { hexToBuffer, stringify } from './util';

export async function submitPendingTransactions(
  network: StacksMocknet | StacksMainnet,
  stacks_tip_height: number,
  account: SponsorAccount,
) {
  const pgPool = await getPgPool();
  const submittedTransactions = await pgPool.any(sql.typeAlias(
    'UserOperation',
  )`SELECT * FROM user_operations
      WHERE status = 'submitted' AND sponsor = ${account.address}`);
  const pendingTransactions = await pgPool.any(sql.typeAlias(
    'UserOperation',
  )`SELECT * FROM user_operations
      WHERE status = 'pending' ORDER BY id ASC LIMIT ${
        kMaxTransactionsPerBlock - submittedTransactions.length
      }`);
  if (submittedTransactions.length >= kMaxTransactionsPerBlock) {
    return {
      loaded: pendingTransactions.length,
      submitted: 0,
    };
  }
  const onchain_next_nonce = await getNonce(account.address, network);
  const last_submitted = await pgPool.maybeOne(sql.typeAlias(
    'UserOperation',
  )`SELECT * FROM user_operations
      WHERE sponsor = ${account.address}
      ORDER BY sponsor_nonce DESC LIMIT 1`);

  const nonce =
    last_submitted == null || last_submitted.sponsor_nonce == null
      ? onchain_next_nonce
      : onchain_next_nonce > last_submitted.sponsor_nonce
        ? onchain_next_nonce
        : last_submitted.sponsor_nonce + 1n;

  if (pendingTransactions.length > 0)
    console.log(
      `Working on ${pendingTransactions.length} pending operations with sponsor account ${account.address}`,
    );
  let submitted = 0;
  for (let i = 0; i < pendingTransactions.length; i++) {
    const tx = pendingTransactions[i];
    const user_tx = deserializeTransaction(tx.raw_tx);
    const user_tx_id = user_tx.txid();
    const sponsorNonce = nonce + BigInt(submitted);
    let gas = kBaseFee;
    try {
      const gasConfig = await loadGasConfig(user_tx);
      gas = await estimateContractFunctionCall(user_tx, network);
      if (gas < gasConfig.baseGas) gas = gasConfig.baseGas;
      if (gas > gasConfig.gasCap) gas = gasConfig.gasCap;
    } catch (e) {
      console.error(`Fail to load gas config for tx 0x${user_tx_id}`);
    }
    if (user_tx.auth.authType !== AuthType.Sponsored) {
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
        SET status = 'failed',
            error = 'not a sponsor transaction',
            updated_at = NOW()
        WHERE id = ${String(tx.id)}`);
      continue;
    }
    try {
      user_tx.verifyOrigin();
    } catch (e: any) {
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
        SET status = 'failed',
            error = ${String(e)},
            updated_at = NOW()
        WHERE id = ${String(tx.id)}`);
      continue;
    }
    console.log(`Submitting user tx 0x${user_tx_id}...`);
    const sponsored_tx = await sponsorTransaction({
      transaction: user_tx,
      sponsorPrivateKey: account.secretKey,
      network,
      fee: gas,
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
        ${tx.sender}, ${String(tx.nonce)},
        ${tx.contract_address},
        ${tx.function_name},
        ${JSON.stringify(tx.args)},
        ${String(gas)},
        ${account.address},
        ${sql.binary(hexToBuffer(sponsored_tx.txid()))},
        ${String(sponsorNonce)},
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
        `Submitted user operation 0x${user_tx_id} with tx 0x${sponsored_tx.txid()} fee ${gas} nonce ${sponsorNonce}`,
      );
      await pgPool.query(sql.typeAlias('void')`UPDATE "public"."sponsor_records"
          SET status = 'submitted',
              updated_at = NOW()
          WHERE tx_id = ${sql.binary(
            tx.tx_id,
          )} AND sponsor_tx_id = ${sql.binary(
            hexToBuffer(sponsored_tx.txid()),
          )}`);
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
          SET sponsor = ${account.address},
              sponsor_tx_id = ${sql.binary(hexToBuffer(sponsored_tx.txid()))},
              sponsor_nonce = ${String(sponsorNonce)},
              submit_block_height = ${stacks_tip_height},
              fee = ${String(gas)},
              status = 'submitted',
              updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
    } else {
      console.error(
        `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
          rs.reason
        }, reason_data: ${stringify(rs.reason_data)}`,
      );
      console.error(stringify(rs, null, 2));
      await pgPool.query(sql.typeAlias('void')`UPDATE "public"."sponsor_records"
          SET status = 'failed',
              error = ${rs.reason ?? 'N/A'},
              updated_at = NOW()
          WHERE tx_id = ${sql.binary(
            tx.tx_id,
          )} AND sponsor_tx_id = ${sql.binary(
            hexToBuffer(sponsored_tx.txid()),
          )}`);
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
        SET submit_block_height = ${stacks_tip_height},
            fee = ${String(gas)},
            status = 'failed',
            error = ${rs.reason ?? 'N/A'},
            updated_at = NOW()
        WHERE id = ${String(tx.id)}`);
    }
  }
  return {
    loaded: pendingTransactions.length,
    submitted,
  };
}
