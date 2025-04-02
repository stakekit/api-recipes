# StakeKit API Recipes

This repository contains practical examples demonstrating how to use StakeKit's staking API to implement various staking workflows.

## Overview

The StakeKit API provides a comprehensive set of endpoints to facilitate cryptocurrency staking operations. These examples showcase:

- How to stake tokens using different libraries (ethers and @stakekit/signers)
- How to manage pending actions for staked assets
- How to query balances and validate transactions

## Prerequisites

- Node.js and pnpm installed
- A wallet with sufficient funds for testing (both deposit tokens and gas)
- StakeKit API key (obtain from [StakeKit dashboard](https://stakek.it/))

## Setup

1. Clone this repository
2. Create a `.env` file by copying the example:

```bash
cp .env.example .env
```

3. Fill in your `.env` file with:
   - `MNEMONIC`: Your wallet's seed phrase
   - `API_KEY`: Your StakeKit API key
   - `API_ENDPOINT`: The StakeKit API endpoint (default: https://api.stakek.it)
4. Install dependencies:

```bash
pnpm install
```

## Available Recipes

### Staking with ethers

A basic example using the ethers.js library to interact with StakeKit's API:

```bash
pnpm ts-node recipes/ethers-stake.ts
# or using the npm script
pnpm ethers-stake
```

### Staking with @stakekit/signers

A more advanced example using StakeKit's own signers library:

```bash
pnpm ts-node recipes/stakekit-signers-stake.ts
# or using the npm script
pnpm stakekit-signers-stake
```

### Managing Pending Actions

Execute pending actions on your staked assets (claim rewards, withdraw positions):

```bash
pnpm ts-node recipes/stakekit-signers-pending-actions.ts
# or using the npm script
pnpm pending-actions
```

## Recipe Structure

Each recipe follows a similar workflow:

1. Select a yield/integration to work with
2. Choose an action (stake/unstake)
3. Enter required parameters (amount, validators, etc.)
4. Sign and submit transactions
5. Monitor transaction status

## API Documentation

For complete StakeKit API documentation, visit:
[https://docs.stakek.it/](https://docs.stakek.it/)
