CREATE TABLE "public"."user_operations" (
  "id" BIGSERIAL PRIMARY KEY,
  "tx_id" BYTEA NOT NULL,
  "raw_tx" BYTEA NOT NULL,
  "sender" VARCHAR NOT NULL,
  "nonce" INTEGER NOT NULL,
  "contract_address" VARCHAR NOT NULL,
  "function_name" VARCHAR NOT NULL,
  "args" JSONB NOT NULL,
  "sponsor" VARCHAR,
  "sponsor_tx_id" BYTEA,
  "sponsor_nonce" INTEGER,
  "submit_block_height" INTEGER,
  "fee" INTEGER NOT NULL,
  "status" VARCHAR NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX "idx_user_operations_sponsor_nonce" ON "public"."user_operations" USING BTREE ("sponsor", "sponsor_nonce");

CREATE INDEX "idx_user_operations_status_sponsor" ON "public"."user_operations" USING BTREE ("status", "sponsor");

CREATE INDEX "idx_user_operations_sender_nonce" ON "public"."user_operations" USING BTREE ("sender", "nonce");

CREATE INDEX "idx_user_operations_tx_id" ON "public"."user_operations" USING BTREE ("tx_id");
