CREATE TABLE "public"."gas_config" (
  "id" BIGSERIAL PRIMARY KEY,
  "deployer_address" VARCHAR NOT NULL,
  "contract_name" VARCHAR NOT NULL,
  "function_name" VARCHAR NOT NULL,
  "estimate_gas" BOOLEAN NOT NULL,
  "base_gas" INTEGER NOT NULL,
  "increment_rate" INTEGER NOT NULL,
  "gas_cap" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

INSERT INTO
  "public"."gas_config" (
    "deployer_address",
    "contract_name",
    "function_name",
    "estimate_gas",
    "base_gas",
    "increment_rate",
    "gas_cap",
    "created_at",
    "updated_at"
  )
VALUES
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'b20-bridge-endpoint-helper',
    'register-stxdx-and-request-peg-in',
    FALSE,
    10000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'b20-bridge-endpoint-helper',
    'register-and-request-peg-in',
    FALSE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'b20-bridge-endpoint',
    'request-peg-in',
    FALSE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'stxdx-registry',
    'register-user',
    FALSE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool-v1-1',
    'swap-helper',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool-v1-1',
    'swap-helper-a',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool-v1-1',
    'swap-helper-b',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool-v1-1',
    'swap-helper-c',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'swap-helper-bridged-v1-1',
    'swap-helper-from-amm',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'swap-helper-bridged-v1-1',
    'swap-helper-to-amm',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'swap-helper-v1-03',
    'swap-helper',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool',
    'swap-helper',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool',
    'swap-helper-a',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool',
    'swap-helper-b',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'amm-swap-pool',
    'swap-helper-c',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool-v1-1',
    'swap-helper',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool-v1-1',
    'swap-helper-a',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool-v1-1',
    'swap-helper-b',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool-v1-1',
    'swap-helper-c',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-swap-helper',
    'swap-helper-v1-03',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-swap-helper',
    'swap-helper-to-amm-v1-1',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-swap-helper',
    'swap-helper-from-amm-v1-1',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-swap-helper',
    'swap-helper-to-amm',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-swap-helper',
    'swap-helper-from-amm',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool',
    'swap-helper',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool',
    'swap-helper-a',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool',
    'swap-helper-b',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  ),
  (
    'ST1J2JTYXGRMZYNKE40GM87ZCACSPSSEEQVSNB7DC',
    'sponsored-amm-swap-pool',
    'swap-helper-c',
    TRUE,
    3000,
    10,
    100000,
    NOW(),
    NOW()
  );
