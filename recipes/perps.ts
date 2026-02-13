/**
 * Yield.xyz Perps API Recipe
 *
 * This example demonstrates how to interact with perpetual futures markets
 * via the Yield.xyz Perps API using ethers.js for transaction signing.
 */

import "cross-fetch/polyfill";
import * as dotenv from "dotenv";
import Enquirer from "enquirer";
import { HDNodeWallet } from "ethers";
import { request } from "../utils/requests";

dotenv.config();

if (!process.env.MNEMONIC || !process.env.PERPS_API_KEY) {
  console.error("Error: MNEMONIC and PERPS_API_KEY environment variables are required");
  process.exit(1);
}

// ===== Type Definitions =====

enum PerpActionTypes {
  OPEN = "open",
  CLOSE = "close",
  UPDATE_LEVERAGE = "updateLeverage",
  STOP_LOSS = "stopLoss",
  TAKE_PROFIT = "takeProfit",
  CANCEL_ORDER = "cancelOrder",
  FUND = "fund",
  WITHDRAW = "withdraw",
}

// Human-readable labels for actions
const ACTION_LABELS: Record<PerpActionTypes, string> = {
  [PerpActionTypes.OPEN]: "Open Position",
  [PerpActionTypes.CLOSE]: "Close Position",
  [PerpActionTypes.UPDATE_LEVERAGE]: "Update Leverage",
  [PerpActionTypes.STOP_LOSS]: "Set Stop Loss",
  [PerpActionTypes.TAKE_PROFIT]: "Set Take Profit",
  [PerpActionTypes.CANCEL_ORDER]: "Cancel Order",
  [PerpActionTypes.FUND]: "Deposit Funds",
  [PerpActionTypes.WITHDRAW]: "Withdraw Funds",
};

// Actions that can only be performed on existing positions
const POSITION_ONLY_ACTIONS = [
  PerpActionTypes.CLOSE,
  PerpActionTypes.UPDATE_LEVERAGE,
  PerpActionTypes.STOP_LOSS,
  PerpActionTypes.TAKE_PROFIT,
];

enum PerpTransactionStatus {
  CREATED = "CREATED",
  SIGNED = "SIGNED",
  BROADCASTED = "BROADCASTED",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
  NOT_FOUND = "NOT_FOUND",
}

enum SigningFormat {
  EVM_TRANSACTION = "EVM_TRANSACTION",
  EIP712_TYPED_DATA = "EIP712_TYPED_DATA",
  SOLANA_TRANSACTION = "SOLANA_TRANSACTION",
  COSMOS_TRANSACTION = "COSMOS_TRANSACTION",
}

interface TokenDto {
  symbol: string;
  name?: string;
  network: string;
  decimals?: number;
  address?: string;
  logoURI?: string;
}

interface TokenIdentifierDto {
  network: string;
  address?: string;
}

interface ActionArguments {
  marketId?: string;
  side?: "long" | "short";
  amount?: string;
  size?: string;
  leverage?: number;
  marginMode?: "cross" | "isolated";
  limitPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  orderId?: string;
  assetIndex?: number;
  fromToken?: TokenIdentifierDto;
  [key: string]: any;
}

interface PerpMarket {
  id: string;
  providerId: string;
  baseAsset: TokenDto;
  quoteAsset: TokenDto;
  leverageRange: [number, number];
  supportedMarginModes: ("isolated" | "cross")[];
  markPrice: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  volume24h: number;
  openInterest: number;
  makerFee?: string;
  takerFee?: string;
  fundingRate: string;
  fundingRateIntervalHours: number;
  metadata: {
    name: string;
    logoURI: string;
    url: string;
  };
}

interface PerpPosition {
  marketId: string;
  side: "long" | "short";
  size: string;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  marginMode: "cross" | "isolated";
  margin: number;
  unrealizedPnl: number;
  liquidationPrice?: number;
  pendingActions?: any[];
}

interface PerpOrder {
  marketId: string;
  side: "long" | "short";
  type: "limit" | "stop_loss" | "take_profit";
  size: string;
  limitPrice?: number;
  triggerPrice?: number;
  reduceOnly: boolean;
  createdAt: number;
  pendingActions?: any[];
}

interface PerpBalance {
  providerId: string;
  collateral: TokenDto;
  accountValue: number;
  usedMargin: number;
  availableBalance: number;
  unrealizedPnl: number;
}

interface ArgumentSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  default?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  label?: string;
  placeholder?: string;
  optionsRef?: string;
  options?: string[];
  properties?: Record<string, ArgumentSchemaProperty>;
  required?: string[];
  items?: ArgumentSchemaProperty;
}

interface ArgumentSchema {
  type?: string;
  properties?: Record<string, ArgumentSchemaProperty>;
  required?: string[];
  notes?: string;
}

interface ApiTransaction {
  id: string;
  network: string;
  chainId: string;
  type: string;
  status: PerpTransactionStatus;
  address: string;
  args?: ActionArguments;
  signingFormat?: SigningFormat;
  signablePayload?: string | Record<string, any>;
  transactionHash?: string;
  link?: string;
  details?: {
    providerId?: string;
    fillPrice?: number;
    [key: string]: any;
  };
}

interface ApiAction {
  id: string;
  providerId: string;
  action: PerpActionTypes;
  status: string;
  transactions: ApiTransaction[];
  signedMetadata?: string;
}

// ===== Signed Metadata Verification =====

const SIGNED_METADATA_PUBLIC_KEY =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEh6fd7pBTiuxafsrxZh948/44hQoLtVqDac6QRrgAYgTA5gO9vLrCLoAo1MAgG4NMjZtQ/ESxj0VA4bk7UTVAfQ==" +
  "\n-----END PUBLIC KEY-----";

function verifySignedMetadata(hex: string, summary?: Record<string, any>): boolean {
  try {
    const crypto = require("crypto");
    const buf = Buffer.from(hex, "hex");
    const sigIdx = buf.indexOf(0x15);
    if (sigIdx < 0) return false;
    const metadata = buf.subarray(0, sigIdx);
    const signature = buf.subarray(sigIdx + 2, sigIdx + 2 + buf[sigIdx + 1]);
    const valid = crypto.createVerify("SHA256").update(metadata).verify(SIGNED_METADATA_PUBLIC_KEY, signature);
    if (!valid) return false;

    // Parse and verify all TLV fields
    let i = 0;
    while (i < metadata.length) {
      const tag = metadata[i], len = metadata[i + 1], val = metadata.subarray(i + 2, i + 2 + len);
      if (tag === 0x01 && val[0] !== 0x2b) return false;                            // structure_type
      if (tag === 0x02 && val[0] !== 0x01) return false;                             // version
      if (tag === 0xd0 && val[0] > 0x03) return false;                              // action_type (0-3)
      if (summary && tag === 0xd1 && val.readUInt32BE(0) !== summary.assetId) return false;  // asset_id
      if (summary && tag === 0x24 && val.toString("utf8") !== summary.asset) return false;   // asset_ticker
      i += 2 + len;
    }
    return true;
  } catch {
    return false;
  }
}

// ===== API Client =====

class PerpsApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey.trim();
  }

  private async makeRequest<T>(method: string, path: string, body?: any): Promise<T> {
    return request<T>(this.baseUrl, this.apiKey, method, path, body);
  }

  async getProviders(): Promise<any[]> {
    return this.makeRequest<any[]>("GET", "/v1/providers");
  }

  async getProvider(providerId: string): Promise<any> {
    return this.makeRequest<any>("GET", `/v1/providers/${providerId}`);
  }

  async getMarkets(
    providerId?: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: PerpMarket[]; total: number; offset: number; limit: number }> {
    const params = new URLSearchParams();
    if (providerId) params.append("providerId", providerId);
    if (limit) params.append("limit", limit.toString());
    if (offset) params.append("offset", offset.toString());

    const query = params.toString();
    return this.makeRequest<{
      items: PerpMarket[];
      total: number;
      offset: number;
      limit: number;
    }>("GET", `/v1/markets${query ? `?${query}` : ""}`);
  }

  async getPositions(providerId: string, address: string): Promise<PerpPosition[]> {
    return this.makeRequest<PerpPosition[]>("POST", "/v1/positions", {
      providerId,
      address,
    });
  }

  async getOrders(providerId: string, address: string): Promise<PerpOrder[]> {
    return this.makeRequest<PerpOrder[]>("POST", "/v1/orders", {
      providerId,
      address,
    });
  }

  async getBalances(providerId: string, address: string): Promise<PerpBalance> {
    return this.makeRequest<PerpBalance>("POST", "/v1/balances", {
      providerId,
      address,
    });
  }

  async createAction(
    providerId: string,
    action: PerpActionTypes,
    address: string,
    args: any,
  ): Promise<ApiAction> {
    return this.makeRequest<ApiAction>("POST", "/v1/actions", {
      providerId,
      action,
      address,
      args,
    });
  }

  async getAction(actionId: string): Promise<ApiAction> {
    return this.makeRequest<ApiAction>("GET", `/v1/actions/${actionId}`);
  }

  async submitTransaction(transactionId: string, signedPayload: string): Promise<ApiTransaction> {
    return this.makeRequest<ApiTransaction>("POST", `/v1/transactions/${transactionId}/submit`, {
      signedPayload,
    });
  }

  async getArguments(
    providerId: string,
  ): Promise<Partial<Record<PerpActionTypes, ArgumentSchema>>> {
    const provider = await this.getProvider(providerId);
    return provider.argumentSchemas || {};
  }
}

// ===== Helper Functions =====

/**
 * Auto-generate CLI prompts from JSON Schema
 */
async function promptFromSchema(
  schema: ArgumentSchema,
  skipFields: string[] = [],
  context?: { market?: PerpMarket },
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const [name, prop] of Object.entries(properties)) {
    if (skipFields.includes(name)) continue;

    const isRequired = required.includes(name);
    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type || "string";

    let message = prop.label || name;
    if (prop.description) message += ` - ${prop.description}`;
    if (!isRequired) message += " (optional)";

    if (!isRequired && prop.default !== undefined) {
      result[name] = prop.default;
      continue;
    }

    if (prop.enum || prop.options) {
      const choices = prop.options || (prop.enum as string[]);
      const response: any = await Enquirer.prompt({
        type: "select",
        name: "value",
        message,
        choices,
        initial: prop.default,
      } as any);
      result[name] = response.value;
    } else if (type === "boolean") {
      const response: any = await Enquirer.prompt({
        type: "confirm",
        name: "value",
        message,
        initial: prop.default as boolean,
      } as any);
      result[name] = response.value;
    } else if (type === "object" && prop.properties) {
      console.log(`\n${prop.label || name}:`);
      result[name] = await promptFromSchema(prop as ArgumentSchema, [], context);
    } else if (type === "array") {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message: `${message} (comma-separated or JSON array)`,
        initial: prop.default ? JSON.stringify(prop.default) : "",
      } as any);

      if (response.value) {
        try {
          result[name] = response.value.includes("[")
            ? JSON.parse(response.value)
            : response.value.split(",").map((v: string) => v.trim());
        } catch {
          result[name] = response.value.split(",").map((v: string) => v.trim());
        }
      }
    } else {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message,
        initial: prop.default as string,
        validate: (input: string) => {
          if (!isRequired && input === "") return true;
          if (isRequired && input === "") return `${prop.label || name} is required`;

          if (type === "number" || type === "integer") {
            const num = Number.parseFloat(input);
            if (Number.isNaN(num)) return "Must be a valid number";
            if (type === "integer" && !Number.isInteger(num)) return "Must be an integer";
            if (prop.minimum !== undefined && num < prop.minimum)
              return `Must be at least ${prop.minimum}`;
            if (prop.maximum !== undefined && num > prop.maximum)
              return `Must be at most ${prop.maximum}`;
          }

          if (prop.minLength !== undefined && input.length < prop.minLength) {
            return `Must be at least ${prop.minLength} characters`;
          }

          return true;
        },
      } as any);

      if (response.value === "" && !isRequired) continue;

      result[name] =
        type === "number" || type === "integer"
          ? Number.parseFloat(response.value)
          : response.value;
    }
  }

  return result;
}

/**
 * Sign a transaction
 */
async function signTransaction(tx: ApiTransaction, wallet: HDNodeWallet): Promise<string> {
  if (!tx.signablePayload) throw new Error("Nothing to sign");

  if (tx.signingFormat === SigningFormat.EIP712_TYPED_DATA) {
    const { domain, types, message } = tx.signablePayload as any;

    // ethers v6 handles EIP712Domain separately via the domain parameter —
    // strip it from types to avoid "ambiguous primary types" errors
    const { EIP712Domain: _, ...signingTypes } = types;
    return wallet.signTypedData(domain, signingTypes, message);
  }

  // Regular transaction
  return wallet.signTransaction(tx.signablePayload as any);
}

/**
 * Process and submit transactions
 */
async function processTransactions(
  transactions: ApiTransaction[],
  wallet: HDNodeWallet,
  apiClient: PerpsApiClient,
): Promise<void> {
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.status === PerpTransactionStatus.CONFIRMED) continue;

    console.log(`${tx.type} (Transaction ID: ${tx.id})...`);

    const status = tx.status as PerpTransactionStatus;
    if (
      status === PerpTransactionStatus.BROADCASTED ||
      status === PerpTransactionStatus.CONFIRMED
    ) {
      continue;
    }

    try {
      const signature = await signTransaction(tx, wallet);
      const result = await apiClient.submitTransaction(tx.id, signature);

      if (result.status === PerpTransactionStatus.CONFIRMED) {
        console.log(`Confirmed immediately (Transaction ID: ${tx.id})`);
        if (result.transactionHash) {
          console.log(`   Hash: ${result.transactionHash}`);
        }
        if (result.link) {
          console.log(`   Link: ${result.link}`);
        }
        if (result.details && result.details.providerId === "hyperliquid") {
          if ("fillPrice" in result.details && result.details.fillPrice) {
            console.log(`   Fill Price: $${result.details.fillPrice}`);
          }
        }
      } else if (result.status === PerpTransactionStatus.BROADCASTED) {
        console.log(`Order placed (Transaction ID: ${tx.id})`);
        if (result.transactionHash) {
          console.log(`   Hash: ${result.transactionHash}`);
        }
        if (result.link) {
          console.log(`   Link: ${result.link}`);
        }
        console.log("   Status: On the order book");
      } else {
        console.log(`Transaction status: ${result.status} (Transaction ID: ${tx.id})`);
        if (result.transactionHash) {
          console.log(`   Hash: ${result.transactionHash}`);
        }
        if (result.link) {
          console.log(`   Link: ${result.link}`);
        }
      }

    } catch (error: any) {
      console.error(`Failed to submit transaction ${tx.id}: ${error.message}`);
      throw error;
    }

    if (i < transactions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// ===== Main Function =====

async function main() {
  try {
    console.log("\nYield.xyz Perpetuals Trading API\n");

    // Get API configuration
    const apiUrl = process.env.PERPS_API_URL || "https://perps.yield.xyz";
    const apiKey = process.env.PERPS_API_KEY;

    if (!apiKey) {
      console.log("Error: PERPS_API_KEY environment variable is required");
      return;
    }

    const apiClient = new PerpsApiClient(apiUrl, apiKey);
    console.log(`API URL: ${apiUrl}\n`);

    // Initialize wallet
    const mnemonic = process.env.MNEMONIC;
    if (!mnemonic) {
      console.log("MNEMONIC environment variable is required");
      return;
    }

    const walletIndex = Number.parseInt(process.env.WALLET_INDEX || "0");
    const derivationPath = `m/44'/60'/0'/0/${walletIndex}`;
    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
    const address = wallet.address;
    console.log(`Address: ${address}\n`);

    let providers: any[];
    try {
      providers = await apiClient.getProviders();
    } catch (error: any) {
      console.error(`Failed to fetch providers: ${error.message}`);
      return;
    }

    if (providers.length === 0) {
      console.log("No perpetuals providers available");
      return;
    }

    let providerId: string;
    if (providers.length === 1) {
      providerId = providers[0].id;
      console.log(`Provider: ${providers[0].name} (${providers[0].network})\n`);
    } else {
      const providerChoices = providers.map((p) => ({
        name: `${p.name} (${p.network})`,
        value: p.id,
      }));

      const result: any = await Enquirer.prompt({
        type: "select",
        name: "selected",
        message: "Select perpetuals provider:",
        choices: providerChoices,
      });

      const selected = providerChoices.find((c) => c.name === result.selected);
      if (!selected) throw new Error("Invalid provider selected");
      providerId = selected.value;
    }

    console.log("Fetching markets...\n");
    const markets = await fetchAllMarkets(apiClient, providerId);
    console.log(`Loaded ${markets.length} markets\n`);

    while (true) {
      const mainChoice = await showMainMenu(apiClient, providerId, address);

      if (mainChoice === "exit") {
        console.log("\nGoodbye!\n");
        break;
      }

      try {
        switch (mainChoice) {
          case "balance":
            await showBalance(apiClient, providerId, address);
            break;
          case "positions":
            await showPositions(apiClient, providerId, address, wallet);
            break;
          case "markets":
            await showMarkets(markets);
            break;
          case "trade":
            await executeTrade(apiClient, providerId, address, wallet, markets);
            break;
          case "fund":
            await executeAccountAction(
              apiClient,
              providerId,
              address,
              wallet,
              PerpActionTypes.FUND,
            );
            break;
          case "withdraw":
            await executeAccountAction(
              apiClient,
              providerId,
              address,
              wallet,
              PerpActionTypes.WITHDRAW,
            );
            break;
          default:
            console.log(`Unknown action: ${mainChoice}`);
        }
      } catch (error: any) {
        console.error("\nError executing action:", error?.message || error);
        console.error("\nFull error:", error);
      }

      console.log(`\n${"─".repeat(60)}\n`);

      await Enquirer.prompt({
        type: "input",
        name: "continue",
        message: "Press Enter to continue...",
      });
    }
  } catch (e: any) {
    console.error("Fatal Error:", e?.message || e);
    console.error("\nFull error:", e);
  }
}

// ===== Menu Functions =====

async function showMainMenu(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
): Promise<string> {
  let balance: PerpBalance;
  let positions: PerpPosition[];
  let orders: PerpOrder[];

  try {
    [balance, positions, orders] = await Promise.all([
      apiClient.getBalances(providerId, address).catch((err) => {
        throw new Error(`Failed to fetch balances: ${err.message}`);
      }),
      apiClient.getPositions(providerId, address).catch((err) => {
        throw new Error(`Failed to fetch positions: ${err.message}`);
      }),
      apiClient.getOrders(providerId, address).catch((err) => {
        throw new Error(`Failed to fetch orders: ${err.message}`);
      }),
    ]);
  } catch (error: any) {
    console.error("\nError fetching portfolio data:");
    console.error(`  ${error.message}`);
    if (error.details) {
      console.error("  API Error Details:", JSON.stringify(error.details, null, 2));
    }
    throw error;
  }

  const pnlPrefix = balance.unrealizedPnl > 0 ? "+" : balance.unrealizedPnl < 0 ? "-" : "";

  console.log("Account Summary");
  console.log("─".repeat(60));
  console.log(
    `Account Value: $${balance.accountValue.toLocaleString()} ${balance.collateral.symbol}`,
  );
  console.log(
    `Available: $${balance.availableBalance.toLocaleString()} | Used: $${balance.usedMargin.toLocaleString()}`,
  );
  console.log(`Unrealized PnL: ${pnlPrefix}$${Math.abs(balance.unrealizedPnl).toFixed(2)}`);
  console.log(`Positions: ${positions.length} | Orders: ${orders.length}`);
  console.log("─".repeat(60));
  console.log("");

  const choices = [
    "View Balance Details",
    "View Positions & Orders",
    "View Markets",
    "Execute Trade / Action",
    "Deposit Funds",
    "Withdraw Funds",
    "Exit",
  ];

  const { action }: any = await Enquirer.prompt({
    type: "select",
    name: "action",
    message: "What would you like to do?",
    choices,
  });

  const actionMap: Record<string, string> = {
    "View Balance Details": "balance",
    "View Positions & Orders": "positions",
    "View Markets": "markets",
    "Execute Trade / Action": "trade",
    "Deposit Funds": "fund",
    "Withdraw Funds": "withdraw",
    Exit: "exit",
  };

  return actionMap[action] || action;
}

async function showBalance(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
): Promise<void> {
  console.log("\nBalance Details\n");
  const balance = await apiClient.getBalances(providerId, address);

  const pnlPrefix = balance.unrealizedPnl > 0 ? "+" : "-";

  console.log("Account Summary:");
  console.log("─".repeat(50));
  console.log(`Collateral: ${balance.collateral.symbol} (${balance.collateral.name})`);
  console.log(`Account Value: $${balance.accountValue.toLocaleString()}`);
  console.log(`Used Margin: $${balance.usedMargin.toLocaleString()}`);
  console.log(`Available Balance: $${balance.availableBalance.toLocaleString()}`);
  console.log(`Unrealized PnL: ${pnlPrefix}$${Math.abs(balance.unrealizedPnl).toFixed(2)}`);
  console.log("─".repeat(50));
  console.log("");
}

async function showPositions(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nPositions & Orders\n");

  const [positions, orders] = await Promise.all([
    apiClient.getPositions(providerId, address),
    apiClient.getOrders(providerId, address),
  ]);

  if (positions.length === 0 && orders.length === 0) {
    console.log("No open positions or orders\n");
    return;
  }

  if (positions.length > 0) {
    console.log(`${positions.length} Open Position(s):\n`);

    positions.forEach((pos: PerpPosition, i: number) => {
      const pnlPrefix = pos.unrealizedPnl > 0 ? "+" : "-";
      const sizeUsd = Number.parseFloat(pos.size) * pos.markPrice;
      console.log(`Position ${i + 1}:`);
      console.log(`  Market: ${pos.marketId}`);
      console.log(`  Side: ${pos.side.toUpperCase()}`);
      console.log(
        `  Size: ${pos.size} ($${sizeUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
      );
      console.log(`  Entry Price: $${pos.entryPrice.toLocaleString()}`);
      console.log(`  Mark Price: $${pos.markPrice.toLocaleString()}`);
      console.log(
        `  Leverage: ${pos.leverage}x (${pos.marginMode === "cross" ? "Cross" : "Isolated"})`,
      );
      console.log(`  Margin: $${pos.margin.toLocaleString()}`);
      console.log(`  Unrealized PnL: ${pnlPrefix}$${Math.abs(pos.unrealizedPnl).toFixed(2)}`);
      if (pos.liquidationPrice) {
        console.log(`  Liquidation Price: $${pos.liquidationPrice.toLocaleString()}`);
      }
      console.log("");
    });
  }

  if (orders.length > 0) {
    console.log(`${orders.length} Open Order(s):\n`);

    orders.forEach((order: any, i: number) => {
      const typeLabel =
        order.type === "stop_loss"
          ? "[Stop Loss]"
          : order.type === "take_profit"
            ? "[Take Profit]"
            : "[Order]";
      console.log(`${typeLabel} Order ${i + 1}:`);
      console.log(`  Market: ${order.marketId}`);
      console.log(`  Type: ${order.type.replace("_", " ").toUpperCase()}`);
      console.log(`  Side: ${order.side.toUpperCase()}`);
      console.log(`  Size: ${order.size}`);
      if (order.triggerPrice) {
        console.log(`  Trigger Price: $${order.triggerPrice.toLocaleString()}`);
      }
      if (order.limitPrice && order.limitPrice !== order.triggerPrice) {
        console.log(`  Limit Price: $${order.limitPrice.toLocaleString()}`);
      }
      console.log(`  Reduce Only: ${order.reduceOnly ? "Yes" : "No"}`);
      console.log("");
    });
  }

  // Ask if user wants to manage positions/orders
  const { manage }: any = await Enquirer.prompt({
    type: "confirm",
    name: "manage",
    message: "Would you like to manage a position or order?",
    initial: false,
  });

  if (manage) {
    await managePositionOrOrder(apiClient, providerId, address, wallet, positions, orders);
  }
}

async function managePositionOrOrder(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  positions: PerpPosition[],
  orders: PerpOrder[],
): Promise<void> {
  const items: Array<{
    display: string;
    type: "position" | "order";
    data: PerpPosition | PerpOrder;
  }> = [];

  for (const pos of positions) {
    items.push({
      display: `[Position] ${pos.marketId} - ${pos.side.toUpperCase()} ${pos.size} @ ${pos.leverage}x`,
      type: "position",
      data: pos,
    });
  }

  for (const order of orders) {
    items.push({
      display: `[Order] ${order.marketId} - ${order.type.toUpperCase()} ${order.side.toUpperCase()} ${order.size}`,
      type: "order",
      data: order,
    });
  }

  const { selected }: any = await Enquirer.prompt({
    type: "select",
    name: "selected",
    message: "Select position or order to manage:",
    choices: items.map((item) => item.display),
  });

  const selectedItem = items.find((item) => item.display === selected);
  if (!selectedItem) {
    throw new Error("Invalid selection");
  }

  if (selectedItem.type === "position") {
    await managePosition(apiClient, providerId, address, wallet, selectedItem.data as PerpPosition);
  } else {
    await manageOrder(apiClient, providerId, address, wallet, selectedItem.data as PerpOrder);
  }
}

async function managePosition(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  position: PerpPosition,
): Promise<void> {
  if (!position.pendingActions || position.pendingActions.length === 0) {
    console.log("\nNo actions available for this position\n");
    return;
  }

  const schemas = await apiClient.getArguments(providerId);
  const positionActions = position.pendingActions.filter((action: any) => {
    const schema = schemas[action.type as PerpActionTypes];
    return schema?.required?.includes("marketId");
  });

  if (positionActions.length === 0) {
    console.log("\nNo position-specific actions available\n");
    return;
  }

  const actionChoices = positionActions.map((action: any) => action.label);

  const { selectedActionLabel }: any = await Enquirer.prompt({
    type: "select",
    name: "selectedActionLabel",
    message: "Select action:",
    choices: actionChoices,
  });

  const selectedAction = positionActions.find((a: any) => a.label === selectedActionLabel);
  if (!selectedAction) {
    throw new Error("Invalid action selected");
  }

  await executeAction(apiClient, providerId, address, wallet, {
    action: selectedAction,
    context: { market: { markPrice: position.markPrice } },
    summaryLabel: `Position: ${position.marketId}`,
  });
}

async function manageOrder(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  order: PerpOrder,
): Promise<void> {
  if (!order.pendingActions || order.pendingActions.length === 0) {
    console.log("\nNo actions available for this order\n");
    return;
  }

  const actionChoices = order.pendingActions.map((action: any) => action.label);

  const { selectedAction }: any = await Enquirer.prompt({
    type: "select",
    name: "selectedAction",
    message: "Select action:",
    choices: actionChoices,
  });

  const action = order.pendingActions.find((a: any) => a.label === selectedAction);
  if (!action) {
    throw new Error("Invalid action selected");
  }

  await executeAction(apiClient, providerId, address, wallet, {
    action,
    summaryLabel: `Order: ${order.marketId} - ${order.type}`,
  });
}

async function fetchAllMarkets(
  apiClient: PerpsApiClient,
  providerId: string,
): Promise<PerpMarket[]> {
  const limit = 100;
  const firstPage = await apiClient.getMarkets(providerId, limit, 0);
  const totalPages = Math.ceil(firstPage.total / limit);

  if (totalPages === 1) {
    return firstPage.items;
  }

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) =>
    apiClient.getMarkets(providerId, limit, (i + 1) * limit),
  );

  const results = await Promise.all(remainingPages);
  return [firstPage, ...results].flatMap((r) => r.items);
}

async function showMarkets(markets: PerpMarket[]): Promise<void> {
  console.log("\nMarkets\n");
  console.log(`Displaying ${markets.length} markets\n`);

  const sortedMarkets = [...markets].sort(
    (a: PerpMarket, b: PerpMarket) => b.volume24h - a.volume24h,
  );

  console.log("Markets (sorted by volume):");
  console.log("─".repeat(120));
  console.log(
    `${
      "Symbol".padEnd(10) +
      "Mark Price".padEnd(15) +
      "24h Change".padEnd(12) +
      "24h Volume".padEnd(15)
    }Funding Rate`,
  );
  console.log("─".repeat(120));

  for (const market of sortedMarkets) {
    const changePrefix = market.priceChangePercent24h >= 0 ? "+" : "";
    console.log(
      `${
        market.baseAsset.symbol.padEnd(10) +
        `$${market.markPrice.toFixed(2)}`.padEnd(15) +
        `${changePrefix}${market.priceChangePercent24h.toFixed(2)}%`.padEnd(12) +
        `$${(market.volume24h / 1000000).toFixed(2)}M`.padEnd(15)
      }${(Number.parseFloat(market.fundingRate) * 100).toFixed(4)}%`,
    );
  }

  console.log("─".repeat(120));
  console.log("");
}

async function executeTrade(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  markets: PerpMarket[],
): Promise<void> {
  console.log("\nExecute Trade\n");

  console.log("Fetching data...\n");
  const [schemas, positions] = await Promise.all([
    apiClient.getArguments(providerId),
    apiClient.getPositions(providerId, address),
  ]);

  // Sort markets by volume for better defaults in autocomplete
  const sortedMarkets = [...markets].sort((a, b) => b.volume24h - a.volume24h);

  const choices = sortedMarkets.map((m) => ({
    display: `${m.baseAsset.symbol} ($${m.markPrice.toFixed(2)}) - ${m.leverageRange[1]}x max`,
    market: m,
  }));

  const { selection }: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "selection",
    message: "Select market (type to search):",
    choices: choices.map((c) => c.display),
  });

  const selected = choices.find((c) => c.display === selection);
  if (!selected) {
    throw new Error(`Market not found: ${selection}`);
  }

  const market = selected.market;
  const existingPosition = positions.find((p) => p.marketId === market.id);

  if (existingPosition) {
    const sizeUsd = Number.parseFloat(existingPosition.size) * existingPosition.markPrice;
    console.log("\nCurrent Position:");
    console.log(`  Side: ${existingPosition.side.toUpperCase()}`);
    console.log(
      `  Size: ${existingPosition.size} ($${sizeUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`,
    );
    console.log(`  Entry: $${existingPosition.entryPrice.toLocaleString()}`);
    console.log(`  Mark: $${existingPosition.markPrice.toLocaleString()}`);
    console.log(
      `  Leverage: ${existingPosition.leverage}x (${existingPosition.marginMode === "cross" ? "Cross" : "Isolated"})`,
    );
    console.log(`  PnL: $${existingPosition.unrealizedPnl.toLocaleString()}`);
    console.log("");
  }

  const availableActions = Object.keys(schemas).filter((type) => {
    const actionType = type as PerpActionTypes;
    const schema = schemas[actionType];

    if (!schema?.required?.includes("marketId")) {
      return false;
    }

    return !POSITION_ONLY_ACTIONS.includes(actionType) || !!existingPosition;
  }) as PerpActionTypes[];

  const actionChoices = availableActions.map((type) => ACTION_LABELS[type]);

  const { action }: any = await Enquirer.prompt({
    type: "select",
    name: "action",
    message: "Select action:",
    choices: actionChoices,
  });

  const actionType = availableActions.find((type) => ACTION_LABELS[type] === action);
  if (!actionType) throw new Error(`Invalid action selected: ${action}`);

  const schema = schemas[actionType];
  if (!schema) throw new Error(`Schema not found for action: ${actionType}`);

  if (schema.notes) {
    console.log(`\nNote: ${schema.notes}\n`);
  }

  const args = { marketId: market.id };
  const collected = await promptFromSchema(schema, ["marketId"], { market });
  Object.assign(args, collected);

  const { confirm }: any = await Enquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: "Proceed?",
  });

  if (!confirm) {
    console.log("Cancelled\n");
    return;
  }

  console.log("\nCreating action via API...\n");
  const actionResponse = await apiClient.createAction(providerId, actionType, address, args);

  // Verify signed metadata if present on the action response
  if (actionResponse.signedMetadata) {
    const metadataValid = verifySignedMetadata(actionResponse.signedMetadata);
    console.log(`   Signed Metadata: ${metadataValid ? "✓ verified" : "✗ invalid"}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await processTransactions(actionResponse.transactions, wallet, apiClient);
  console.log("\nDone!\n");
}

async function executeAccountAction(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  actionType: PerpActionTypes,
): Promise<void> {
  console.log(`\n${ACTION_LABELS[actionType]}\n`);

  const schemas = await apiClient.getArguments(providerId);
  const schema = schemas[actionType];

  if (!schema) {
    console.log(`Schema not found for action: ${actionType}`);
    return;
  }

  if (schema.notes) {
    console.log(`Note: ${schema.notes}\n`);
  }

  await executeAction(apiClient, providerId, address, wallet, {
    action: { type: actionType, label: ACTION_LABELS[actionType], args: {} },
  });
}

async function executeAction(
  apiClient: PerpsApiClient,
  providerId: string,
  address: string,
  wallet: HDNodeWallet,
  options: {
    action: any;
    context?: any;
    summaryLabel?: string;
  },
): Promise<void> {
  const { action, context = {}, summaryLabel } = options;
  const actionArgs: any = { ...action.args };
  const preFilledFields = Object.keys(actionArgs);

  const schemas = await apiClient.getArguments(providerId);
  const actionType = action.type as PerpActionTypes;
  const schema = schemas[actionType];

  if (schema) {
    const collected = await promptFromSchema(schema, preFilledFields, context);
    Object.assign(actionArgs, collected);
  }

  console.log("\nAction Summary:");
  if (summaryLabel) {
    console.log(`  ${summaryLabel}`);
  }
  console.log(`  Action: ${action.label}`);

  for (const [key, value] of Object.entries(actionArgs)) {
    if (value !== undefined && key !== "marketId") {
      const formattedKey = key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase());
      const displayValue = typeof value === "object" ? JSON.stringify(value) : value;
      console.log(`  ${formattedKey}: ${displayValue}`);
    }
  }
  console.log("");

  const { confirm }: any = await Enquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: "Proceed with this action?",
  });

  if (!confirm) {
    console.log("Cancelled\n");
    return;
  }

  console.log("\nCreating action via API...\n");
  const actionResponse = await apiClient.createAction(providerId, actionType, address, actionArgs);

  // Verify signed metadata if present on the action response
  if (actionResponse.signedMetadata) {
    const metadataValid = verifySignedMetadata(actionResponse.signedMetadata);
    console.log(`   Signed Metadata: ${metadataValid ? "✓ verified" : "✗ invalid"}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  await processTransactions(actionResponse.transactions, wallet, apiClient);
  console.log("\nAction completed successfully!\n");
}

main().catch((error) => {
  console.error("Script failed with error:", error);
  process.exit(1);
});
