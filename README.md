# Stacks Transaction Sponsor

This is a service to sponsor Stacks transactions on users' behalf. 

## Overview

The service provides an API `/execute` that accepts a serialized sponsored Stacks transaction hex string. It will verify the transaction, and submit it to the Stacks blockchain using one of the sponsor accounts configured.

The service tracks the status of all pending and submitted transactions in a PostgreSQL database, and handles re-submitting transactions using replace-by-fee (RBF) if they are not settled after certain blocks.

## Services

- `src/main.ts` - Starts up the Express server, worker process and health/status check endpoints
- `src/execute.ts` - Handles `/execute` API requests 
- `src/submit-transactions.ts` - Submits pending transactions from DB 
- `src/sync-transactions.ts` - Syncs status of submitted transactions
- `src/rbf-transactions.ts` - Replaces submitted transactions using RBF if needed
- `src/worker.ts` - Background worker that runs the sync and RBF transactions process  

## Configuration

The service is configured via environment variables:

- `STACKS_API_URL` - Stacks API endpoint 
- `STACKS_NETWORK_TYPE` - Either `mainnet` or `mocknet`
- `SPONSOR_ACCOUNT_ADDRESS` - Sponsor account address
- `SPONSOR_ACCOUNT_SECRETKEY` - Sponsor account secret key
- `POSTGRES_*` - PostgreSQL connection config

## Database Models

The `user_operations` table tracks pending and submitted user transactions.

The `sponsor_records` table tracks info about all sponsored transactions submitted.

## Requirements

- Node.js
- PostgreSQL

## Running Locally

Configure environment variables:
`cp .env.example .env`

Start service:
`npm run dev`

