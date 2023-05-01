import * as dotenv from "dotenv";
import { ImportableWallets, getSigningWallet } from "@stakekit/signers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { get, patch, post } from "../utils/requests";

dotenv.config();

async function main() {
  let additionalAddresses = {};
  let validatorAddress;

  const integrationId = "ethereum-matic-native-staking";

  const config = await get(`/v1/stake/opportunities/${integrationId}`);

  const walletoptions = {
    mnemonic: process.env.MNEMONIC,
    walletType: ImportableWallets.Steakwallet,
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

  const stakedBalances = await post(`/v1/stake/balances/${integrationId}`, {
    addresses: { address, additionalAddresses },
    args: { validatorAddresses: [validatorAddress] },
  });

  console.log("=== Pending Actions ===");

  console.log(stakedBalances);

  const { pendingAction }: any = await Enquirer.prompt({
    type: "select",
    name: "pendingAction",
    message: `Which pending action would you like to execute?`,
    choices: stakedBalances
      .map((balance) => {
        return balance.pendingActions.map((action) => {
          return JSON.stringify({
            type: balance.type,
            balance: balance.amount,
            action: action,
          });
        });
      })
      .flat(),
  });

  const request = JSON.parse(pendingAction).action;

  console.log(request.passthrough);
  const pendingActionSession = await post("/v1/stake/pending_action", {
    integrationId: integrationId,
    ...request,
  });

  console.log(pendingActionSession);

  let lastTx = null;
  for (const partialTx of pendingActionSession.transactions) {
    const transactionId = partialTx.id;

    if (partialTx.status === "SKIPPED") {
      continue;
    }
    console.log(
      `Action ${++partialTx.stepIndex} out of ${
        pendingActionSession.transactions.length
      } ${partialTx.type}`
    );

    const gas = await get(`/v1/transaction/gas/${config.token.network}`);
    console.log(JSON.stringify(gas));

    let gasArgs = {};
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
