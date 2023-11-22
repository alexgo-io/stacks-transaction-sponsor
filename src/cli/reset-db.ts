import { sql } from 'slonik';
import { kStacksNetworkType } from 'src/config';
import { getPgPool } from '../db';

async function main() {
  if (kStacksNetworkType === 'mainnet') {
    console.log(`This script is not for mainnet`);
    return;
  }
  const pgPool = await getPgPool();
  await pgPool.query(sql.unsafe`TRUNCATE TABLE "public"."user_operations"`);
  await pgPool.query(sql.unsafe`TRUNCATE TABLE "public"."sponsor_records"`);
}

main().catch(console.error);
