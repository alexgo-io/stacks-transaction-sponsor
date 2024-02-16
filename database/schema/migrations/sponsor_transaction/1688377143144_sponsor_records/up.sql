CREATE TABLE "public"."sponsor_records" (
  "id" BIGSERIAL PRIMARY KEY,
  "tx_id" BYTEA NOT NULL,
  "raw_tx" BYTEA NOT NULL,
  "sender" VARCHAR NOT NULL,
  "nonce" INTEGER NOT NULL,
  "contract_address" VARCHAR NOT NULL,
  "function_name" VARCHAR NOT NULL,
  "args" JSONB NOT NULL,
  "sponsor" VARCHAR NOT NULL,
  "sponsor_tx_id" BYTEA NOT NULL,
  "sponsor_nonce" INTEGER NOT NULL,
  "submit_block_height" INTEGER NOT NULL,
  "fee" INTEGER NOT NULL,
  "status" VARCHAR NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX "idx_sponsor_records_tx_id" ON "public"."sponsor_records" USING BTREE ("tx_id");

CREATE INDEX "idx_sponsor_records_sponsor_nonce" ON "public"."sponsor_records" USING BTREE ("sponsor", "sponsor_nonce");
