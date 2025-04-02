/**
 * StakeKit API Recipe: Managing Pending Actions with @stakekit/signers
 * 
 * This example demonstrates how to use the StakeKit API to find and execute
 * pending actions on staked assets, such as claim rewards or exit staking.
 */

import * as dotenv from "dotenv";
import { ImportableWallets, getSigningWallet } from "@stakekit/signers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { get, patch, post } from "../utils/requests";

// Load environment variables
dotenv.config();

// Check for required environment variables
if (!process.env.MNEMONIC) {
  console.error("Error: MNEMONIC environment variable is required");
  process.exit(1);
}

if (!process.env.API_KEY) {
  console.error("Error: API_KEY environment variable is required");
  process.exit(1);
}

/**
 * Main execution function
 */
async function main() {
  try {
    // Get available integrations
    const { data } = await get(`/v1/yields/enabled`);
    
    if (!data || data.length === 0) {
      console.error("No enabled yield integrations found");
      return;
    }

    // Select integration
    const { integrationId }: any = await Enquirer.prompt({
      type: "autocomplete",
      name: "integrationId",
      message: "Choose the integration ID you would like to test: ",
      choices: data.map((integration: { id: string }) => integration.id),
    });

    // Get integration configuration
    const config = await get(`/v1/yields/${integrationId}`);

    // Initialize wallet
    const walletOptions = {
      mnemonic: process.env.MNEMONIC,
      walletType: ImportableWallets.Omni,
      index: 0,
    };

    // Get wallet for the specific network
    console.log(`Initializing wallet for ${config.token.network}...`);
    const wallet = await getSigningWallet(config.token.network, walletOptions);
    const address = await wallet.getAddress();
    console.log(`Wallet address: ${address}`);

    // Get additional addresses if needed by the integration
    let additionalAddresses = {};
    if (config.args.enter?.addresses.additionalAddresses) {
      console.log("Getting additional addresses required by the integration...");
      additionalAddresses = await wallet.getAdditionalAddresses();
    }

    // Get staked balances with pending actions
    console.log(`\nRetrieving staked balances for ${integrationId}...`);
    const stakedBalances = await post(`/v1/yields/${integrationId}/balances`, {
      addresses: { address, additionalAddresses }
    });

    console.log("\n=== Staked Balances and Pending Actions ===");
    console.log(JSON.stringify(stakedBalances, null, 2));
    console.log("=== End of Staked Balances ===\n");

    // Extract pending actions from balances
    const pendingActionChoices = stakedBalances
      .map((balance) => {
        return balance.pendingActions?.map((action) => {
          return {
            name: `${action.type} - Balance: ${balance.amount} (${balance.type})`,
            value: JSON.stringify(action),
          };
        }) || [];
      })
      .flat();

    if (pendingActionChoices.length === 0) {
      console.error(`No pending actions available on integration ${integrationId}.`);
      console.log("You may need to stake first or wait for actions to become available.");
      return;
    }

    // Select a pending action to execute
    console.log(`Found ${pendingActionChoices.length} pending actions.`);
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

    // Parse the selected action
    const request = JSON.parse(choice);
    console.log(`\nSelected action: ${request.type}`);

    // Prepare arguments for the pending action
    const args = {};
    await collectRequiredArguments(request, args);

    // Create pending action session
    console.log("\nCreating pending action session...");
    const pendingActionSession = await post("/v1/actions/pending", {
      integrationId: integrationId,
      type: request.type,
      passthrough: request.passthrough,
      args: args,
    });

    console.log(`Processing pending action with ${pendingActionSession.transactions.length} transactions...\n`);

    // Process transactions
    let lastTx = null;
    for (const partialTx of pendingActionSession.transactions) {
      const transactionId = partialTx.id;

      if (partialTx.status === "SKIPPED") {
        console.log(`Skipping step ${partialTx.stepIndex}: ${partialTx.type}`);
        continue;
      }
      
      console.log(`Processing step ${partialTx.stepIndex} of ${pendingActionSession.transactions.length}: ${partialTx.type}`);

      // Get gas price options
      const gas = await get(`/v1/transactions/gas/${partialTx.network || config.token.network}`);
      
      // Select gas mode if customizable
      let gasArgs = {};
      if (gas.customisable !== false) {
        gasArgs = await selectGasMode(gas);
      }

      // Prepare transaction
      console.log("Preparing transaction...");
      const transaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);

      // Get network-specific wallet for signing
      const signingWallet = await getSigningWallet(
        transaction.network,
        walletOptions
      );

      // Sign transaction
      console.log("Signing transaction...");
      const signed = await signingWallet.signTransaction(
        transaction.unsignedTransaction
      );

      // Submit transaction
      console.log("Submitting transaction...");
      const result = await post(`/v1/transactions/${transactionId}/submit`, { 
        signedTransaction: signed 
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      lastTx = { network: transaction.network, result: result };
      console.log("Transaction submitted:", JSON.stringify(lastTx, null, 2));

      // Wait for transaction confirmation
      console.log("Waiting for transaction confirmation...");
      await waitForTransactionConfirmation(transactionId);
      
      console.log("\n");
    }
    
    console.log("Pending action completed successfully!");
    
  } catch (error) {
    console.error("Error executing pending action:", error);
  }
}

/**
 * Collects additional arguments required by the pending action
 */
async function collectRequiredArguments(request, args) {
  // Get validator addresses if required
  if (request.args && request.args.args?.validatorAddresses) {
    const { validatorAddresses }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddresses",
      message: "To which validator addresses would you perform the action to? (Separated by comma)",
    });
    args.validatorAddresses = validatorAddresses.split(",");
  }

  // Get validator address if required
  if (request.args && request.args.args?.validatorAddress) {
    const { validatorAddress }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddress",
      message: "To which validator address would you like perform the action to?",
    });
    args.validatorAddress = validatorAddress;
  }
}

/**
 * Prompts for gas mode selection
 */
async function selectGasMode(gas) {
  console.log("Available gas modes:", JSON.stringify(gas.modes, null, 2));

  const { gasMode }: any = await Enquirer.prompt({
    type: "select",
    name: "gasMode",
    message: `Which gas mode would you like to execute with (${gas.modes?.denom || 'default'})?`,
    choices: [...(gas.modes?.values || []), { name: "custom" }].map((g) => {
      return { message: g.name, name: g };
    }),
  });

  if (gasMode.name === "custom") {
    console.log("Custom gas mode not supported for now.");
    throw new Error("Custom gas mode not supported");
  }
  
  return gasMode.gasArgs;
}

/**
 * Waits for transaction confirmation
 */
async function waitForTransactionConfirmation(transactionId) {
  while (true) {
    const result = await get(`/v1/transactions/${transactionId}/status`).catch(() => null);

    if (result && result.status === "CONFIRMED") {
      console.log("Transaction confirmed!");
      console.log("Explorer URL:", result.url);
      break;
    } else if (result && result.status === "FAILED") {
      console.error("Transaction failed!");
      break;
    } else {
      process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  console.log("\n");
}

// Execute main function
try {
  main();
} catch (error) {
  if (error) {
    console.error("Script failed with error:", error);
  } else {
    console.log("Script was aborted.");
  }
}
