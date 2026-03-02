# Yield.xyz API Recipes

Practical code examples demonstrating how to interact with Yield.xyz APIs for DeFi operations.

## Overview

Yield.xyz provides unified APIs for decentralized finance:

- **Yields API** - Engage with yield opportunities across multiple networks and protocols
- **Perps API** - Trade perpetual futures with leverage across multiple providers
- **Borrow API** - Supply collateral and borrow against it across lending protocols

These recipes demonstrate:

- Discovering and entering yield opportunities
- Trading perpetual futures with full position management
- Supplying, borrowing, repaying, and managing collateral on lending protocols
- Managing active positions and executing pending actions
- Signing and submitting transactions with ethers.js
- Building schema-driven interactive CLI applications

## Prerequisites

- Node.js (v16+) and pnpm installed
- Wallet mnemonic phrase
- Yield.xyz API key (obtain from [Yield.xyz dashboard](https://dashboard.yield.xyz))

## Setup

1. Clone this repository
2. Create a `.env` file by copying the example:

```bash
cp .env.example .env
```

3. Fill in your `.env` file with:
   - `MNEMONIC`: Your wallet's seed phrase (12 or 24 words)
   - `YIELDS_API_KEY`: Your Yield.xyz API key (for yields/staking)
   - `PERPS_API_KEY`: Your Yield.xyz API key (for perpetuals trading)
   - `BORROW_API_KEY`: Your Yield.xyz API key (for lending/borrowing)
4. Install dependencies:

```bash
pnpm install
```

## Available Recipes

### Yields

Engage with yield opportunities across multiple networks and protocols:

```bash
pnpm yields
```

**Features:**
- Browse 2000+ yield opportunities across all networks 
- Search and filter by APY, network, token, and protocol
- Enter positions with dynamic argument collection (validators, LP ranges, etc.)
- View balances by type (active, claimable, withdrawable, etc.)
- Execute pending actions (claim rewards, unstake, withdraw, etc.)
- Fetch validator metadata for staking protocols (APY, status, voting power)
- Support for concentrated and classic liquidity pools
- Transaction status polling with explorer links

**Supported:**
- 80+ networks (Ethereum, Cosmos, Polkadot, Solana, Tron, and more)
- All yield types: staking, restaking, lending, vaults, liquidity pools
- Schema-driven UI that automatically adapts to each protocol

### Borrow

Supply collateral and borrow against lending protocols:

```bash
pnpm borrow
```

**Features:**
- Browse integrations (Aave, Morpho Blue, Spark, etc.) and their supported networks
- View lending markets with borrow rates, utilization, and collateral parameters
- View positions with health factor, LTV, supply/debt balances, and net APY
- Supply assets as collateral and borrow against them
- Repay debt and withdraw supplied assets
- Enable/disable collateral on supplied tokens
- Execute pending actions directly from position view
- Predicted impact display (health factor and LTV changes before confirming)
- Multi-step action support (cross-chain bridges, delayed withdrawals)
- Schema-driven UI that adapts to each protocol's requirements

**Supported Integrations:**
- Aave V3, Morpho Blue, Spark, and more

### Perps Trading

Trade perpetual futures with leverage:

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
- Schema-driven UI that adapts to each provider

**Supported Providers:**
- Hyperliquid
- More providers coming soon

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
- **Borrow API**: [docs.yield.xyz](https://docs.yield.xyz/reference) - Lending and borrowing
- **Perps API**: [docs.yield.xyz](https://docs.yield.xyz/reference) - Perpetual futures trading
- **Yields API**: [docs.yield.xyz](https://docs.yield.xyz/reference) - Staking and yield opportunities

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
