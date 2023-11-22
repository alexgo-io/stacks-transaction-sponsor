import {
  PayloadType,
  StacksMessageType,
  StacksTransaction,
  addressToString,
} from '@stacks/transactions';
import { getPgPool, sql } from './db';

export interface GasConfig {
  baseGas: bigint;
  incrementRate: bigint;
  gasCap: bigint;
}

export class UnsupportedOperation extends Error {
  constructor(msg: string) {
    super(msg);
  }
}

export async function loadGasConfig(op: StacksTransaction): Promise<GasConfig> {
  const payload = op.payload;
  if (
    payload.payloadType !== PayloadType.ContractCall ||
    payload.type !== StacksMessageType.Payload
  ) {
    throw new UnsupportedOperation(
      `Payload type ${payload.payloadType} is not eligible for being sponsored`,
    );
  }
  const contractDeployer = addressToString(payload.contractAddress);
  const contractName = payload.contractName.content;
  const functionName = payload.functionName.content;
  const pgPool = await getPgPool();
  const gasConfig = await pgPool.maybeOne(
    sql.typeAlias('GasConfig')`SELECT * FROM "public"."gas_config"
      WHERE deployer_address = ${contractDeployer}
        AND contract_name = ${contractName}
        AND function_name = ${functionName}`,
  );
  if (gasConfig == null) {
    throw new UnsupportedOperation(
      `Contract call ${contractDeployer}.${payload.contractName.content}::${payload.functionName.content} is not eligible for being sponsored`,
    );
  }
  return {
    baseGas: gasConfig.base_gas,
    gasCap: gasConfig.gas_cap,
    incrementRate: gasConfig.increment_rate,
  };
}
