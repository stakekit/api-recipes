# StakeKit API Recipes

In this repository, you will find a few examples of how to use StakeKit's staking API to build various staking flows.

## Getting started

Create a `.env` file in the root folder and fill it in with the appropriate variables.

```
cp .env.example .env
```

## Recipes

To test a staking integration, make sure you have enough funds of the deposit token + and sufficient gas in your wallet to cover gas fees.

With ethers

```
> yarn ts-node recipes/ethers-stake.ts
```

With @stakekit/signers

```
> yarn ts-node recipes/stakekit-signers-stake.ts
```
