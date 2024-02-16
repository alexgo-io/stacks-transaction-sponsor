import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  broadcastTransaction,
  deserializeTransaction,
  sponsorTransaction,
} from '@stacks/transactions';
import { getAccountNonces, getNodeInfo } from 'ts-clarity';
import yargs from 'yargs-parser';
import { getSponsorAccounts } from '../accounts';
import { kStacksEndpoint, kStacksNetworkType } from '../config';
import { UserOperation, getPgPool, sql } from '../db';
import { stringify } from '../util';

// DO NOT USE THIS unless you know what you're doing!
async function main() {
  const argv = yargs(process.argv.slice(2), {
    configuration: { 'parse-numbers': false },
  });
  let tx = String(argv.tx);
  if (tx.startsWith('\\x') || tx.startsWith('0x')) {
    tx = tx.substring(2);
  }
  if (tx.startsWith('x')) {
    tx = tx.substring(1);
  }
  if (!tx.match(/[0-9a-fA-F]{64}/)) {
    console.log(`Invalid tx: ${tx}`);
    return;
  }
  const tx_id = Buffer.from(tx, 'hex');
  const sponsorAccount = argv.account;
  const nonce = Number(BigInt(argv.nonce));
  const gas = BigInt(argv.gas);

  const account = getSponsorAccounts().find(a => a.address === sponsorAccount);
  if (account == null) {
    console.log(`Invalid sponsor account: ${sponsorAccount}`);
    return;
  }
  const { last_executed_tx_nonce } = await getAccountNonces(sponsorAccount, {
    stacksEndpoint: kStacksEndpoint,
  });
  if (!(last_executed_tx_nonce < nonce)) {
    console.log(
      `Invalid sponsor nonce: ${nonce}, last executed: ${last_executed_tx_nonce}`,
    );
    return;
  }

  const pgPool = await getPgPool();
  const replacer = await pgPool.maybeOne(sql.type(UserOperation)`
    SELECT * FROM "user_operations" WHERE "tx_id" = ${sql.binary(tx_id)}`);
  if (replacer == null) {
    console.log(`User operation 0x${tx} not found`);
    return;
  }
  const { last_executed_tx_nonce: user_last_executed_nonce } =
    await getAccountNonces(replacer.sender, {
      stacksEndpoint: kStacksEndpoint,
    });
  if (replacer.nonce <= BigInt(user_last_executed_nonce)) {
    console.log(
      `Invalid user operation 0x${tx} nonce ${replacer.nonce}, last executed: ${user_last_executed_nonce}`,
    );
    return;
  }

  await pgPool.transaction(async client => {
    const currentOperation = await client.maybeOne(sql.type(UserOperation)`
      SELECT * FROM "user_operations"
        WHERE "sponsor" = ${sponsorAccount}
          AND "sponsor_nonce" = ${nonce}
          AND "status" = 'submitted'`);
    if (currentOperation != null && !currentOperation.tx_id.equals(tx_id)) {
      await client.query(sql.typeAlias('void')`
        UPDATE "sponsor_records"
          SET "status" = 'failed',
              "error" = 'dropped by another operation'
          WHERE "tx_id" = ${sql.binary(currentOperation.tx_id)}`);
      await client.query(sql.typeAlias('void')`
        UPDATE "user_operations"
          SET "status" = 'failed',
              "error" = 'dropped by another operation'
          WHERE "id" = ${currentOperation.id}`);
    }
    await client.query(sql.typeAlias('void')`
      UPDATE "sponsor_records"
        SET "status" = 'failed',
            "error" = 'dropped and processed with another nonce'
        WHERE "tx_id" = ${sql.binary(replacer.tx_id)}`);
    await client.query(sql.typeAlias('void')`
      UPDATE "user_operations"
        SET "sponsor" = ${sponsorAccount},
            "sponsor_nonce" = ${nonce}
        WHERE "id" = ${replacer.id}`);
  });

  const user_tx = deserializeTransaction(replacer.raw_tx);
  const user_tx_id = user_tx.txid();
  const network =
    kStacksNetworkType === 'mocknet'
      ? new StacksMocknet({ url: kStacksEndpoint })
      : new StacksMainnet({ url: kStacksEndpoint });
  const nodeInfo = await getNodeInfo({ stacksEndpoint: kStacksEndpoint });
  const sponsored_tx = await sponsorTransaction({
    transaction: user_tx,
    sponsorPrivateKey: account.secretKey,
    network,
    fee: gas,
    sponsorNonce: nonce,
  });
  // record first and then submit
  await pgPool.query(sql.typeAlias(
    'void',
  )`INSERT INTO "public"."sponsor_records"
    (tx_id, raw_tx, sender, nonce, contract_address, function_name, args, fee, sponsor, sponsor_tx_id, sponsor_nonce, submit_block_height, status, created_at, updated_at) VALUES
    (
      ${sql.binary(replacer.tx_id)},
      ${sql.binary(replacer.raw_tx)},
      ${replacer.sender}, ${String(replacer.nonce)},
      ${replacer.contract_address},
      ${replacer.function_name},
      ${JSON.stringify(replacer.args)},
      ${String(gas)},
      ${account.address},
      ${sql.binary(Buffer.from(sponsored_tx.txid(), 'hex'))},
      ${String(replacer.sponsor_nonce)},
      ${nodeInfo.stacks_tip_height},
      'pending',
      NOW(),
      NOW()
    )`);
  const rs = await broadcastTransaction(sponsored_tx, network);
  if (rs.reason == null) {
    console.log(
      `Submitted user tx 0x${user_tx_id} by 0x${sponsored_tx.txid()}`,
    );
    await pgPool.query(sql.typeAlias('void')`
      UPDATE user_operations
        SET sponsor_tx_id = ${sql.binary(Buffer.from(sponsored_tx.txid(), 'hex'))},
            submit_block_height = ${nodeInfo.stacks_tip_height},
            fee = ${gas},
            updated_at = NOW()
        WHERE id = ${replacer.id}`);
    await pgPool.query(sql.typeAlias('void')`
      UPDATE sponsor_records
        SET status = 'submitted',
            fee = ${gas},
            updated_at = NOW()
        WHERE tx_id = ${sql.binary(replacer.tx_id)}
          AND sponsor_tx_id = ${sql.binary(Buffer.from(sponsored_tx.txid(), 'hex'))}`);
  } else {
    console.error(
      `Fail to broadcast tx ${rs.txid}, error: ${rs.error}, reason: ${
        rs.reason
      }, reason_data: ${stringify(rs, null, 2)}`,
    );
    await pgPool.query(sql.typeAlias('void')`
      UPDATE user_operations
        SET sponsor_tx_id = ${sql.binary(Buffer.from(sponsored_tx.txid(), 'hex'))},
            fee = ${gas},
            status = 'failed',
            error = ${rs.reason ?? 'N/A'},
            updated_at = NOW()
        WHERE id = ${replacer.id}`);
    await pgPool.query(sql.typeAlias('void')`
      DELETE FROM "sponsor_records"
        WHERE tx_id = ${sql.binary(replacer.tx_id)}
          AND sponsor_tx_id = ${sql.binary(Buffer.from(sponsored_tx.txid(), 'hex'))}`);
  }
}

main().catch(console.error);
