import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  TxRejectedReason,
  broadcastTransaction,
  deserializeTransaction,
  makeSTXTokenTransfer,
  sponsorTransaction,
} from '@stacks/transactions';
import { SponsorAccount } from './accounts';
import {
  kFeeIncrement,
  kNoopStxReceiver,
  kStacksBroadcastEndpoints,
  kStacksNetworkType,
} from './config';
import { getPgPool, sql } from './db';
import { loadGasConfig } from './gas';
import { hexToBuffer, stringify } from './util';

export async function rbfWithNoop(
  network: StacksMocknet | StacksMainnet,
  account: SponsorAccount,
  nonce: bigint,
  fee: bigint,
) {
  const rbf_tx = await makeSTXTokenTransfer({
    senderKey: account.secretKey,
    network,
    fee,
    nonce,
    recipient: kNoopStxReceiver,
    amount: 100,
    anchorMode: 'any',
  });
  const rbf_rs = await broadcastTransaction(rbf_tx, network);
  console.log(
    `Broadcasted noop tx ${rbf_rs.txid}, error: ${rbf_rs.error}, reason: ${
      rbf_rs.reason
    }, reason_data: ${JSON.stringify(rbf_rs.reason_data)}`,
  );
}

export async function rbfIfNecessary(
  network: StacksMocknet | StacksMainnet,
  stacks_tip_height: number,
  account: SponsorAccount,
) {
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
    if (tx.submit_block_height + 2n > BigInt(stacks_tip_height)) {
      continue;
    }
    if ((BigInt(stacks_tip_height) - tx.submit_block_height) % 2n === 1n) {
      // skip 1 block before next RBF
      continue;
    }
    const user_tx = deserializeTransaction(tx.raw_tx);
    const user_tx_id = user_tx.txid();
    let gas = tx.fee + kFeeIncrement;
    try {
      const gasConfig = await loadGasConfig(user_tx);
      gas = (tx.fee * (100n + gasConfig.incrementRate)) / 100n;
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
        ${tx.sender}, ${String(tx.nonce)},
        ${tx.contract_address},
        ${tx.function_name},
        ${JSON.stringify(tx.args)},
        ${String(gas)},
        ${account.address},
        ${sql.binary(hexToBuffer(sponsored_tx.txid()))},
        ${String(tx.sponsor_nonce)},
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
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
          SET sponsor_tx_id = ${sql.binary(hexToBuffer(sponsored_tx.txid()))},
              submit_block_height = ${stacks_tip_height},
              fee = ${String(gas)},
              updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
      await pgPool.query(sql.typeAlias('void')`UPDATE sponsor_records
          SET status = 'submitted',
              fee = ${String(gas)},
              updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
    } else {
      console.error(
        `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
          rs.reason
        }, reason_data: ${stringify(rs.reason_data)}`,
      );
      console.error(stringify(rs, null, 2));
      if (rs.reason === TxRejectedReason.BadNonce) {
        // A previously submitted transaction settled, replacement rejected.
        // Leave it to next round to check during syncing transaction status.
        continue;
      }
      // if we're not able to submit the transaction, we need to replace the transaction with a noop and mark it as failed
      await rbfWithNoop(network, account, tx.sponsor_nonce, gas);
      await pgPool.query(sql.typeAlias('void')`UPDATE user_operations
          SET sponsor_tx_id = ${sql.binary(hexToBuffer(sponsored_tx.txid()))},
              fee = ${String(gas)},
              status = 'failed',
              error = ${rs.reason ?? 'N/A'},
              updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
      await pgPool.query(sql.typeAlias('void')`UPDATE sponsor_records
          SET status = 'failed',
              error = ${rs.reason ?? 'N/A'},
              updated_at = NOW()
          WHERE id = ${String(tx.id)}`);
    }
  }
}
