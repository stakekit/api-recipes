import * as dotenv from "dotenv";
import { Wallet } from "ethers";

import "cross-fetch/polyfill";
import Enquirer from 'enquirer';

dotenv.config();

const ENDPOINT = process.env.API_ENDPOINT;

export const post = async (path: string, data: object) =>
  fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
    body: JSON.stringify(data),
  }).then((res) => res.json());

export const patch = async (path: string, data: object) =>
  fetch(`${ENDPOINT}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
    body: JSON.stringify(data),
  }).then((res) => res.json());

export const get = async (path: string) =>
  fetch(`${ENDPOINT}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
  }).then((res) => res.json());

async function main() {
  try {
    let additionalAddresses = {};
    const wallet = Wallet.fromPhrase(process.env.MNEMONIC);
    const address = await wallet.getAddress();

    const integrations = await get(`/v1/stake/opportunities`);

    const { integrationId }: any = await Enquirer.prompt({
      type: 'select',
      name: 'integrationId',
      message: 'Choose the integration ID you would like to test: ',
      choices: integrations.map((integration: { id: any; }) => integration.id)
    });

    const config = await get(`/v1/stake/opportunities/${integrationId}`);

    console.log(config);
    console.log("=== Configuration === ");
    console.log("ID:", config.id);
    console.log(`APY: ${((config.apy || 1) * 100).toFixed(2)}%`);
    console.log(`Token: ${config.token.symbol} on ${config.token.network}`);
    console.log("=== Configuration end === ");

    const [balance] = await Promise.all([
      post(`/v1/token/balances`, {
        addresses: [
          {
            network: config.token.network,
            address,
            tokenAddress: config.token.address,
          },
        ],
      }),
    ]);

    const stakedBalance = await post(`/v1/stake/balances/${integrationId}`, {
      address,
    });

    console.log("=== Balances ===");

    console.log("Available", config.token.symbol, balance[0].amount);
    console.log("Staked", stakedBalance);

    console.log("=== Balances end ===");

    const { amount }: any = await Enquirer.prompt({
      type: 'input',
      name: 'amount',
      message: 'How much would you like to stake?'
    });

    console.log(address);
    const enter = await post("/v1/stake/enter", {
      integrationId: integrationId,
      addresses: {
        address: address,
        additionalAddresses: additionalAddresses,
      },
      arguments: {
        amount: amount,
      },
    });

    console.log(enter);

    let lastTx = null;
    for (const partialTx of enter.transactions) {
      const transactionId = partialTx.id;

      if (partialTx.status === 'SKIPPED') {
        continue;
      }
      console.log(
        `Action ${++partialTx.stepIndex} out of ${enter.transactions.length} ${
          partialTx.type
        }`
      );

      const gas = await get(`/v1/transaction/gas/${config.token.network}`);
      console.log(JSON.stringify(gas));

      let gasArgs = {};
      const { gasMode }: any = await Enquirer.prompt({
        type: 'select',
        name: 'gasMode',
        message: `Which gas mode would you like to execute with (${gas.modes.denom})?`,
        choices: [...gas.modes.values, { name: "custom" }].map((g) => {
          return {message: g.name, name: g};
        })
      });

      if (gasMode.name === "custom") {
        console.log('Custom gas mode not supported for now.');
        throw null;
        // const opts = { gasMode: gasMode.name, gasArgs: {} };
        // for (let i = 0; i < gas.suggestedValues.length; i++) {
        //   const { name, recommendValue, units } = gas.suggestedValues[i];
        //   const { input }: any = await Enquirer.prompt({
        //     type: 'input',
        //     name: 'input',
        //     message: `Input ${name} (${units})`,
        //     initial: recommendValue,
        //   });
        //   opts.gasArgs[name] = input;
        // }
        // gasArgs = opts;
      } else {
        gasArgs = gasMode.gasArgs;
      }

      console.log(JSON.stringify(gasArgs));

      const transaction = await patch(`/v1/transaction/${transactionId}`, {
        gasArgs,
      });
      console.log(JSON.stringify(transaction));

      const signed = await wallet.signTransaction(
        JSON.parse(transaction.unsignedTransaction)
      );

      const result = await post(`/v1/transaction/${transactionId}/submit`, {
        signedTransaction: signed,
      });

      lastTx = { network: transaction.network, result: result };
      console.log(JSON.stringify(lastTx));

      while (true) {
        const result = await get(
          `/v1/transaction/${transactionId}/status`
        );

        console.log(result.status);
        if (result.status === "CONFIRMED") {
          console.log(result.url);
          break;
        } else if(result.status === "FAILED") {
          console.log('TRANSACTION FAILED');
          break;
        } else {
          console.log("Pending...");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  } catch (error) {
    if (error) {
      console.log('Script failed');
      console.log(error);
    } else {
      console.log('Script was aborted.')
    }
  }
}

main();