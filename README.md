# OMNI API Recipes

In this repository you will find a few examples of how use Omni's staking API to build various staking flows.

## Getting started

Create a `.env` file in the root folder and fill it in with the appropriate variables.

```
cp .env.example .env
```

## Recipes

To test a staking integration, make sure you have enough of the deposit token + and sufficient gas in your wallet to cover gas fees.

```
> ts-node recipes/ethers.ts
```

To check an addresses balance for an integration, run the `balance.ts` script:

```
> ts-node recipes/balance.ts ethereum-matic-native-staking 0x
```
