import * as dotenv from "dotenv";
import { ImportableWallets, getSigningWallet } from "@stakekit/signers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { get, patch, post } from "../utils/requests";

dotenv.config();

async function main() {
  let additionalAddresses = {};
  let validatorAddress: string;

  const {data} = await get(`/v1/yields/enabled`);
  
  const { integrationId }: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "integrationId",
    message: "Choose the integration ID you would like to test: ",
    choices: data.map((integration: { id: string }) => integration.id),
  });


  const { action }: any = await Enquirer.prompt({
    type: "select",
    name: "action",
    message: "What ation would you like to perform?",
    choices: ['enter', 'exit'],
  });

  const config = await get(`/v1/yields/${integrationId}`);

  const walletOptions = {
    mnemonic: process.env.MNEMONIC,
    walletType: ImportableWallets.Omni,
    index: 0,
  };

  const wallet = await getSigningWallet(config.token.network, walletOptions);
  const address = await wallet.getAddress();


  if (config.args[action]?.addresses.additionalAddresses) {
    additionalAddresses = await wallet.getAdditionalAddresses();
  }

  console.log("=== Configuration === ");
  console.log("ID:", config.id);
  console.log(`APY: ${((config.apy || 1) * 100).toFixed(2)}%`);
  console.log(`Token: ${config.token.symbol} on ${config.token.network}`);
  console.log("=== Configuration end === ");

  const [balance] = await Promise.all([
    post(`/v1/tokens/balances`, {
      addresses: [
        {
          network: config.token.network,
          address,
          tokenAddress: config.token.address,
        },
      ],
    }),
  ]);

  const stakedBalance = await post(`/v1/yields/${integrationId}/balances`, {
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
    message: `How much would you like to ${action === 'enter' ? 'stake': 'unstake'}`,
  });

  const args = {
    amount: amount,
  };

  if (config.args[action]?.args.validatorAddress) {
    const { validatorAddress }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddress",
      message:
        "To which validator would you like to stake to?",
    });
    Object.assign(args, {
      validatorAddress: validatorAddress,
    });
    }

  if (config.args[action]?.args.validatorAddresses) {
    const { validatorAddresses }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddresses",
      message:
        "To which validator addresses would you like to stake to? (Separated by comma)",
    });
    Object.assign(args, {
      validatorAddresses: validatorAddresses.split(","),
    });
  }

  if (config.args[action]?.args.tronResource) {
    const { tronResource }: any = await Enquirer.prompt({
        type: "select",
       name: "tronResource",
        message: "Which resource would you like to freeze?",
        choices: ['ENERGY', 'BANDWIDTH'],
    });
    Object.assign(args, {
      tronResource: tronResource
    });
  }

  const session = await post(`/v1/actions/${action}`, {
    integrationId: integrationId,
    addresses: {
      address: address,
      additionalAddresses: additionalAddresses,
    },
    args,
  });

  let lastTx = null;
  for (const partialTx of session.transactions) {
    const transactionId = partialTx.id;

    if (partialTx.status === "SKIPPED") {
      continue;
    }

    while (true) {
      if (lastTx !== null && lastTx.network !== partialTx.network) {
        const stakedBalances = await post(`/v1/yields/${integrationId}/balances`, {
          addresses: { address, additionalAddresses },
          args: { validatorAddresses: [validatorAddress] },
        });

     const locked = stakedBalances.find((balance) => balance.type === 'locked')

        if(locked.amount >= session.amount) {
          console.log('Locked amount available')
          break
        } else {
          console.log("Waiting for funds to arrive in destination chain...");
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } else {
        console.log('breaking')
        break;
      }
    }

    console.log(
      `Action ${++partialTx.stepIndex} out of ${session.transactions.length} ${partialTx.type
      }`
    );

    const gas = await get(`/v1/transactions/gas/${config.token.network}`)

    let gasArgs = {};
    if (gas.customisable !== false) {
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

    const unsignedTransaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);
    console.log(JSON.stringify(unsignedTransaction));

    
    const signingWallet = await getSigningWallet(
      unsignedTransaction.network,
      walletOptions
    );

    const signed = await signingWallet.signTransaction(
      unsignedTransaction.unsignedTransaction
    );

    const result = await post(`/v1/transactions/${transactionId}/submit`, {
      signedTransaction: signed,
    });

    lastTx = { network: unsignedTransaction.network, result: result };
    console.log(JSON.stringify(lastTx));

    while (true) {
      const result = await get(`/v1/transactions/${transactionId}/status`);

      console.log(result.status);
      if (result.status === "CONFIRMED") {
        console.log(result.url);
        break;
      } else if (result.status === "FAILED") {
        console.log("TRANSACTION FAILED");
        break;
      } else {
        console.log("Pending...");
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
