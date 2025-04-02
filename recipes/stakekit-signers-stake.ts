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
      choices: data.map((integration: { id: string }) => integration.id),
    });

    // Select action (stake/unstake)
    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What action would you like to perform?",
      choices: ['enter', 'exit'],
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
    if (config.args[action]?.addresses.additionalAddresses) {
      console.log("Getting additional addresses required by the integration...");
      additionalAddresses = await wallet.getAdditionalAddresses();
    }

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
      addresses: { address, additionalAddresses }
    });

    // Display balances
    console.log("=== Balances ===");
    console.log("Available", config.token.symbol, balance[0]?.amount || "0");
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
        console.log(`Skipping step ${partialTx.stepIndex}: ${partialTx.type}`);
        continue;
      }

      // If cross-chain transaction, wait for funds to arrive
      await checkCrossChainFunds(lastTx, partialTx, session, integrationId, address, additionalAddresses, args);
      
      console.log(`Processing step ${partialTx.stepIndex} of ${session.transactions.length}: ${partialTx.type}`);

      // Get gas price options
      const gas = await get(`/v1/transactions/gas/${partialTx.network}`);
      
      // Select gas mode if customizable
      let gasArgs = {};
      if (gas.customisable !== false) {
        gasArgs = await selectGasMode(gas);
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
      await waitForTransactionConfirmation(transactionId);
      
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

/**
 * Checks if funds have arrived in destination chain for cross-chain transactions
 */
async function checkCrossChainFunds(lastTx, currentTx, session, integrationId, address, additionalAddresses, args) {
  if (lastTx !== null && lastTx.network !== currentTx.network) {
    console.log("Cross-chain transaction detected. Waiting for funds to arrive in destination chain...");
    
    while (true) {
      const stakedBalances = await post(`/v1/yields/${integrationId}/balances`, {
        addresses: { address, additionalAddresses },
        args: { validatorAddresses: args.validatorAddress ? [args.validatorAddress] : undefined },
      });

      const locked = stakedBalances.find((balance) => balance.type === 'locked');

      if (locked && locked.amount >= session.amount) {
        console.log('Locked amount available in destination chain. Proceeding...');
        break;
      } else {
        process.stdout.write(".");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
    console.log("\n");
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
