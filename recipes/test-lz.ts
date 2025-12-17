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
    // Step 1: Initialize wallet from mnemonic phrase
    const wallet = Wallet.fromPhrase(process.env.MNEMONIC);
    const address = await wallet.getAddress();
    console.log(`Using wallet address: ${address}`);
    
    // Step 2: Use specific integration ID directly
    const integrationId = 'base-weth-mweth-0xa0e430870c4604ccfc7b38ca7845b1ff653d0ff1-4626-vault';
    // const integrationId = 'base-usdc-smusdc-0x616a4e1db48e22028f6bbf20444cd3b8e3273738-4626-vault';

    selectedIntegrationId = integrationId;
    
    // Step 3: Get specific integration data
    const selectedIntegration = await get(`/v1/yields/${integrationId}`);
    
    if (!selectedIntegration) {
      console.error("Integration not found");
      return;
    }

    // Step 4: Get full integration config for argument inspection
    const config = selectedIntegration;

    // Display integration info
    console.log("\n=== Integration Info === ");
    console.log(`ID: ${selectedIntegration.id}`);
    console.log(`Name: ${selectedIntegration.name || selectedIntegration.id}`);
    console.log(`APY: ${((selectedIntegration.apy || 1) * 100).toFixed(2)}%`);
    console.log(`Token: ${selectedIntegration.token.symbol} on ${selectedIntegration.token.network}`);

    console.log("\n=== FEE CONFIGURATIONS CHECK ===");
    if (config.feeConfigurations && config.feeConfigurations.length > 0) {
      console.log(`✓ Found ${config.feeConfigurations.length} fee configuration(s)`);
      config.feeConfigurations.forEach((feeConfig, index) => {
        console.log(`\nFee Configuration ${index + 1}:`);
        console.log(`  ID: ${feeConfig.id}`);
        console.log(`  Default: ${feeConfig.default}`);
        if (feeConfig.layerzeroOVaultConfig) {
          console.log(`  ✓ Has LayerZero config`);
          const lzConfig = feeConfig.layerzeroOVaultConfig;
          if (lzConfig.ovaults) {
            console.log(`  OVaults: ${lzConfig.ovaults.length}`);
            lzConfig.ovaults.forEach((ovault, i) => {
              console.log(`    ${i + 1}. Network: ${ovault.network}, Home: ${ovault.isHomeNetwork}`);
              if (ovault.assetOFTAddress) {
                console.log(`       AssetOFT: ${ovault.assetOFTAddress}`);
              }
            });
          }
        } else {
          console.log(`  ✗ No LayerZero config`);
        }
      });
    } else {
      console.log("✗ No fee configurations found!");
    }
    console.log("=== END FEE CONFIGURATIONS CHECK ===\n");

    // Display integration info
    console.log("\n=== Integration Info === ");
    // Step 5: Get token balance and staked balance
    let tokenToUse = selectedIntegration.token;
    
    // Check if integration has multiple tokens and let user select
    if (selectedIntegration.tokens && selectedIntegration.tokens.length > 1) {
      console.log("Available tokens:", JSON.stringify(selectedIntegration.tokens, null, 2));

      const choices = selectedIntegration.tokens.map((token: any, index: number) => ({
        name: `${token.symbol} on ${token.network}`,
        value: index
      }));

      console.log("Choices:", choices);

      const { selectedToken }: any = await Enquirer.prompt({
        type: "autocomplete",
        name: "selectedToken",
        message: "This integration supports multiple tokens. Which would you like to use?",
        choices: selectedIntegration.tokens.map((token: any, index: number) => ({
          name: `${token.symbol} on ${token.network}`,
          value: index
        })),
      });
      
      console.log("Selected token index:", selectedToken);
      tokenToUse = selectedIntegration.tokens[selectedToken];
    }

    console.log("Token to use:", JSON.stringify(tokenToUse, null, 2));

    const [balance, stakedBalance] = await Promise.all([
      post(`/v1/tokens/balances`, {
        addresses: [
          {
            network: tokenToUse.network,
            address,
            tokenAddress: tokenToUse.address,
          },
        ],
      }),
      post(`/v1/yields/${integrationId}/balances`, {
        addresses: { address }
      })
    ]);

    // Display balances
    console.log("=== Balances ===");
    console.log(`Available ${tokenToUse.symbol}: ${balance[0]?.amount || "0"}`);
    console.log(`Staked: ${JSON.stringify(stakedBalance)}`);
    console.log("=== Integration Info End ===\n");

    // Step 6: Select action (stake/unstake)
    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What action would you like to perform?",
      choices: ['enter', 'exit'],
    });

    // Step 7: Enter amount
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: `How much would you like to ${action === 'enter' ? 'stake' : 'unstake'}`,
    });

    // Prepare arguments object for API call
    const args: any = { amount };

    // Add inputToken for ENTER or outputToken for EXIT based on integration requirements
    if (action === 'enter') {
      // Check if inputToken is required or if there are multiple token options
      const inputTokenRequired = config.args?.enter?.args?.inputToken;
      if (inputTokenRequired || (selectedIntegration.tokens && selectedIntegration.tokens.length > 1)) {
        args.inputToken = tokenToUse;
      }
    } else if (action === 'exit') {
      // Check if outputToken is required or if there are multiple token options
      const outputTokenRequired = config.args?.exit?.args?.outputToken;
      if (outputTokenRequired || (selectedIntegration.tokens && selectedIntegration.tokens.length > 1)) {
        args.outputToken = tokenToUse;
      }
    }
    // Step 8: Get additional required arguments (validators, durations, etc.)
    await collectRequiredArguments(config, action, args);

    console.log("\n=== ARGS CHECK ===");
    console.log("Final args:", JSON.stringify(args, null, 2));
    if (args.feeConfigurationId) {
      console.log(`✓ Fee configuration ID is set: ${args.feeConfigurationId}`);
    } else {
      console.log("✗ No fee configuration ID in args");
    }
    console.log("=== END ARGS CHECK ===\n");

    console.log("Final args being sent:", JSON.stringify(args, null, 2));

    // Step 9: Create action session
    console.log(`\nCreating ${action} action session...`);
    const session = await post(`/v1/actions/${action}`, {
      integrationId: integrationId,
      addresses: {
        address: address,
        additionalAddresses: {},
      },
      args
    });

    console.log(`Processing ${action} action with ${session.transactions.length} transactions...\n`);


    console.log("\n=== ACTION SESSION CREATED ===");
    console.log(`Total transactions: ${session.transactions.length}`);
    session.transactions.forEach((tx, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      console.log(`  Type: ${tx.type}`);
      console.log(`  Network: ${tx.network}`);
      console.log(`  Status: ${tx.status}`);
      console.log(`  Step Index: ${tx.stepIndex}`);
      console.log(`  ID: ${tx.id}`);
    });
    console.log("=== END ACTION SESSION ===\n");

    // Step 10: Process each transaction in the session
    for (const partialTx of session.transactions) {
      const transactionId = partialTx.id;

      if (partialTx.status === "SKIPPED") {
        console.log(`Skipping step ${partialTx.stepIndex + 1} of ${session.transactions.length}: ${partialTx.type}`);
        continue;
      }
      
      console.log(`Processing step ${partialTx.stepIndex + 1} of ${session.transactions.length}: ${partialTx.type}`);

      // Step 10.1: Prepare transaction first to get the actual network
      const transaction = await patch(`/v1/transactions/${transactionId}`, {});
      const actualNetwork = transaction.network;
      
      console.log(`Transaction will execute on network: ${actualNetwork}`);

      // Step 10.2: Get gas price options for the actual network
      const gas = await get(`/v1/transactions/gas/${actualNetwork}`);
      
      // Step 10.3: Select gas mode
      let gasArgs = {};
      const { gasMode }: any = await Enquirer.prompt({
        type: "select",
        name: "gasMode",
        message: `Which gas mode would you like to use on ${actualNetwork} (${gas.modes?.denom || 'default'})?`,
        choices: [...(gas.modes?.values || []), { name: "custom" }].map((g) => ({
          message: g.name, 
          name: g 
        })),
      });

      if (gasMode.name !== "custom") {
        gasArgs = gasMode.gasArgs;
      } else {
        console.log("Custom gas mode not supported in this example.");
        continue;
      }

      // Step 10.4: Re-prepare transaction with gas settings
      const finalTransaction = await patch(`/v1/transactions/${transactionId}`, gasArgs);

      // ADD THIS ENHANCED DEBUG LOGGING:
      console.log("\n=== TRANSACTION DETAILS ===");
      console.log(`Transaction ID: ${transactionId}`);
      console.log(`Type: ${finalTransaction.type}`);
      console.log(`Network: ${finalTransaction.network}`);
      console.log(`Status: ${finalTransaction.status}`);

            // Debug: Show transaction target
      const unsignedTx = JSON.parse(finalTransaction.unsignedTransaction);
      console.log(`\nUnsigned Transaction:`);
      console.log(`  To: ${unsignedTx.to}`);
      console.log(`  From: ${unsignedTx.from}`);
      console.log(`  Value: ${unsignedTx.value}`);
      console.log(`  Data: ${unsignedTx.data?.substring(0, 66)}...`); // First 66 chars (method signature)


    // Check which contract is being called
    if (unsignedTx.to?.toLowerCase() === '0xc026395860Db2d07ee33e05fE50ed7bD583189C7'.toLowerCase()) {
      console.log("✓ Correctly targeting Stargate Pool USDC (AssetOFT) for LayerZero routing");
    } else if (unsignedTx.to?.toLowerCase() === '0x616a4e1db48e22028f6bbf20444cd3b8e3273738'.toLowerCase()) {
      console.log("✗ ERROR: Targeting Base vault directly - this will fail for cross-chain deposits!");
    } else {
      console.log(`⚠ Unknown contract: ${unsignedTx.to}`);
    }
    console.log("=== END TRANSACTION DETAILS ===\n");
      // Step 10.5: Sign transaction with ethers.js wallet
      console.log("Signing transaction...");
      const signed = await wallet.signTransaction(
        JSON.parse(finalTransaction.unsignedTransaction)
      );

      // Step 10.6: Submit signed transaction
      console.log("Submitting transaction...");
      const result = await post(`/v1/transactions/${transactionId}/submit`, {
        signedTransaction: signed,
      });

      console.log("Transaction submitted:", JSON.stringify({
        network: finalTransaction.network,
        txId: result.id
      }, null, 2));

      // Step 10.7: Wait for transaction confirmation
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
    await addValidatorToArgs(args, 'validatorAddress');
  }

  // Get validator addresses if required
  if (config.args[action]?.args.validatorAddresses) {
    await addValidatorToArgs(args, 'validatorAddresses');
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

  // Get fee configuration if required (for LayerZero)
  if (config.args[action]?.args.feeConfigurationId) {
    console.log("Fee configuration required for LayerZero cross-chain routing");
    
    // Check if options available
    if (
      config.args[action].args.feeConfigurationId.options &&
      config.args[action].args.feeConfigurationId.options.length > 0
    ) {
      const options = config.args[action].args.feeConfigurationId.options;
      console.log("Available fee configurations:", options);

      // Prompt user to select a fee configuration
      const { selectedFeeConfig }: any = await Enquirer.prompt({
        type: "select",
        name: "selectedFeeConfig",
        message: "Select a LayerZero fee tier (required for cross-chain routing):",
        choices: options.map((option: string) => option),  // Just use the UUID directly
      });

      args.feeConfigurationId = selectedFeeConfig;
      console.log(`Selected fee configuration: ${selectedFeeConfig}`);
    } else {
      console.log("No fee configuration options found - this may cause the transaction to fail");
    }
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
      message: "Select a validator to stake with:",
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
