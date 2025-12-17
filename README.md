# Yield.xyz API Recipes

Practical code examples demonstrating how to interact with Yield.xyz APIs for DeFi operations.

## Overview

Yield.xyz provides unified APIs for decentralized finance:

- **Perps API** - Trade perpetual futures with leverage across multiple providers
- **Yields API** - Stake and earn rewards across multiple networks and protocols

These recipes demonstrate:

- Querying markets, positions, and balances
- Executing trades and managing positions
- Signing and submitting transactions with ethers.js
- Building interactive CLI applications

## Prerequisites

- Node.js (v16+) and pnpm installed
- Wallet mnemonic phrase
- Yield.xyz API key (obtain from [Yield.xyz dashboard](https://app.yield.xyz))

## Setup

1. Clone this repository
2. Create a `.env` file by copying the example:

```bash
cp .env.example .env
```

3. Fill in your `.env` file with:
   - `MNEMONIC`: Your wallet's seed phrase (12 or 24 words)
   - `PERPS_API_KEY`: Your Yield.xyz API key (for perps)
   - `YIELDS_API_KEY`: Your Yield.xyz API key (for yields)
4. Install dependencies:

```bash
pnpm install
```

## Available Recipes

### Perps Trading

Interactive perpetual futures trading with full position management:

```bash
pnpm perps
```

**Features:**
- View account balances and margin utilization
- Browse markets with real-time prices and funding rates
- Execute leveraged trades (long/short positions)
- Manage existing positions (close, adjust leverage, set TP/SL)
- View and cancel orders
- Deposit and withdraw collateral
- Schema-driven UI that adapts to API changes

**Supported Providers:**
- Hyperliquid
- More providers coming soon

### Yields / Staking

Interactive staking and yield farming interface:

```bash
pnpm yields
```

**Features:**
- Browse yield opportunities across multiple networks
- View APY rates and token information
- Enter yield positions (staking, liquid staking, etc.)
- Manage existing positions
- Execute pending actions (claim rewards, unstake, etc.)
- Schema-driven UI that adapts to each protocol's requirements

**Supported Networks & Protocols:**
- Ethereum (Lido, Rocket Pool, etc.)
- Cosmos chains
- Polkadot
- Many more networks and providers

## How It Works

All recipes follow an interactive, schema-driven approach:

1. **Connect** - API key and wallet authentication
2. **Discover** - Browse available markets, providers, or opportunities
3. **Execute** - Perform actions with real-time argument collection
4. **Sign** - Sign transactions locally with your wallet
5. **Submit** - Submit to the blockchain or provider

The recipes automatically adapt to API changes using schema-driven UI generation.

## API Documentation

For complete API documentation and integration guides:
- **Perps API**: [docs.yield.xyz](https://docs.yield.xyz) - Perpetual futures trading
- **Yields API**: [docs.yield.xyz](https://docs.yield.xyz) - Staking and yield opportunities

## Development

```bash
# Build TypeScript
pnpm build

# Format code
pnpm format

# Clean build artifacts
pnpm clean
```

## Security

⚠️ **Never commit sensitive data**:
- Keep your `.env` file private
- Never share your mnemonic phrase
- Protect your API keys

Use `.env.example` as a template only.
