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
if (!process.env.MNEMONIC || !process.env.API_KEY) {
  console.error("Error: MNEMONIC and API_KEY environment variables are required");
  process.exit(1);
}

// Store the selected integration ID globally for validator lookup
let selectedIntegrationId = '';

/**
 * Main execution function
 */
async function main() {
  try {
    // Step 1: Get available staking integrations from StakeKit API
    const { data } = await get(`/v1/yields/enabled`);
    
    if (!data || data.length === 0) {
      console.error("No enabled yield integrations found");
      return;
    }

    // Step 2: Let user select an integration to check for pending actions
    const { integrationId }: any = await Enquirer.prompt({
      type: "autocomplete",
      name: "integrationId",
      message: "Choose the integration to check for pending actions: ",
      choices: data.map((integration: { id: string; name: string; apy: number; token: { symbol: string }}) => ({
        name: `${integration.name || integration.id} (${integration.token.symbol}) - APY: ${((integration.apy || 1) * 100).toFixed(2)}%`,
        value: integration.id
      })),
    });
    
    // Store integration ID globally
    selectedIntegrationId = integrationId;
    
    // Find selected integration data
    const selectedIntegration = data.find(integration => integration.id === integrationId);
    if (!selectedIntegration) {
      console.error("Selected integration not found");
      return;
    }

    // Step 3: Initialize wallet with @stakekit/signers
    const walletOptions = {
      mnemonic: process.env.MNEMONIC,
      walletType: ImportableWallets.Omni, // Universal wallet type
      index: 0,
    };

    // Get network-specific wallet
    console.log(`Initializing wallet for ${selectedIntegration.token.network}...`);
    const wallet = await getSigningWallet(selectedIntegration.token.network, walletOptions);
    const address = await wallet.getAddress();
    console.log(`Wallet address: ${address}`);

    // Step 4: Get additional addresses if needed by the integration
    let additionalAddresses = {};
    const config = await get(`/v1/yields/${integrationId}`);
    
    if (config.args.enter?.addresses.additionalAddresses) {
      console.log("Getting additional addresses required by the integration...");
      additionalAddresses = await wallet.getAdditionalAddresses();
    }

    // Step 5: Get staked balances and check for pending actions
    console.log(`\nRetrieving staked balances and pending actions for ${integrationId}...`);
    const stakedBalances = await post(`/v1/yields/${integrationId}/balances`, {
      addresses: { address, additionalAddresses }
    });

    // Extract pending actions from balances
    const pendingActionChoices = stakedBalances
      .map((balance) => {
        return balance.pendingActions?.map((action) => {
          return {
            name: `${action.type} - Balance: ${balance.amount} ${balance.token?.symbol || ''} (${balance.type})`,
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

    // Step 6: Let user select a pending action to execute
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

    // Step 7: Prepare arguments for the pending action
    const args = {};
    await collectRequiredArguments(request, args, stakedBalances);

    // Step 8: Create pending action session
    console.log("\nCreating pending action session...");
    const pendingActionSession = await post("/v1/actions/pending", {
      integrationId: integrationId,
      type: request.type,
      passthrough: request.passthrough,
      args: args,
    });

    console.log(`Processing pending action with ${pendingActionSession.transactions.length} transactions...\n`);

    // Step 9: Process each transaction in the session
    for (const partialTx of pendingActionSession.transactions) {
      const transactionId = partialTx.id;
      const currentNetwork = partialTx.network || selectedIntegration.token.network;

      if (partialTx.status === "SKIPPED") {
        console.log(`Skipping step ${partialTx.stepIndex + 1} of ${pendingActionSession.transactions.length}: ${partialTx.type}`);
        continue;
      }
      
      console.log(`Processing step ${partialTx.stepIndex + 1} of ${pendingActionSession.transactions.length}: ${partialTx.type}`);

      // Step 9.1: Get gas price options
      const gas = await get(`/v1/transactions/gas/${currentNetwork}`);
      
      // Step 9.2: Select gas mode if customizable
      let gasArgs = {};
      if (gas.customisable !== false) {
        const { gasMode }: any = await Enquirer.prompt({
          type: "select",
          name: "gasMode",
          message: `Which gas mode would you like to use?`,
          choices: gas.modes?.values.map(g => ({
            message: `${g.name} (${gas.modes?.denom || 'default'})`,
            name: g
          })) || [{ message: "default", name: { name: "default" } }],
        });

        if (gasMode.name !== "custom") {
          gasArgs = gasMode.gasArgs;
        }
      }

      // Step 9.3: Prepare transaction
      console.log("Preparing transaction...");
      const transaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);

      // Step 9.4: Get network-specific wallet for signing
      const signingWallet = await getSigningWallet(
        transaction.network,
        walletOptions
      );

      // Step 9.5: Sign transaction
      console.log("Signing transaction...");
      const signed = await signingWallet.signTransaction(
        transaction.unsignedTransaction
      );

      // Step 9.6: Submit transaction
      console.log("Submitting transaction...");
      const result = await post(`/v1/transactions/${transactionId}/submit`, { 
        signedTransaction: signed 
      });

      console.log("Transaction submitted:", JSON.stringify({
        network: transaction.network,
        txId: result.id
      }, null, 2));

      // Step 9.7: Wait for transaction confirmation
      console.log("Waiting for transaction confirmation...");
      let confirmed = false;
      
      while (!confirmed) {
        const statusResult = await get(`/v1/transactions/${transactionId}/status`).catch(() => null);

        if (statusResult && statusResult.status === "CONFIRMED") {
          console.log("Transaction confirmed!");
          console.log("Explorer URL:", statusResult.url);
          confirmed = true;
        } else if (statusResult && statusResult.status === "FAILED") {
          console.error("Transaction failed!");
          confirmed = true;
        } else {
          process.stdout.write(".");
          await new Promise(resolve => setTimeout(resolve, 2000));
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
    await addValidatorToArgs(args, 'validatorAddress');
  }
  
  // Get validator addresses if required
  if (request.args && request.args.args?.validatorAddresses?.required) {
    await addValidatorToArgs(args, 'validatorAddresses');
  }
}

/**
 * Helper function to add validator to arguments
 */
async function addValidatorToArgs(args, argName) {
  // Fetch available validators from correct endpoint
  const validatorsData = await get(`/v2/yields/${selectedIntegrationId}/validators`);
  
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
    
    // Add to args based on argument name
    if (argName === 'validatorAddresses') {
      args[argName] = [selectedValidator]; // Array for validatorAddresses
    } else {
      args[argName] = selectedValidator; // String for validatorAddress
    }
  }
}

// Execute main function
main().catch(error => {
  console.error("Script failed with error:", error);
});
