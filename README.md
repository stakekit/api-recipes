# Yield.xyz API Recipes

Practical code examples demonstrating how to interact with Yield.xyz APIs for DeFi operations.

## Overview

Yield.xyz provides unified APIs for decentralized finance:

- **Yields API** - Engage with yield opportunities across multiple networks and protocols
- **Perps API** - Trade perpetual futures with leverage across multiple providers
- **Trade API** - Trade perps, spot and prediction markets on Hyperliquid
- **Borrow API** - Supply collateral and borrow against it across lending protocols

These recipes demonstrate:

- Discovering and entering yield opportunities
- Trading perpetual futures with full position management
- Trading perps, spot and prediction markets through the Trade API
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
   - `TRADE_API_KEY`: Your Yield.xyz API key (for the Trade API)
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

### Trade

Trade perps, spot and prediction markets through the Trade API:

```bash
pnpm trade
```

**Features:**
- Choose a provider, including testnets
- Browse markets by type (perps, stock perps, spot, prediction), operator and search
- Read one portfolio per provider: balances, positions, orders and setup steps
- Run a row's pending actions, or a market's own actions
- Simulate every action, print the summary and fees, and complete required steps first
- Sign EIP-712 typed data and EIP-1559 transactions locally, one transaction at a time
- Review recent actions and fills

**Supported:**
- Hyperliquid and Hyperliquid testnet (perps, including XYZ stock perps, spot, and prediction markets)

Lighter orders are signed with a trading key from Lighter's signer. Build it once with `pnpm build:lighter-signer` (Go 1.23). The recipe generates the key on the first **Approve a trading key**, saves the private part in `.env` (`LIGHTER_TRADING_KEY` or `LIGHTER_TESTNET_TRADING_KEY`), and fills the public key into the form. Approving a new key replaces the previous one.

The recipe targets the staging API (`TRADE_API_URL`, default `https://trade.stg.yield.xyz`).

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
- **Trade API**: [trade.stg.yield.xyz/docs](https://trade.stg.yield.xyz/docs) - Perps, spot and prediction markets
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
