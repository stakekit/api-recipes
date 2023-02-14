# OMNI API Recipes

In this repository you will find a few examples of how use Omni's staking API to build various staking flows.

## Getting started

Create a `.env` file in the root folder and add the following environment variables.

```
SEED_PHRASE='YOUR_SEED_PHRASE'
API_URL='PROVIDED_API_URL'
API_KEY='PROVIDED_API_KEY'
```

## Running the scripts

To test the Sushi Liquid staking on Ethereum you have to make sure you have some [Sushi](https://etherscan.io/address/0x6b3595068778dd592e39a122f4f5a5cf09c90fe2) and sufficient ETH in your wallet to cover gas fees.

Then run `ts-node recipes/evm-staking.ts`

To check your balance

Then run `ts-node recipes/check-balance.ts`
