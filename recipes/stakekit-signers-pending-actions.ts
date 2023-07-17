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

  const walletOptions = {
    mnemonic: process.env.MNEMONIC,
    walletType: ImportableWallets.MetaMask,
    index: 0,
  };

  const wallet = await getSigningWallet(config.token.network, walletOptions);
  const address = await wallet.getAddress();

  console.log(address)
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

  const pendingActionChoices = stakedBalances
    .map((balance) => {
      return balance.pendingActions.map((action) => {
        return {
          name: `${action.type} - Balance: ${balance.amount} (${balance.type})`,
          value: JSON.stringify(action),
        };
      });
    })
    .flat();

  if (pendingActionChoices.length === 0) {
    console.error(
      `No pending actions available on that integration ${integrationId}.`
    );
    return;
  }


  const { choice }: any = await Enquirer.prompt({
    type: "select",
    name: "choice",
    message: `Which pending action would you like to execute?`,
    choices: pendingActionChoices,
    result(name) {
      return pendingActionChoices.find((choice) => choice.name === name)!
        .value;
    },
  });

  const request = JSON.parse(choice);

  console.log(request)
  const pendingActionSession = await post("/v1/stake/pending_action", {
    integrationId: integrationId,
    type: request.type,
    passthrough: request.passthrough,
    args: request.args?.args?.validatorAddress ? {
      validatorAddress: config.config.defaultValidator!
    } : {},
  });

  console.log(pendingActionSession)

  let lastTx = null;
  for (const partialTx of pendingActionSession.transactions) {
    const transactionId = partialTx.id;

    if (partialTx.status === "SKIPPED") {
      continue;
    }
    console.log(
      `Action ${++partialTx.stepIndex} out of ${pendingActionSession.transactions.length
      } ${partialTx.type}`
    );

    const gas = await get(`/v1/transaction/gas/${config.token.network}`)

    let gasArgs = {};
    if (gas.code !== 404) {
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

    const transaction = await patch(`/v1/transaction/${transactionId}`
      , gasArgs
    );


    const signingWallet = await getSigningWallet(
      transaction.network,
      walletOptions
    );

    const signed = await signingWallet.signTransaction(
      transaction.unsignedTransaction
    );

    const result = await post(`/v1/transaction/${transactionId}/submit`, {
      signedTransaction: signed,
    });

    lastTx = { network: transaction.network, result: result };
    console.log(JSON.stringify(lastTx));

    while (true) {
      const result = await get(`/v1/transaction/${transactionId}/status`);

      if (result.status === "CONFIRMED") {
        console.log(result.url);
        break;
      } else if (result.status === "FAILED") {
        console.log("TRANSACTION FAILED");
        break;
      } else {
        console.log("Pending...");
        await new Promise((resolve) => setTimeout(resolve, 3000));
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
