import * as dotenv from "dotenv";
import { ImportableWallets, getSigningWallet } from "@stakekit/signers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { get, patch, post } from "../utils/requests";

dotenv.config();

async function main() {
  let additionalAddresses = {};
  let validatorAddress: string;
  const integrations = await get(`/v1/stake/opportunities`);

  const { integrationId }: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "integrationId",
    message: "Choose the integration ID you would like to test: ",
    choices: integrations.map((integration: { id: string }) => integration.id),
  });

  const config = await get(`/v1/stake/opportunities/${integrationId}`);

  const walletoptions = {
    mnemonic: process.env.MNEMONIC,
    walletType: ImportableWallets.MetaMask,
    index: 0,
  };

  const wallet = await getSigningWallet(config.token.network, walletoptions);
  const address = await wallet.getAddress();

  if (config.args.enter.addresses.additionalAddresses) {
    additionalAddresses = await wallet.getAdditionalAddresses();
  }

  if (config.args.enter.args.validatorAddress) {
    validatorAddress = config.config.defaultValidator;
  }

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
    addresses: { address, additionalAddresses },
    args: { validatorAddresses: [validatorAddress] },
  });

  console.log("=== Balances ===");

  console.log("Available", config.token.symbol, balance[0].amount);
  console.log("Staked", stakedBalance);

  console.log("=== Balances end ===");

  const { amount }: any = await Enquirer.prompt({
    type: "input",
    name: "amount",
    message: "How much would you like to stake?",
  });

  const enter = await post("/v1/stake/enter", {
    integrationId: integrationId,
    addresses: {
      address: address,
      additionalAddresses: additionalAddresses,
    },
    args: {
      amount: amount,
    },
  });

  let lastTx = null;
  for (const partialTx of enter.transactions) {
    const transactionId = partialTx.id;

    if (partialTx.status === "SKIPPED") {
      continue;
    }
    console.log(
      `Action ${++partialTx.stepIndex} out of ${enter.transactions.length} ${partialTx.type
      }`
    );

    const gas = await get(`/v1/transaction/gas/${config.token.network}`)

    let gasArgs = {};
    if (gas.code !== 404) {
      const gas = await get(`/v1/transaction/gas/${config.token.network}`);
      console.log(JSON.stringify(gas));

      const { gasMode }: any = await Enquirer.prompt({
        type: "select",
        name: "gasMode",
        message: `Which gas mode would you like to execute with (${gas.modes.denom})?`,
        choices: [...gas.modes.values, { name: "custom" }].map((g) => {
          return { message: g.name, name: g };
        }),
      });

      if (gasMode.name === "custom") {
        console.log("Custom gas mode not supported for now.");
        throw null;
      } else {
        gasArgs = gasMode.gasArgs;
      }
    }

    const transaction = await patch(`/v1/transaction/${transactionId}`, {
      gasArgs,
    });
    console.log(JSON.stringify(transaction));

    const signed = await wallet.signTransaction(
      transaction.unsignedTransaction
    );

    const result = await post(`/v1/transaction/${transactionId}/submit`, {
      signedTransaction: signed,
    });

    lastTx = { network: transaction.network, result: result };
    console.log(JSON.stringify(lastTx));

    while (true) {
      const result = await get(`/v1/transaction/${transactionId}/status`);

      console.log(result.status);
      if (result.status === "CONFIRMED") {
        console.log(result.url);
        break;
      } else if (result.status === "FAILED") {
        console.log("TRANSACTION FAILED");
        break;
      } else {
        console.log("Pending...");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}

try {
  main();
} catch (error) {
  if (error) {
    console.log("Script failed");
    console.log(error);
  } else {
    console.log("Script was aborted.");
  }
}
