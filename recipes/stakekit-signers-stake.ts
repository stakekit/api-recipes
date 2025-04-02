/**
 * StakeKit API Recipe: Staking with @stakekit/signers
 * 
 * This example demonstrates how to use the StakeKit API with @stakekit/signers
 * to stake tokens on various networks, with support for specialized wallet types.
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
      choices: data.map((integration: { id: string; name: string; apy: number; token: { symbol: string }}) => ({
        name: `${integration.name || integration.id} (${integration.token.symbol}) - APY: ${((integration.apy || 1) * 100).toFixed(2)}%`,
        value: integration.id
      })),
    });
    
    // Find selected integration data
    const selectedIntegration = data.find(integration => integration.id === integrationId);
    if (!selectedIntegration) {
      console.error("Selected integration not found");
      return;
    }

    // Select action (stake/unstake)
    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What action would you like to perform?",
      choices: ['enter', 'exit'],
    });

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
    if (config.args[action]?.addresses.additionalAddresses) {
      console.log("Getting additional addresses required by the integration...");
      additionalAddresses = await wallet.getAdditionalAddresses();
    }

    // Display configuration info
    console.log("\n=== Integration Info === ");
    console.log("ID:", selectedIntegration.id);
    console.log("Name:", selectedIntegration.name || selectedIntegration.id);
    console.log(`APY: ${((selectedIntegration.apy || 1) * 100).toFixed(2)}%`);
    console.log(`Token: ${selectedIntegration.token.symbol} on ${selectedIntegration.token.network}`);
    console.log("=== Integration Info End === \n");

    // Get token balance
    const balance = await post(`/v1/tokens/balances`, {
      addresses: [
        {
          network: selectedIntegration.token.network,
          address,
          tokenAddress: selectedIntegration.token.address,
        },
      ],
    });

    // Get staked balance
    const stakedBalance = await post(`/v1/yields/${integrationId}/balances`, {
      addresses: { address, additionalAddresses }
    });

    // Display balances
    console.log("=== Balances ===");
    console.log("Available", selectedIntegration.token.symbol, balance[0]?.amount || "0");
    console.log("Staked", stakedBalance);
    console.log("=== Balances end ===\n");

    // Enter amount
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: `How much would you like to ${action === 'enter' ? 'stake' : 'unstake'}`,
    });

    // Prepare arguments object
    const args: { amount: string, validatorAddress?: string, validatorAddresses?: string[], tronResource?: string, duration?: string } = {
      amount: amount,
    };

    // Get additional required arguments based on integration config
    await collectRequiredArguments(config, action, args);

    // Create action session
    console.log(`\nCreating ${action} action session...`);
    const session = await post(`/v1/actions/${action}`, {
      integrationId: integrationId,
      addresses: {
        address: address,
        additionalAddresses: additionalAddresses,
      },
      args,
    });

    console.log(`Processing ${action} action with ${session.transactions.length} transactions...\n`);

    // Process transactions
    let lastTx = null;
    for (const partialTx of session.transactions) {
      const transactionId = partialTx.id;

      if (partialTx.status === "SKIPPED") {
        console.log(`Skipping step ${partialTx.stepIndex + 1}: ${partialTx.type}`);
        continue;
      }

      // If cross-chain transaction, wait for funds to arrive
      if (lastTx !== null && lastTx.network !== partialTx.network) {
        console.log("Cross-chain transaction detected. Waiting for funds to arrive in destination chain...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      
      console.log(`Processing step ${partialTx.stepIndex + 1} of ${session.transactions.length}: ${partialTx.type}`);

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

      // Prepare transaction with retries
      console.log("Preparing transaction...");
      let unsignedTransaction;
      for (let i = 0; i < 3; i++) {
        try {
          unsignedTransaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);
          break;
        } catch (error) {
          console.log(`Attempt ${i + 1} failed. Retrying in 1 second...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      
      if (!unsignedTransaction) {
        throw new Error("Failed to get unsigned transaction after 3 attempts");
      }

      // Get network-specific wallet for signing
      const signingWallet = await getSigningWallet(
        unsignedTransaction.network,
        walletOptions
      );

      // Sign transaction
      console.log("Signing transaction...");
      const signed = await signingWallet.signTransaction(
        unsignedTransaction.unsignedTransaction
      );

      // Submit transaction
      console.log("Submitting transaction...");
      const result = await post(`/v1/transactions/${transactionId}/submit`, { 
        signedTransaction: signed 
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      lastTx = { network: unsignedTransaction.network, result: result };
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
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      
      console.log("\n");
    }
    
    console.log("Action completed successfully!");
    
  } catch (error) {
    console.error("Error executing staking action:", error);
  }
}

/**
 * Collects additional arguments required by the integration
 */
async function collectRequiredArguments(config, action, args) {
  // Get validator address if required
  if (config.args[action]?.args.validatorAddress) {
    // Fetch available validators
    const validatorsData = await get(`/v2/yields/${config.id}/validators`);
    
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
        message: "Select a validator to stake with:",
        choices: validatorChoices,
      });
      
      args.validatorAddress = selectedValidator;
    }
  }

  // Get validator addresses if required
  if (config.args[action]?.args.validatorAddresses) {
    // Fetch available validators
    const validatorsData = await get(`/v2/yields/${config.id}/validators`);
    
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
        message: "Select a validator to stake with:",
        choices: validatorChoices,
      });
      
      // Use an array with a single validator
      args.validatorAddresses = [selectedValidator];
    }
  }

  // Get Tron resource type if required
  if (config.args[action]?.args.tronResource) {
    const { tronResource }: any = await Enquirer.prompt({
      type: "select",
      name: "tronResource",
      message: "Which resource would you like to freeze?",
      choices: ['ENERGY', 'BANDWIDTH'],
    });
    args.tronResource = tronResource;
  }

  // Get duration if required
  if (config.args[action]?.args.duration) {
    const { duration }: any = await Enquirer.prompt({
      type: "input",
      name: "duration",
      message: "For how long would you like to stake? (in days)",
    });
    args.duration = duration;
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
