import {
  createDateTypeParser,
  createIntervalTypeParser,
  createNumericTypeParser,
  createPool,
  createSqlTag,
  DatabasePool,
  PrimitiveValueExpression,
} from 'slonik';
import { fromUint8Array } from 'ts-clarity';
import z from 'zod';
import { getRequiredEnv } from './config';
import {
  createByteaTypeParser,
  createFloat4TypeParser,
  createFloat8TypeParser,
  createInt2TypeParser,
  createInt4TypeParser,
  createInt8TypeParser,
  createTimestampTypeParser,
  createTimestampWithTimeZoneTypeParser,
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
      createInt2TypeParser(),
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
  id: z.coerce.bigint(),
  tx_id: z.instanceof(Buffer),
  raw_tx: z.instanceof(Buffer),
  sender: z.string(),
  nonce: z.coerce.bigint(),
  contract_address: z.string(),
  function_name: z.string(),
  args: z.array(z.any()),
  sponsor: z.optional(z.string()),
  sponsor_tx_id: z.optional(z.instanceof(Buffer)),
  sponsor_nonce: z.optional(z.coerce.bigint()),
  submit_block_height: z.optional(z.coerce.bigint()),
  fee: z.coerce.bigint(),
  status: z.enum(['pending', 'submitted', 'failed', 'success']),
  error: z.nullable(z.string()),
  created_at: z.date(),
  updated_at: z.date(),
});
export type UserOperation = z.infer<typeof UserOperation>;

export const SponsorRecord = z.object({
  id: z.coerce.bigint(),
  tx_id: z.instanceof(Buffer),
  raw_tx: z.instanceof(Buffer),
  sender: z.string(),
  nonce: z.coerce.bigint(),
  contract_address: z.string(),
  function_name: z.string(),
  args: z.array(z.any()),
  sponsor: z.string(),
  sponsor_tx_id: z.instanceof(Buffer),
  sponsor_nonce: z.coerce.bigint(),
  submit_block_height: z.coerce.bigint(),
  fee: z.coerce.bigint(),
  status: z.enum(['pending', 'submitted', 'failed', 'success']),
  error: z.nullable(z.string()),
  created_at: z.date(),
  updated_at: z.date(),
});
export type SponsorRecord = z.infer<typeof SponsorRecord>;

export const GasConfig = z.object({
  id: z.coerce.bigint(),
  deployer_address: z.string(),
  contract_name: z.string(),
  function_name: z.string(),
  estimate_gas: z.boolean(),
  base_gas: z.coerce.bigint(),
  increment_rate: z.coerce.bigint(),
  gas_cap: z.coerce.bigint(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type GasConfig = z.infer<typeof GasConfig>;

const sqlTag = createSqlTag({
  typeAliases: {
    id: z.object({
      id: z.coerce.bigint(),
    }),
    c: z.object({
      c: z.coerce.bigint(),
    }),
    void: z.object({}).strict(),
    UserOperation,
    GasConfig,
  },
});

export const sql = Object.assign(sqlTag, {
  val(v: Date | Uint8Array | bigint) {
    if (typeof v === 'bigint') {
      return v.toString();
    }
    if (v instanceof Date) {
      return sqlTag.date(v);
    }
    if (Buffer.isBuffer(v)) {
      return sqlTag.binary(v);
    }
    if (v instanceof Uint8Array) {
      return sqlTag.binary(fromUint8Array(v));
    }
    throw new Error(`unsupported value: ${v}`);
  },
  hex(v: string) {
    let hex = v;
    if (v.startsWith('\\x') || v.startsWith('0x')) {
      hex = v.substring(2);
    }
    return sql.binary(Buffer.from(hex, 'hex'));
  },
  toPrimitive(v: PrimitiveValueExpression | Date): PrimitiveValueExpression {
    if (v instanceof Date) {
      return v.toISOString();
    }
    return v;
  },
  get void() {
    return sqlTag.typeAlias('void');
  },
});
