import * as dotenv from "dotenv";
import { ImportableWallets, getSigningWallet } from "@stakekit/signers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { get, patch, post } from "../utils/requests";

dotenv.config();

async function main() {
  let additionalAddresses = {};

  const { data } = await get(`/v1/yields/enabled`);

  const { integrationId }: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "integrationId",
    message: "Choose the integration ID you would like to test: ",
    choices: data.map((integration: { id: string }) => integration.id),
  });

  const config = await get(`/v1/yields/${integrationId}`);

  const walletOptions = {
    mnemonic: process.env.MNEMONIC,
    walletType: ImportableWallets.Omni,
    index: 0,
  };

  const wallet = await getSigningWallet(config.token.network, walletOptions);
  const address = await wallet.getAddress();

  if (config.args.enter.addresses.additionalAddresses) {
    additionalAddresses = await wallet.getAdditionalAddresses();
  }

  const stakedBalances = await post(`/v1/yields/${integrationId}/balances`, {
    addresses: { address, additionalAddresses }
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

  const args = {}

  if (request.args && request.args.args?.validatorAddresses) {
    const { validatorAddresses }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddresses",
      message:
        "To which validator addresses would you perform the action to? (Separated by comma)",
    });
    Object.assign(args, {
      validatorAddresses: validatorAddresses.split(","),
    });
  }

  if (request.args && request.args.args?.validatorAddress) {
    const { validatorAddress }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddress",
      message:
        "To which validator address would you like perform the action to?",
    });
    Object.assign(args, {
      validatorAddress: validatorAddress
    });
  }
  const pendingActionSession = await post("/v1/actions/pending", {
    integrationId: integrationId,
    type: request.type,
    passthrough: request.passthrough,
    args: args,
  });


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

    const gas = await get(`/v1/transactions/gas/${config.token.network}`);

    let gasArgs = {};
    if (gas.customisable !== false) {
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

    const transaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);


    const signingWallet = await getSigningWallet(
      transaction.network,
      walletOptions
    );

    const signed = await signingWallet.signTransaction(
      transaction.unsignedTransaction
    );

    const result = await post(`/v1/transactions/${transactionId}/submit`, { signedTransaction: signed, })

    lastTx = { network: transaction.network, result: result };
    console.log(JSON.stringify(lastTx));

    while (true) {
      const result = await get(`/v1/transactions/${transactionId}/status`).catch(() => null)
      console.log(result)
      if (result && result.status === "CONFIRMED") {
        console.log(result.url);
        break;
      } else if (result && result.status === "FAILED") {
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
