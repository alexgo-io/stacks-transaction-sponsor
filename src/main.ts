import cors from 'cors';
import express from 'express';
import memoizee from 'memoizee';
import { getAccountBalances } from 'ts-clarity';
import { getSponsorAccounts } from './accounts';
import { getOptionalEnv, kStacksEndpoint } from './config';
import { getPgPool, sql } from './db';
import { executeSponsorTransaction } from './execute';
import { startWorker, stopWorker } from './worker';

const isHealthy = memoizee(
  async () => {
    try {
      const pool = await getPgPool();
      const { c } = await pool.one(
        sql.typeAlias(
          'c',
        )`SELECT COUNT(*) as c FROM "public"."user_operations" WHERE status = 'pending'`,
      );
      return c >= 0n;
    } catch (e: unknown) {
      console.error('Health check failed with error', e);
      return false;
    }
  },
  {
    promise: true,
    maxAge: 10000,
  },
);

async function printAccounts() {
  const accounts = getSponsorAccounts();
  const balances = await Promise.all(
    accounts.map(async account => {
      return await getAccountBalances(account.address, {
        stacksEndpoint: kStacksEndpoint,
      });
    }),
  );
  accounts.forEach((account, i) => {
    console.log(
      `Account #${i + 1} ${account.address} STX balance: ${(
        Number(balances[i].stx.balance) / 1e6
      ).toFixed(3)}`,
    );
  });
}

async function main() {
  await printAccounts();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(cors());
  app.post('/execute', executeSponsorTransaction);
  app.get('/healthz', async (_, res) => {
    if (await isHealthy()) {
      res.end('OK');
    } else {
      res.status(503).end('Sponsor service unavailable.');
    }
  });
  app.get('/status', async (_, res) => {
    res.json({
      status: getOptionalEnv('SPONSOR_SERVICE_STATUS') ?? 'ok',
    });
  });
  const port = Number(process.env.STACKS_TRANSACTION_SPONSOR_PORT ?? 2980);

  console.log('Starting server and worker');
  const server = app.listen(port, '::', () => {
    console.log(`Stacks transaction sponsor executor serving at :${port}`);
  });

  process.on('uncaughtException', err => {
    console.error('Uncaught error:', err);
  });
  process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err);
  });
  startWorker();
  try {
    return await new Promise<void>(f => {
      process.once('SIGINT', () => {
        console.log('User interrupted.');
        f();
      });
    });
  } finally {
    console.log('Closing server and stopping worker');
    server.close();
    stopWorker();
  }
}

main().catch(console.error);
