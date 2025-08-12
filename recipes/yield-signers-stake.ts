/**
 * Yield API Recipe: Staking with @stakekit/signers
 *
 * This example demonstrates how to use the Yield API with @stakekit/signers
 * to stake tokens on various networks, with support for specialized wallet types.
 */

import { ImportableWallets, getSigningWallet } from '@stakekit/signers';
import 'cross-fetch/polyfill';
import * as dotenv from 'dotenv';
import Enquirer from 'enquirer';
import { get, post } from '../utils/requests-yield-api';

// Load environment variables
dotenv.config();

// Check for required environment variables
if (!process.env.MNEMONIC || !process.env.API_KEY) {
  console.error(
    'Error: MNEMONIC and API_KEY environment variables are required',
  );
  process.exit(1);
}

// Store the selected integration ID globally for validator lookup
let selectedIntegrationId = '';

/**
 * Main execution function
 */
async function main() {
  try {
    // Step 1: Get available yield integrations from Yield API
    const { data } = await get(`/v1/yields`);

    if (!data || data.length === 0) {
      console.error('No enabled yield integrations found');
      return;
    }

    // Step 2: Let user select an integration to use
    const { integrationId }: any = await Enquirer.prompt({
      type: 'autocomplete',
      name: 'integrationId',
      message: 'Choose the yield integration you would like to use: ',
      choices: data.map(
        (integration: {
          id: string;
          name: string;
          apy: number;
          token: { symbol: string };
        }) => ({
          name: `${integration.name || integration.id} (${
            integration.token.symbol
          }) - APY: ${((integration.apy || 1) * 100).toFixed(2)}%`,
          value: integration.id,
        }),
      ),
    });

    // Store integration ID globally
    selectedIntegrationId = integrationId;

    // Find selected integration data
    const selectedIntegration = data.find(
      (integration) => integration.id === integrationId,
    );
    if (!selectedIntegration) {
      console.error('Selected integration not found');
      return;
    }

    // Step 3: Select action (stake/unstake)
    const { action }: any = await Enquirer.prompt({
      type: 'select',
      name: 'action',
      message: 'What action would you like to perform?',
      choices: ['enter', 'exit'],
    });

    // Step 4: Get full integration config to determine required args
    const config = await get(`/v1/yields/${integrationId}`);

    // Step 5: Initialize wallet with @stakekit/signers
    const walletOptions = {
      mnemonic: process.env.MNEMONIC,
      walletType: ImportableWallets.MetaMask, // Universal wallet type
      index: 0,
    };

    // Get network-specific wallet
    console.log(
      `Initializing wallet for ${selectedIntegration.token.network}...`,
    );
    const wallet = await getSigningWallet(
      selectedIntegration.token.network,
      walletOptions,
    );
    const address = await wallet.getAddress();
    console.log(`Wallet address: ${address}`);

    // Step 6: Get additional addresses if required by the integration
    let additionalAddresses = {};
    if (config.args[action]?.addresses?.additionalAddresses) {
      console.log(
        'Getting additional addresses required by the integration...',
      );
      additionalAddresses = await wallet.getAdditionalAddresses();
    }

    // Step 7: Get token and staked balances
    const [balance, stakedBalance] = await Promise.all([
      post(`/v1/tokens/balances`, {
        addresses: [
          {
            network: selectedIntegration.token.network,
            address,
            tokenAddress: selectedIntegration.token.address,
          },
        ],
      }),
      post(`/v1/yields/${integrationId}/balances`, {
        addresses: { address, additionalAddresses },
      }),
    ]);

    // Display balances
    console.log('\n=== Balances ===');
    console.log(
      `Available ${selectedIntegration.token.symbol}: ${
        balance[0]?.amount || '0'
      }`,
    );
    console.log(`Staked: ${JSON.stringify(stakedBalance, null, 2)}`);
    console.log('=== Balances End ===\n');

    // Step 8: Enter amount to stake/unstake
    const { amount }: any = await Enquirer.prompt({
      type: 'input',
      name: 'amount',
      message: `How much would you like to ${
        action === 'enter' ? 'stake' : 'unstake'
      }`,
    });

    // Prepare arguments object for API call
    const args = { amount };

    // Step 9: Get additional required arguments (validators, durations, etc.)
    await collectRequiredArguments(config, action, args);

    // Step 10: Execute the action directly
    console.log(`\nExecuting ${action} action...`);
    const result = await post(`/v1/yields/${action}`, {
      addresses: {
        address: address,
        additionalAddresses: additionalAddresses,
      },
      args,
    });

    console.log('Action completed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error executing yield action:', error);
  }
}

/**
 * Collects additional arguments required by the integration
 */
async function collectRequiredArguments(config, action, args) {
  // Get validator address if required
  if (config.args[action]?.args?.validatorAddress) {
    await addValidatorToArgs(args, 'validatorAddress');
  }

  // Get validator addresses if required
  if (config.args[action]?.args?.validatorAddresses) {
    await addValidatorToArgs(args, 'validatorAddresses');
  }

  // Get Tron resource type if required
  if (config.args[action]?.args?.tronResource) {
    const { tronResource }: any = await Enquirer.prompt({
      type: 'select',
      name: 'tronResource',
      message: 'Which resource would you like to freeze?',
      choices: ['ENERGY', 'BANDWIDTH'],
    });
    args.tronResource = tronResource;
  }

  // Get duration if required
  if (config.args[action]?.args?.duration) {
    const { duration }: any = await Enquirer.prompt({
      type: 'input',
      name: 'duration',
      message: 'For how long would you like to stake? (in days)',
    });
    args.duration = duration;
  }

  // Get fee configuration if required
  if (config.args[action]?.args?.feeConfigurationId) {
    // Check if options available
    if (
      config.args[action].args.feeConfigurationId.options &&
      config.args[action].args.feeConfigurationId.options.length > 0
    ) {
      const options = config.args[action].args.feeConfigurationId.options;

      // Prompt user to select a fee configuration
      const { selectedFeeConfig }: any = await Enquirer.prompt({
        type: 'select',
        name: 'selectedFeeConfig',
        message: 'Select a fee configuration:',
        choices: [
          ...options.map((option: string) => ({
            name: option,
            value: option,
          })),
          {
            name: 'None',
            value: undefined,
          },
        ],
      });

      args.feeConfigurationId = selectedFeeConfig;
    } else if (config.args[action].args.feeConfigurationId.required) {
      console.warn('Fee configuration is required but no options are provided');
    }
  }
}

/**
 * Helper function to add validator to arguments
 */
async function addValidatorToArgs(args, argName) {
  // Fetch available validators from correct endpoint
  const validatorsData = await get(
    `/v2/yields/${selectedIntegrationId}/validators`,
  );

  if (
    validatorsData &&
    validatorsData.length > 0 &&
    validatorsData[0].validators?.length > 0
  ) {
    const validators = validatorsData[0].validators;

    // Format validators for selection
    const validatorChoices = validators.map((validator) => ({
      name: `${validator.name || validator.address} (${
        validator.status
      }) - APR: ${
        validator.apr ? (validator.apr * 100).toFixed(2) + '%' : 'N/A'
      }${validator.subnetId ? ` - Subnet: ${validator.subnetId}` : ''}`,
      value: validator.address,
    }));

    // Ask user to select a validator
    const { selectedValidator }: any = await Enquirer.prompt({
      type: 'autocomplete',
      name: 'selectedValidator',
      message: 'Select a validator:',
      choices: validatorChoices,
    });

    // Find the selected validator object to get additional properties
    const selectedValidatorObj = validators.find(
      (v) => v.address === selectedValidator,
    );

    // Add to args based on argument name
    if (argName === 'validatorAddresses') {
      args[argName] = [selectedValidator]; // Array for validatorAddresses
    } else {
      args[argName] = selectedValidator; // String for validatorAddress
    }

    // Add subnet ID if available (same as validator address)
    if (selectedValidatorObj && selectedValidatorObj.subnetId) {
      args['subnetId'] = selectedValidatorObj.subnetId;
    }
  }
}

// Execute main function
main().catch((error) => {
  console.error('Script failed with error:', error);
});
