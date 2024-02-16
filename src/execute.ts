import { StacksMainnet, StacksMocknet } from '@stacks/network';
import {
  AddressHashMode,
  AddressVersion,
  AuthType,
  PayloadType,
  StacksMessageType,
  addressToString,
  cvToString,
  deserializeTransaction,
} from '@stacks/transactions';
import assert from 'assert';
import { RequestHandler } from 'express';
import { getAccountNonces } from 'ts-clarity';
import {
  kMaxTransactionsPerBlock,
  kSponsorWalletCount,
  kStacksEndpoint,
  kStacksNetworkType,
} from './config';
import { getPgPool, sql } from './db';
import { UnsupportedOperation, loadGasConfig } from './gas';
import { hexToBuffer } from './util';

export const executeSponsorTransaction: RequestHandler = async (req, res) => {
  const respond = (
    httpCode: number,
    code: string,
    message: string | null,
    tx_id?: string,
  ) => {
    const wrap = req.body.wrap_http_code === 'true';
    if (wrap) {
      res.status(200).json({
        http_code: httpCode,
        code,
        message,
        tx_id: tx_id ?? null,
      });
    } else {
      res.status(httpCode).json({
        code,
        message,
        tx_id: tx_id ?? null,
      });
    }
  };
  try {
    if (req.body.tx == null || String(req.body.tx).length === 0) {
      respond(400, 'invalid_tx', 'Expecting tx in a JSON body');
      return;
    }
    if (!String(req.body.tx).match(/^[0-9a-f]+$/)) {
      respond(400, 'invalid_tx', `Invalid tx hex value: '${req.body.tx}'`);
      return;
    }
    const tx = deserializeTransaction(hexToBuffer(req.body.tx));
    try {
      await loadGasConfig(tx);
    } catch (e) {
      if (e instanceof UnsupportedOperation) {
        respond(401, 'operation_not_supported', String(e));
        return;
      }
      throw e;
    }
    const contractCall = tx.payload;
    assert(
      contractCall.payloadType === PayloadType.ContractCall &&
        contractCall.type === StacksMessageType.Payload,
    );
    const network =
      kStacksNetworkType === 'mocknet'
        ? new StacksMocknet({ url: kStacksEndpoint })
        : new StacksMainnet({ url: kStacksEndpoint });

    if (tx.auth.authType !== AuthType.Sponsored) {
      respond(
        400,
        'operation_not_supported',
        'Non-sponsor transaction not supported',
      );
      return;
    }

    try {
      tx.verifyOrigin();
    } catch (e) {
      respond(400, 'invalid_tx', `unable to verify tx: ${e}`);
      return;
    }
    const spendingCondition = tx.auth.spendingCondition;
    if (
      spendingCondition.hashMode !== AddressHashMode.SerializeP2PKH &&
      spendingCondition.hashMode !== AddressHashMode.SerializeP2WPKH
    ) {
      respond(
        400,
        'multisig_not_supported',
        'Multisig address it not supported',
      );
      return;
    }
    const { nonce, signer } = spendingCondition;
    const sender = addressToString({
      type: 0,
      version:
        kStacksNetworkType === 'mocknet'
          ? AddressVersion.TestnetSingleSig
          : AddressVersion.MainnetSingleSig,
      hash160: signer,
    });

    const pgPool = await getPgPool();
    const lastOperation = await pgPool.maybeOne(sql.typeAlias(
      'UserOperation',
    )`SELECT * FROM "public"."user_operations"
      WHERE sender = ${sender} ORDER BY nonce DESC LIMIT 1`);
    if (
      lastOperation != null &&
      (lastOperation.status === 'pending' ||
        lastOperation.status === 'submitted')
    ) {
      respond(
        401,
        'pending_operation_exists',
        `There's already a pending sponsored transaction 0x${lastOperation.tx_id.toString(
          'hex',
        )} with nonce ${
          lastOperation.nonce
        }, please wait until it's settled before submitting a new one`,
      );
      return;
    }
    const { c } = await pgPool.one(
      sql.typeAlias(
        'c',
      )`SELECT COUNT(*) as c FROM "public"."user_operations" WHERE status IN ('pending', 'submitted')`,
    );
    if (c > BigInt(kMaxTransactionsPerBlock * kSponsorWalletCount)) {
      respond(
        429,
        'capacity_exceed',
        'Platform sponsor transaction capacity exceeded, please retry until next block',
      );
      return;
    }

    const { possible_next_nonce, last_executed_tx_nonce } =
      await getAccountNonces(sender, {
        stacksEndpoint: network.coreApiUrl,
      });
    if (possible_next_nonce !== last_executed_tx_nonce + 1) {
      respond(
        401,
        'pending_operation_exists',
        'Account with pending transactions is not eligible for being sponsored',
      );
      return;
    }
    if (nonce !== BigInt(possible_next_nonce)) {
      respond(
        401,
        'invalid_nonce',
        `Nonce ${nonce} not matching onchain nonce ${possible_next_nonce}`,
      );
      return;
    }

    await pgPool.query(sql.typeAlias(
      'void',
    )`INSERT INTO "public"."user_operations"
      (tx_id, raw_tx, sender, nonce, contract_address, function_name, args, fee, status, created_at, updated_at) VALUES
      (
        ${sql.binary(hexToBuffer(tx.txid()))},
        ${sql.binary(hexToBuffer(req.body.tx))},
        ${sender}, ${String(nonce)},
        ${`${addressToString(contractCall.contractAddress)}.${
          contractCall.contractName.content
        }`},
        ${contractCall.functionName.content},
        ${JSON.stringify(
          contractCall.functionArgs.map(arg => cvToString(arg)),
        )},
        1000,
        'pending',
        NOW(),
        NOW()
      )`);
    respond(200, 'ok', null, tx.txid());
  } catch (e) {
    respond(500, 'unknown_error', String(e));
  }
};
