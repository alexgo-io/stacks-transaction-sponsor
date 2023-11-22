import { getPublicKeyFromPrivate } from '@stacks/encryption';
import { StacksMocknet } from '@stacks/network';
import {
  TransactionVersion,
  bufferCV,
  makeContractCall,
} from '@stacks/transactions';
import {
  generateSecretKey,
  generateWallet,
  getStxAddress,
} from '@stacks/wallet-sdk';
import got from 'got-cjs';
import { getRequiredEnv, kStacksEndpoint } from '../config';
import { stringify } from '../util';

async function main() {
  const mnemonic = generateSecretKey();
  const wallet = await generateWallet({
    secretKey: mnemonic,
    password: 'smoke',
  });
  const account = wallet.accounts[0];
  const senderKey = account.stxPrivateKey;
  const senderAddress = getStxAddress({
    account,
    transactionVersion: TransactionVersion.Testnet,
  });
  const publicKey = getPublicKeyFromPrivate(senderKey);
  console.log(
    `Using user address ${senderAddress}, mnemonic: "${mnemonic}", pubkey: ${publicKey}`,
  );
  const network = new StacksMocknet({ url: kStacksEndpoint });
  const tx = await makeContractCall({
    contractAddress: `${getRequiredEnv('DEPLOYER_ACCOUNT_ADDRESS')}`,
    contractName: 'stxdx-registry',
    functionName: 'register-user',
    functionArgs: [bufferCV(Buffer.from(publicKey, 'hex'))],
    senderKey,
    validateWithAbi: true,
    sponsored: true,
    anchorMode: 'any',
    nonce: 0,
    network,
  });

  const tx_bytes = tx.serialize();
  const tx_buffer = Buffer.from(
    tx_bytes,
    tx_bytes.byteOffset,
    tx_bytes.byteLength,
  );

  const rs = await got
    .post('https://sponsor-tx.alexgo.dev/v1/graphql', {
      json: {
        query: `mutation MyMutation {
        execute(tx: "${tx_buffer.toString('hex')}")
      }`,
        variables: null,
        operationName: 'MyMutation',
      },
    })
    .json();
  console.log(stringify(rs));
}

main().catch(console.error);
