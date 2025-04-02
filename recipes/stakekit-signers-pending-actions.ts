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

// Store the selected integration ID
let selectedIntegrationId = '';

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
      choices: data.map((integration: { id: string; name: string; apy: number; token: { symbol: string }}) => ({
        name: `${integration.name || integration.id} (${integration.token.symbol}) - APY: ${((integration.apy || 1) * 100).toFixed(2)}%`,
        value: integration.id
      })),
    });
    
    // Store integration ID globally for later use
    selectedIntegrationId = integrationId;
    
    // Find selected integration data
    const selectedIntegration = data.find(integration => integration.id === integrationId);
    if (!selectedIntegration) {
      console.error("Selected integration not found");
      return;
    }

    // For certain advanced options, we need the full configuration
    const config = await get(`/v1/yields/${integrationId}`);

    // Initialize wallet
    const walletOptions = {
      mnemonic: process.env.MNEMONIC,
      walletType: ImportableWallets.Omni,
      index: 0,
    };

    // Get wallet for the specific network
    console.log(`Initializing wallet for ${selectedIntegration.token.network}...`);
    const wallet = await getSigningWallet(selectedIntegration.token.network, walletOptions);
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
    await collectRequiredArguments(request, args, stakedBalances);

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
        console.log(`Skipping step ${partialTx.stepIndex + 1}: ${partialTx.type}`);
        continue;
      }
      
      console.log(`Processing step ${partialTx.stepIndex + 1} of ${pendingActionSession.transactions.length}: ${partialTx.type}`);

      // Get gas price options
      const gas = await get(`/v1/transactions/gas/${partialTx.network || selectedIntegration.token.network}`);
      
      // Select gas mode if customizable
      let gasArgs = {};
      if (gas.customisable !== false) {
        console.log("Available gas modes:", JSON.stringify(gas.modes, null, 2));

        const { gasMode }: any = await Enquirer.prompt({
          type: "select",
          name: "gasMode",
          message: `Which gas mode would you like to use (${gas.modes?.denom || 'default'})?`,
          choices: [...(gas.modes?.values || []), { name: "custom" }].map((g) => {
            return { message: g.name, name: g };
          }),
        });

        if (gasMode.name === "custom") {
          console.log("Custom gas mode not supported for now.");
          continue;
        } else {
          gasArgs = gasMode.gasArgs;
        }
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
      while (true) {
        const statusResult = await get(`/v1/transactions/${transactionId}/status`).catch(() => null);

        if (statusResult && statusResult.status === "CONFIRMED") {
          console.log("Transaction confirmed!");
          console.log("Explorer URL:", statusResult.url);
          break;
        } else if (statusResult && statusResult.status === "FAILED") {
          console.error("Transaction failed!");
          break;
        } else {
          process.stdout.write(".");
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
      
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
async function collectRequiredArguments(request, args, stakedBalances) {
  // Use the stored integration ID
  const integrationId = selectedIntegrationId;
  
  // Get validator address if required
  if (request.args && request.args.args?.validatorAddress?.required) {
    // Fetch available validators
    const validatorsData = await get(`/v2/yields/${integrationId}/validators`);
    
    if (validatorsData && validatorsData.length > 0 && validatorsData[0].validators?.length > 0) {
      const validators = validatorsData[0].validators;
      
      // Format validators for selection
      const validatorChoices = validators.map(validator => ({
        name: `${validator.name || validator.address} (${validator.status}) - APR: ${validator.apr ? (validator.apr * 100).toFixed(2) + '%' : 'N/A'}`,
        value: validator.address
      }));
      
      // Ask user to select a validator
      const { selectedValidator }: any = await Enquirer.prompt({
        type: "autocomplete",
        name: "selectedValidator",
        message: `Select a validator:`,
        choices: validatorChoices,
      });
      
      args.validatorAddress = selectedValidator;
    }
  }
  
  // Get validator addresses if required
  if (request.args && request.args.args?.validatorAddresses?.required) {
    // Fetch available validators
    const validatorsData = await get(`/v2/yields/${integrationId}/validators`);
    
    if (validatorsData && validatorsData.length > 0 && validatorsData[0].validators?.length > 0) {
      const validators = validatorsData[0].validators;
      
      // Format validators for selection
      const validatorChoices = validators.map(validator => ({
        name: `${validator.name || validator.address} (${validator.status}) - APR: ${validator.apr ? (validator.apr * 100).toFixed(2) + '%' : 'N/A'}`,
        value: validator.address
      }));
      
      // Ask user to select a single validator
      const { selectedValidator }: any = await Enquirer.prompt({
        type: "autocomplete",
        name: "selectedValidator",
        message: "Select a validator:",
        choices: validatorChoices,
      });
      
      // Use an array with a single validator
      args.validatorAddresses = [selectedValidator];
    }
  }
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
