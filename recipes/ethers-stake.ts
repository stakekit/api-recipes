/**
 * StakeKit API Recipe: Staking with ethers.js
 * 
 * This example demonstrates how to use the StakeKit API with ethers.js
 * to stake tokens on various networks.
 */

import * as dotenv from "dotenv";
import { Wallet } from "ethers";

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
    // Initialize wallet
    const wallet = Wallet.fromPhrase(process.env.MNEMONIC);
    const address = await wallet.getAddress();
    
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
      addresses: { address }
    });

    // Display balances
    console.log("=== Balances ===");
    console.log("Available", selectedIntegration.token.symbol, balance[0]?.amount || "0");
    console.log("Staked", stakedBalance);
    console.log("=== Balances end ===\n");

    // Select action (stake/unstake)
    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What action would you like to perform?",
      choices: ['enter', 'exit'],
    });

    // Enter amount
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: `How much would you like to ${action === 'enter' ? 'stake' : 'unstake'}`,
    });

    // Create action session
    const session = await post(`/v1/actions/${action}`, {
      integrationId: integrationId,
      addresses: {
        address: address,
        additionalAddresses: {},
      },
      args: {
        amount: amount,
      }
    });

    console.log(`\nProcessing ${action} action with ${session.transactions.length} transactions...\n`);

    // Process transactions
    let lastTx = null;
    for (const partialTx of session.transactions) {
      const transactionId = partialTx.id;

      if (partialTx.status === "SKIPPED") {
        console.log(`Skipping step ${partialTx.stepIndex}: ${partialTx.type}`);
        continue;
      }
      
      console.log(`Processing step ${partialTx.stepIndex} of ${session.transactions.length}: ${partialTx.type}`);

      // Get gas price options
      const gas = await get(`/v1/transactions/gas/${selectedIntegration.token.network}`);
      
      // Select gas mode
      let gasArgs = {};
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

      // Prepare transaction
      const transaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);

      // Sign transaction
      console.log("Signing transaction...");
      const signed = await wallet.signTransaction(
        JSON.parse(transaction.unsignedTransaction)
      );

      // Submit transaction
      console.log("Submitting transaction...");
      const result = await post(`/v1/transactions/${transactionId}/submit`, {
        signedTransaction: signed,
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
          await new Promise((resolve) => setTimeout(resolve, 1000));
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
    const { validatorAddress }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddress",
      message: "To which validator would you like to stake to?",
    });
    args.validatorAddress = validatorAddress;
  }

  // Get validator addresses if required
  if (config.args[action]?.args.validatorAddresses) {
    const { validatorAddresses }: any = await Enquirer.prompt({
      type: "input",
      name: "validatorAddresses",
      message: "To which validator addresses would you like to stake to? (Separated by comma)",
    });
    args.validatorAddresses = validatorAddresses.split(",");
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
