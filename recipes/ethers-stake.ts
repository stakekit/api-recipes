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
      choices: data.map((integration: { id: string }) => integration.id),
    });
    
    // Get integration configuration
    const config = await get(`/v1/yields/${integrationId}`);

    // Display configuration info
    console.log("\n=== Configuration === ");
    console.log("ID:", config.id);
    console.log(`APY: ${((config.apy || 1) * 100).toFixed(2)}%`);
    console.log(`Token: ${config.token.symbol} on ${config.token.network}`);
    console.log("=== Configuration end === \n");

    // Get token balance
    const balance = await post(`/v1/tokens/balances`, {
      addresses: [
        {
          network: config.token.network,
          address,
          tokenAddress: config.token.address,
        },
      ],
    });

    // Get staked balance
    const stakedBalance = await post(`/v1/yields/${integrationId}/balances`, {
      addresses: { address }
    });

    // Display balances
    console.log("=== Balances ===");
    console.log("Available", config.token.symbol, balance[0]?.amount || "0");
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
      const gas = await get(`/v1/transactions/gas/${config.token.network}`);
      
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
