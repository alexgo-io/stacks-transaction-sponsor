import {
  createDateTypeParser,
  createIntervalTypeParser,
  createNumericTypeParser,
  createPool,
  createSqlTag,
  createTimestampTypeParser,
  createTimestampWithTimeZoneTypeParser,
  DatabasePool,
} from 'slonik';
import z from 'zod';
import { getRequiredEnv } from './config';
import {
  createByteaTypeParser,
  createFloat4TypeParser,
  createFloat8TypeParser,
  createInt4TypeParser,
  createInt8TypeParser,
} from './parsers';

const pgPool: Promise<DatabasePool> = createPool(
  `postgres://${getRequiredEnv('POSTGRES_USER')}:${getRequiredEnv(
    'POSTGRES_PASSWORD',
  )}@127.0.0.1:${getRequiredEnv('POSTGRES_PORT')}/${getRequiredEnv(
    'POSTGRES_DATABASE',
  )}`,
  {
    typeParsers: [
      // - customized type parsers
      createInt4TypeParser(),
      createInt8TypeParser(),
      createNumericTypeParser(),
      createFloat4TypeParser(),
      createFloat8TypeParser(),
      createByteaTypeParser(),

      // - default type parsers
      createDateTypeParser(),
      createIntervalTypeParser(),
      createTimestampTypeParser(),
      createTimestampWithTimeZoneTypeParser(),
    ],
  },
);
pgPool.catch(e => {
  console.error(`Fail to create pg pool, error: ${e.stacks || e}`);
  process.exit(1);
});

export async function getPgPool() {
  return pgPool;
}

export const UserOperation = z.object({
  id: z.bigint(),
  tx_id: z.instanceof(Buffer),
  raw_tx: z.instanceof(Buffer),
  sender: z.string(),
  nonce: z.bigint(),
  contract_address: z.string(),
  function_name: z.string(),
  args: z.array(z.any()),
  sponsor: z.optional(z.string()),
  sponsor_tx_id: z.optional(z.instanceof(Buffer)),
  sponsor_nonce: z.optional(z.bigint()),
  submit_block_height: z.optional(z.bigint()),
  fee: z.bigint(),
  status: z.enum(['pending', 'submitted', 'failed', 'success']),
  error: z.optional(z.string()),
  created_at: z.date(),
  updated_at: z.date(),
});

export const GasConfig = z.object({
  id: z.bigint(),
  deployer_address: z.string(),
  contract_name: z.string(),
  function_name: z.string(),
  estimate_gas: z.boolean(),
  base_gas: z.bigint(),
  increment_rate: z.bigint(),
  gas_cap: z.bigint(),
  created_at: z.date(),
  updated_at: z.date(),
});

export const sql = createSqlTag({
  typeAliases: {
    id: z.object({
      id: z.bigint(),
    }),
    c: z.object({
      c: z.bigint(),
    }),
    void: z.object({}).strict(),
    UserOperation,
    GasConfig,
  },
});
