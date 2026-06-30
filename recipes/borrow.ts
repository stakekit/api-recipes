/**
 * Yield.xyz Borrow API Recipe
 *
 * This example demonstrates how to interact with lending/borrowing protocols
 * (Aave, Morpho Blue, Spark, etc.) via the Yield.xyz Borrow API using ethers.js
 * for transaction signing.
 */

import "cross-fetch/polyfill";
import * as dotenv from "dotenv";
import Enquirer from "enquirer";
import { HDNodeWallet } from "ethers";
import { broadcastSignedTx, getProvider, isApiBroadcastFailure } from "../utils/evm-nonce";
import { request } from "../utils/requests";

dotenv.config();

if (!process.env.MNEMONIC || !process.env.BORROW_API_KEY) {
  console.error("Error: MNEMONIC and BORROW_API_KEY environment variables are required");
  process.exit(1);
}

// ===== Type Definitions =====

enum BorrowActionType {
  SUPPLY = "supply",
  BORROW = "borrow",
  REPAY = "repay",
  WITHDRAW = "withdraw",
  ENABLE_COLLATERAL = "enableCollateral",
  DISABLE_COLLATERAL = "disableCollateral",
}

const ACTION_LABELS: Record<BorrowActionType, string> = {
  [BorrowActionType.SUPPLY]: "Supply",
  [BorrowActionType.BORROW]: "Borrow",
  [BorrowActionType.REPAY]: "Repay",
  [BorrowActionType.WITHDRAW]: "Withdraw",
  [BorrowActionType.ENABLE_COLLATERAL]: "Enable Collateral",
  [BorrowActionType.DISABLE_COLLATERAL]: "Disable Collateral",
};

enum TransactionStatus {
  NOT_FOUND = "NOT_FOUND",
  CREATED = "CREATED",
  BLOCKED = "BLOCKED",
  WAITING_FOR_SIGNATURE = "WAITING_FOR_SIGNATURE",
  SIGNED = "SIGNED",
  BROADCASTED = "BROADCASTED",
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
  SKIPPED = "SKIPPED",
}

enum SigningFormat {
  EVM_TRANSACTION = "EVM_TRANSACTION",
  EIP712_TYPED_DATA = "EIP712_TYPED_DATA",
  SOLANA_TRANSACTION = "SOLANA_TRANSACTION",
  COSMOS_TRANSACTION = "COSMOS_TRANSACTION",
}

interface TokenDto {
  address?: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
}

interface CollateralTokenDto {
  token: TokenDto;
  priceUsd: string;
  ltv: string;
  liquidationThreshold: string;
  liquidationPenalty: string;
  supplyRate: string;
}

interface IntegrationMetadataDto {
  description: string;
  externalLink: string;
  logoURI: string;
}

interface ArgumentSchemaPropertyDto {
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
  properties?: Record<string, ArgumentSchemaPropertyDto>;
  required?: string[];
  items?: ArgumentSchemaPropertyDto;
  additionalProperties?: any;
}

interface ArgumentSchemaDto {
  type?: string;
  properties?: Record<string, ArgumentSchemaPropertyDto>;
  required?: string[];
  additionalProperties?: any;
  notes?: string;
}

interface ActionDefinitionDto {
  id: BorrowActionType;
  label: string;
  schema: ArgumentSchemaDto;
}

interface IntegrationDto {
  id: string;
  providerId: string;
  name: string;
  networks: string[];
  metadata: IntegrationMetadataDto;
  actions: ActionDefinitionDto[];
}

interface MarketDto {
  id: string;
  integrationId: string;
  network: string;
  type: "pool" | "isolated";
  poolAddress: string;
  loanToken: TokenDto;
  collateralTokens: CollateralTokenDto[];
  borrowRate: string;
  totalSupply: string;
  totalSupplyRaw: string;
  totalBorrow: string;
  totalBorrowRaw: string;
  availableLiquidity: string;
  availableLiquidityRaw: string;
  utilizationRate: string;
  loanTokenPriceUsd: string;
  isBorrowEnabled: boolean;
}

interface PendingActionDto {
  type: BorrowActionType;
  label: string;
  args: ArgumentsDto;
}

interface SupplyBalanceDto {
  marketId: string;
  tokenAddress: string;
  tokenSymbol: string;
  balance: string;
  balanceRaw: string;
  balanceUsd: string;
  apy: string;
  isCollateral: boolean;
  pendingActions: PendingActionDto[];
}

interface DebtBalanceDto {
  marketId: string;
  tokenAddress: string;
  tokenSymbol: string;
  balance: string;
  balanceRaw: string;
  balanceUsd: string;
  apy: string;
  pendingActions: PendingActionDto[];
}

interface PositionDto {
  address: string;
  integrationId: string;
  network: string;
  totalSuppliedUsd: string;
  totalBorrowedUsd: string;
  netWorthUsd: string;
  healthFactor: string | null;
  currentLtv: string;
  availableToBorrowUsd: string;
  netApy: string;
  supplyBalances: SupplyBalanceDto[];
  debtBalances: DebtBalanceDto[];
}

interface ArgumentsDto {
  amount?: string;
  amountRaw?: string;
  tokenAddress?: string;
  collateralTokenAddress?: string;
  collateralAmount?: string;
  collateralAmountRaw?: string;
  marketId?: string;
  [key: string]: any;
}

interface TransactionDto {
  id: string;
  network: string;
  chainId: string;
  type: string;
  status: TransactionStatus;
  address: string;
  signingFormat?: SigningFormat;
  signablePayload?: string | Record<string, any>;
}

interface ActionMetadataDto {
  currentHealthFactor: string | null;
  predictedHealthFactor: string | null;
  currentLtv: string;
  predictedLtv: string;
  liquidationThreshold: string;
  predictedTotalSupplyUsd: string;
  predictedTotalDebtUsd: string;
}

interface ActionDto {
  id: string;
  integrationId: string;
  action: BorrowActionType;
  address: string;
  status: string;
  transactions: TransactionDto[];
  hasNextStep: boolean;
  currentStep: number;
  totalSteps: number;
  rawArguments?: ArgumentsDto;
  metadata?: ActionMetadataDto;
  createdAt: string;
}

interface SubmitTransactionResponseDto {
  transactionHash?: string;
  link: string;
  status: TransactionStatus;
  error?: string;
  details?: any;
}

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

// ===== API Client =====

class BorrowApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey.trim();
  }

  private async makeRequest<T>(method: string, path: string, body?: any): Promise<T> {
    return request<T>(this.baseUrl, this.apiKey, method, path, body);
  }

  async getIntegrations(): Promise<IntegrationDto[]> {
    return this.makeRequest<IntegrationDto[]>("GET", "/v1/integrations");
  }

  async getIntegration(integrationId: string): Promise<IntegrationDto> {
    return this.makeRequest<IntegrationDto>("GET", `/v1/integrations/${integrationId}`);
  }

  async getMarkets(params?: {
    integrationId?: string;
    network?: string;
    limit?: number;
    offset?: number;
    scope?: "enabled" | "all";
  }): Promise<PaginatedResponse<MarketDto>> {
    const query = new URLSearchParams();
    if (params?.integrationId) query.append("integrationId", params.integrationId);
    if (params?.network) query.append("network", params.network);
    if (params?.limit !== undefined) query.append("limit", params.limit.toString());
    if (params?.offset !== undefined) query.append("offset", params.offset.toString());
    // The markets endpoint defaults to scope=enabled, which hides markets that
    // aren't enabled for your project. The recipe is a dev tool, so we opt into
    // the full list by default; action creation will still enforce enablement.
    query.append("scope", params?.scope ?? "all");

    const queryString = query.toString();
    return this.makeRequest<PaginatedResponse<MarketDto>>(
      "GET",
      `/v1/markets${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getMarket(marketId: string): Promise<MarketDto> {
    return this.makeRequest<MarketDto>("GET", `/v1/markets/${marketId}`);
  }

  async getPositions(
    integrationId: string,
    network: string,
    address: string,
  ): Promise<PositionDto> {
    const query = new URLSearchParams({ integrationId, network, address });
    return this.makeRequest<PositionDto>("GET", `/v1/positions?${query.toString()}`);
  }

  async createAction(body: {
    integrationId: string;
    action: BorrowActionType;
    address: string;
    args: ArgumentsDto;
  }): Promise<ActionDto> {
    return this.makeRequest<ActionDto>("POST", "/v1/actions", body);
  }

  async getAction(actionId: string): Promise<ActionDto> {
    return this.makeRequest<ActionDto>("GET", `/v1/actions/${actionId}`);
  }

  async stepAction(actionId: string): Promise<ActionDto> {
    return this.makeRequest<ActionDto>("POST", `/v1/actions/${actionId}/step`);
  }

  async getActions(params?: {
    offset?: number;
    limit?: number;
    address?: string;
    integrationId?: string;
    action?: BorrowActionType;
    status?: string;
  }): Promise<PaginatedResponse<ActionDto>> {
    const query = new URLSearchParams();
    if (params?.offset !== undefined) query.append("offset", params.offset.toString());
    if (params?.limit !== undefined) query.append("limit", params.limit.toString());
    if (params?.address) query.append("address", params.address);
    if (params?.integrationId) query.append("integrationId", params.integrationId);
    if (params?.action) query.append("action", params.action);
    if (params?.status) query.append("status", params.status);

    const queryString = query.toString();
    return this.makeRequest<PaginatedResponse<ActionDto>>(
      "GET",
      `/v1/actions${queryString ? `?${queryString}` : ""}`,
    );
  }

  async submitTransaction(
    transactionId: string,
    payload: { signedPayload?: string; transactionHash?: string },
  ): Promise<SubmitTransactionResponseDto> {
    return this.makeRequest<SubmitTransactionResponseDto>(
      "POST",
      `/v1/transactions/${transactionId}/submit`,
      payload,
    );
  }
}

// ===== Helper Functions =====

function formatUsd(value: string): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

function formatRate(value: string): string {
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  return `${(num * 100).toFixed(2)}%`;
}

function formatHealthFactor(value: string | null): string {
  if (value === null) return "N/A (no debt)";
  const num = Number.parseFloat(value);
  if (Number.isNaN(num)) return value;
  const indicator = num < 1 ? " [LIQUIDATABLE]" : num < 1.2 ? " [AT RISK]" : "";
  return `${num.toFixed(2)}${indicator}`;
}

async function promptFromSchema(
  schema: ArgumentSchemaDto,
  skipFields: string[] = [],
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
    if (!isRequired) message += " (optional, press Enter to skip)";

    // Surface defaults/placeholders as hints instead of pre-filling them, so
    // optional fields stay truly opt-in.
    const hints: string[] = [];
    if (prop.placeholder) hints.push(`example: ${prop.placeholder}`);
    if (prop.default !== undefined) hints.push(`default: ${prop.default}`);
    if (hints.length) message += ` [${hints.join(", ")}]`;

    if (prop.enum || prop.options) {
      const baseChoices = prop.options || (prop.enum as string[]);
      const skipChoice = "<skip>";
      const choices = isRequired ? baseChoices : [skipChoice, ...baseChoices];
      const response: any = await Enquirer.prompt({
        type: "select",
        name: "value",
        message,
        choices,
        initial: isRequired ? prop.default : skipChoice,
      } as any);
      if (!isRequired && response.value === skipChoice) continue;
      result[name] = response.value;
    } else if (type === "boolean") {
      if (isRequired) {
        const response: any = await Enquirer.prompt({
          type: "confirm",
          name: "value",
          message,
          initial: prop.default as boolean,
        } as any);
        result[name] = response.value;
      } else {
        const skipChoice = "<skip>";
        const response: any = await Enquirer.prompt({
          type: "select",
          name: "value",
          message,
          choices: [skipChoice, "true", "false"],
          initial: skipChoice,
        } as any);
        if (response.value === skipChoice) continue;
        result[name] = response.value === "true";
      }
    } else if (type === "object" && prop.properties) {
      console.log(`\n${prop.label || name}:`);
      result[name] = await promptFromSchema(prop as ArgumentSchemaDto, []);
    } else if (type === "array") {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message: `${message} (comma-separated or JSON array)`,
        initial: isRequired && prop.default ? JSON.stringify(prop.default) : "",
      } as any);

      if (!response.value) {
        if (!isRequired) continue;
      } else {
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
        initial: isRequired ? ((prop.placeholder || prop.default) as string) : undefined,
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

          if (prop.pattern && !new RegExp(prop.pattern).test(input)) {
            return `Must match pattern ${prop.pattern}`;
          }

          // Catch obvious "wrong field" mistakes (e.g. typing an amount into
          // tokenAddress) when the schema doesn't declare a pattern.
          if (!prop.pattern && /address(es)?$/i.test(name) && type !== "array") {
            if (!/^0x[a-fA-F0-9]{40}$/.test(input)) {
              return "Must be a valid Ethereum address (0x + 40 hex chars)";
            }
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

async function signTransaction(
  tx: TransactionDto,
  wallet: HDNodeWallet,
  evmPayloadOverride?: Record<string, any>,
): Promise<string> {
  if (!tx.signablePayload) throw new Error("Nothing to sign");

  if (tx.signingFormat === SigningFormat.EIP712_TYPED_DATA) {
    const typed =
      typeof tx.signablePayload === "string" ? JSON.parse(tx.signablePayload) : tx.signablePayload;
    const { domain, types, message } = typed;
    const { EIP712Domain: _, ...signingTypes } = types;
    return wallet.signTypedData(domain, signingTypes, message);
  }

  if (
    tx.signingFormat !== SigningFormat.EVM_TRANSACTION &&
    tx.signingFormat !== undefined
  ) {
    throw new Error(`Unsupported signing format: ${tx.signingFormat}`);
  }

  const txData =
    evmPayloadOverride ??
    (typeof tx.signablePayload === "string"
      ? JSON.parse(tx.signablePayload)
      : { ...tx.signablePayload });
  return wallet.signTransaction(txData);
}

function isZeroish(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "number") return v === 0;
  if (typeof v === "string") {
    if (v === "") return true;
    try {
      return BigInt(v) === 0n;
    } catch {
      return false;
    }
  }
  if (typeof v === "bigint") return v === 0n;
  return false;
}

function parseIntegerField(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v !== "") {
    return Number.parseInt(v, v.startsWith("0x") ? 16 : 10);
  }
  return undefined;
}

/**
 * Build a complete, signable EVM payload by enriching the API-supplied
 * `signablePayload` with any missing critical fields. The Yield.xyz API
 * sometimes hands back payloads with `chainId`, `nonce`, or fee fields left
 * unset/zero; signing those produces transactions the chain immediately
 * rejects ("transaction type not supported", "max fee per gas less than
 * block base fee", etc.). We patch them up here using `tx.chainId` and live
 * chain data so the signed tx is always broadcast-ready.
 */
async function enrichEvmPayload(
  tx: TransactionDto,
  walletAddress: string,
): Promise<Record<string, any>> {
  const payload: Record<string, any> =
    typeof tx.signablePayload === "string"
      ? JSON.parse(tx.signablePayload as string)
      : { ...(tx.signablePayload as Record<string, any>) };

  if (isZeroish(payload.chainId)) {
    const outerChainId = Number(tx.chainId);
    if (Number.isFinite(outerChainId) && outerChainId > 0) {
      console.log(`  Setting chainId ${outerChainId} (from tx.chainId)`);
      payload.chainId = outerChainId;
    }
  }

  const provider = getProvider(tx.network);
  if (!provider) return payload;

  try {
    const freshNonce = await provider.getTransactionCount(walletAddress, "pending");
    const apiNonce = parseIntegerField(payload.nonce);
    if (apiNonce === undefined) {
      console.log(`  Setting nonce ${freshNonce} (from chain)`);
    } else if (apiNonce !== freshNonce) {
      console.log(`  Overriding nonce ${apiNonce} → ${freshNonce} (from chain)`);
    }
    payload.nonce = freshNonce;
  } catch (err: any) {
    console.warn(`  Could not refresh nonce: ${err?.message || err}`);
  }

  const hasLegacyFee = !isZeroish(payload.gasPrice);
  const hasEip1559Fees =
    !isZeroish(payload.maxFeePerGas) && !isZeroish(payload.maxPriorityFeePerGas);
  if (!hasLegacyFee && !hasEip1559Fees) {
    try {
      const feeData = await provider.getFeeData();
      const apiType = parseIntegerField(payload.type);
      const canUseEip1559 = feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null;
      const wantEip1559 = apiType === 2 || (apiType === undefined && canUseEip1559);
      if (wantEip1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        payload.maxFeePerGas = feeData.maxFeePerGas.toString();
        payload.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.toString();
        payload.type = 2;
        payload.gasPrice = undefined;
        console.log(
          `  Setting fees (from chain): maxFeePerGas=${feeData.maxFeePerGas}, maxPriorityFeePerGas=${feeData.maxPriorityFeePerGas}`,
        );
      } else if (feeData.gasPrice) {
        payload.gasPrice = feeData.gasPrice.toString();
        payload.type = 0;
        payload.maxFeePerGas = undefined;
        payload.maxPriorityFeePerGas = undefined;
        console.log(`  Setting fees (from chain): gasPrice=${feeData.gasPrice}`);
      }
    } catch (err: any) {
      console.warn(`  Could not fetch fee data: ${err?.message || err}`);
    }
  }

  return payload;
}

async function processTransactions(
  transactions: TransactionDto[],
  wallet: HDNodeWallet,
  apiClient: BorrowApiClient,
  actionId: string,
): Promise<void> {
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.status === TransactionStatus.CONFIRMED || tx.status === TransactionStatus.SKIPPED) {
      console.log(
        `Step ${i + 1}/${transactions.length}: ${tx.type} (already ${tx.status.toLowerCase()})`,
      );
      continue;
    }

    console.log(`\nStep ${i + 1}/${transactions.length}: ${tx.type}`);

    if (!tx.signablePayload) {
      if (
        tx.status === TransactionStatus.BROADCASTED ||
        tx.status === TransactionStatus.PENDING ||
        tx.status === TransactionStatus.SIGNED
      ) {
        console.log(`  No local signature required (status: ${tx.status})`);
        continue;
      }
      throw new Error(`No signable payload for transaction ${tx.id} (status: ${tx.status})`);
    }

    try {
      const enrichedPayload =
        tx.signingFormat === undefined || tx.signingFormat === SigningFormat.EVM_TRANSACTION
          ? await enrichEvmPayload(tx, wallet.address)
          : undefined;

      console.log("Signing...");
      const signature = await signTransaction(tx, wallet, enrichedPayload);

      console.log("Submitting...");
      let result: SubmitTransactionResponseDto;
      try {
        result = await apiClient.submitTransaction(tx.id, { signedPayload: signature });
      } catch (submitErr: any) {
        // The backend's `/submit` calls an upstream RPC to broadcast. When
        // that upstream broadcast fails (e.g. a flaky public RPC), it
        // surfaces as a 5xx with an empty "Transaction broadcast failed: "
        // message. Recover by broadcasting via our own RPC and registering
        // the resulting hash with the API.
        if (!isApiBroadcastFailure(submitErr)) throw submitErr;
        console.warn(`  API broadcast failed: ${submitErr.message}`);
        console.warn("  Falling back to local broadcast via configured RPC...");
        const localHash = await broadcastSignedTx(signature, tx.network).catch((err) => {
          console.error(`  Local broadcast also failed: ${err?.message || err}`);
          return undefined;
        });
        if (!localHash) throw submitErr;
        console.log(`  Locally broadcast: ${localHash}`);
        result = await apiClient.submitTransaction(tx.id, { transactionHash: localHash });
      }

      if (result.transactionHash) console.log(`  Hash: ${result.transactionHash}`);
      if (result.link) console.log(`  Explorer: ${result.link}`);

      if (result.status === TransactionStatus.CONFIRMED) {
        console.log("  Confirmed!");
      } else if (
        result.status === TransactionStatus.BROADCASTED ||
        result.status === TransactionStatus.PENDING
      ) {
        console.log("  Waiting for confirmation...");
        let confirmed = false;
        let attempts = 0;
        const maxAttempts = 60;

        while (!confirmed && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const updatedAction = await apiClient.getAction(actionId);
            const updatedTx = updatedAction.transactions.find((t) => t.id === tx.id);

            if (updatedTx?.status === TransactionStatus.CONFIRMED) {
              console.log("\n  Confirmed!");
              confirmed = true;
            } else if (updatedTx?.status === TransactionStatus.FAILED) {
              throw new Error("Transaction failed on-chain");
            } else {
              process.stdout.write(".");
            }
          } catch (error: any) {
            if (error.message === "Transaction failed on-chain") throw error;
            process.stdout.write(".");
          }

          attempts++;
        }

        if (!confirmed) {
          throw new Error(`Transaction ${tx.id} confirmation timeout after ${maxAttempts * 2}s`);
        }
      } else {
        console.log(`  Status: ${result.status}`);
        if (result.error) console.error(`  Error: ${result.error}`);
        if (result.status === TransactionStatus.FAILED) {
          throw new Error(result.error || `Transaction ${tx.id} failed`);
        }
      }
    } catch (error: any) {
      console.error(`  Failed: ${error.message}`);
      throw error;
    }

    if (i < transactions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function processMultiStepAction(
  action: ActionDto,
  wallet: HDNodeWallet,
  apiClient: BorrowApiClient,
): Promise<void> {
  await processTransactions(action.transactions, wallet, apiClient, action.id);

  let currentAction = action;
  while (currentAction.hasNextStep) {
    console.log(
      `\nStep ${currentAction.currentStep} of ${currentAction.totalSteps} completed.`,
    );
    console.log("Fetching next step...\n");

    await new Promise((resolve) => setTimeout(resolve, 1000));
    currentAction = await apiClient.stepAction(currentAction.id);
    await processTransactions(currentAction.transactions, wallet, apiClient, currentAction.id);
  }
}

function displayActionMetadata(metadata: ActionMetadataDto): void {
  console.log("\n  Predicted Impact:");
  console.log(
    `    Health Factor: ${formatHealthFactor(metadata.currentHealthFactor)} → ${formatHealthFactor(metadata.predictedHealthFactor)}`,
  );
  console.log(`    LTV: ${formatRate(metadata.currentLtv)} → ${formatRate(metadata.predictedLtv)}`);
  console.log(`    Liquidation Threshold: ${formatRate(metadata.liquidationThreshold)}`);
  console.log(
    `    Total Supply: ${formatUsd(metadata.predictedTotalSupplyUsd)}`,
  );
  console.log(
    `    Total Debt: ${formatUsd(metadata.predictedTotalDebtUsd)}`,
  );
}

// ===== Main Function =====

async function main() {
  try {
    console.log("\nYield.xyz Borrow API\n");

    const apiUrl = process.env.BORROW_API_URL || "https://borrow.yield.xyz";
    const apiKey = process.env.BORROW_API_KEY as string;

    const apiClient = new BorrowApiClient(apiUrl, apiKey);
    console.log(`API URL: ${apiUrl}\n`);

    const mnemonic = process.env.MNEMONIC as string;

    const walletIndex = Number.parseInt(process.env.WALLET_INDEX ?? "0", 10);
    if (!Number.isInteger(walletIndex) || walletIndex < 0) {
      throw new Error("WALLET_INDEX must be a non-negative integer");
    }
    const derivationPath = `m/44'/60'/0'/0/${walletIndex}`;
    const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, derivationPath);
    const address = wallet.address;
    console.log(`Address: ${address}\n`);

    await selectIntegrationFlow(apiClient, address, wallet);
  } catch (e: any) {
    console.error("Fatal Error:", e?.message || e);
    throw e;
  }
}

// ===== Menu Functions =====

async function selectIntegrationFlow(
  apiClient: BorrowApiClient,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("Fetching integrations...\n");
  const integrations = await apiClient.getIntegrations();

  if (integrations.length === 0) {
    console.log("No integrations available");
    return;
  }

  while (true) {
    const integrationChoices = integrations.map((i) => ({
      name: `${i.name} (${i.id}) - ${i.networks.length} network(s)`,
      value: i,
    }));

    const { selectedIntegration }: any = await Enquirer.prompt({
      type: "select",
      name: "selectedIntegration",
      message: "Select integration:",
      choices: [...integrationChoices.map((c) => c.name), "Exit"],
    });

    if (selectedIntegration === "Exit") {
      console.log("\nGoodbye!\n");
      return;
    }

    const integration = integrationChoices.find((c) => c.name === selectedIntegration)?.value;
    if (!integration) throw new Error("Invalid integration selected");

    let network: string;
    if (integration.networks.length === 1) {
      network = integration.networks[0];
      console.log(`\nNetwork: ${network}\n`);
    } else {
      const { selectedNetwork }: any = await Enquirer.prompt({
        type: "select",
        name: "selectedNetwork",
        message: "Select network:",
        choices: integration.networks,
      });
      network = selectedNetwork;
    }

    await integrationMenu(apiClient, integration, network, address, wallet);
  }
}

async function integrationMenu(
  apiClient: BorrowApiClient,
  integration: IntegrationDto,
  network: string,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  const availableActions = integration.actions.map((a) => a.id);

  while (true) {
    console.log(`\n${"═".repeat(70)}`);
    console.log(`${integration.name} on ${network}`);
    console.log(`${"═".repeat(70)}`);

    if (integration.metadata?.description) {
      console.log(`${integration.metadata.description}\n`);
    }

    const choices: string[] = ["View Position", "Browse Markets"];

    for (const actionType of Object.values(BorrowActionType)) {
      if (availableActions.includes(actionType)) {
        choices.push(ACTION_LABELS[actionType]);
      }
    }

    choices.push("Back");

    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices,
    });

    if (action === "Back") return;

    try {
      if (action === "View Position") {
        await viewPosition(apiClient, integration, network, address, wallet);
      } else if (action === "Browse Markets") {
        await browseMarkets(apiClient, integration.id, network);
      } else {
        const actionType = Object.entries(ACTION_LABELS).find(([_, label]) => label === action);
        if (actionType) {
          await executeActionFlow(
            apiClient,
            integration,
            network,
            address,
            wallet,
            actionType[0] as BorrowActionType,
          );
        }
      }
    } catch (error: any) {
      console.error("\nError:", error?.message || error);
    }

    console.log(`\n${"─".repeat(60)}\n`);
  }
}

async function viewPosition(
  apiClient: BorrowApiClient,
  integration: IntegrationDto,
  network: string,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nFetching position...\n");

  const position = await apiClient.getPositions(integration.id, network, address);

  console.log(`${"═".repeat(70)}`);
  console.log(`${integration.name} on ${network} - Position`);
  console.log(`${"═".repeat(70)}\n`);

  console.log(`${"─".repeat(70)}`);
  console.log("Summary");
  console.log(`${"─".repeat(70)}`);
  console.log(`  Total Supplied:      ${formatUsd(position.totalSuppliedUsd)}`);
  console.log(`  Total Borrowed:      ${formatUsd(position.totalBorrowedUsd)}`);
  console.log(`  Net Worth:           ${formatUsd(position.netWorthUsd)}`);
  console.log(`  Health Factor:       ${formatHealthFactor(position.healthFactor)}`);
  console.log(`  Current LTV:         ${formatRate(position.currentLtv)}`);
  console.log(`  Available to Borrow: ${formatUsd(position.availableToBorrowUsd)}`);
  console.log(`  Net APY:             ${position.netApy}%`);

  if (position.supplyBalances.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("Supply Balances");
    console.log(`${"─".repeat(70)}`);

    for (const supply of position.supplyBalances) {
      const collateralTag = supply.isCollateral ? " [Collateral]" : "";
      console.log(
        `  ${supply.tokenSymbol}: ${supply.balance} (${formatUsd(supply.balanceUsd)}) - APY: ${supply.apy}%${collateralTag}`,
      );
      if (supply.pendingActions.length > 0) {
        const actionLabels = supply.pendingActions.map((a) => a.label).join(", ");
        console.log(`    Actions: ${actionLabels}`);
      }
    }
  }

  if (position.debtBalances.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    console.log("Debt Balances");
    console.log(`${"─".repeat(70)}`);

    for (const debt of position.debtBalances) {
      console.log(
        `  ${debt.tokenSymbol}: ${debt.balance} (${formatUsd(debt.balanceUsd)}) - APY: ${debt.apy}%`,
      );
      if (debt.pendingActions.length > 0) {
        const actionLabels = debt.pendingActions.map((a) => a.label).join(", ");
        console.log(`    Actions: ${actionLabels}`);
      }
    }
  }

  console.log();

  const allPendingActions: Array<{
    display: string;
    pendingAction: PendingActionDto;
    source: string;
  }> = [];

  for (const supply of position.supplyBalances) {
    for (const pa of supply.pendingActions) {
      allPendingActions.push({
        display: `[Supply] ${supply.tokenSymbol} - ${pa.label}`,
        pendingAction: pa,
        source: `${supply.tokenSymbol} supply`,
      });
    }
  }

  for (const debt of position.debtBalances) {
    for (const pa of debt.pendingActions) {
      allPendingActions.push({
        display: `[Debt] ${debt.tokenSymbol} - ${pa.label}`,
        pendingAction: pa,
        source: `${debt.tokenSymbol} debt`,
      });
    }
  }

  if (allPendingActions.length === 0) return;

  const { manage }: any = await Enquirer.prompt({
    type: "confirm",
    name: "manage",
    message: "Would you like to execute a pending action?",
    initial: false,
  });

  if (!manage) return;

  const { selectedAction }: any = await Enquirer.prompt({
    type: "select",
    name: "selectedAction",
    message: "Select action:",
    choices: allPendingActions.map((a) => a.display),
  });

  const selected = allPendingActions.find((a) => a.display === selectedAction);
  if (!selected) throw new Error("Invalid action selected");

  await executePendingAction(
    apiClient,
    integration,
    network,
    address,
    wallet,
    selected.pendingAction,
    selected.source,
  );
}

async function fetchAllMarkets(
  apiClient: BorrowApiClient,
  integrationId: string,
  network: string,
): Promise<MarketDto[]> {
  const limit = 100;
  const firstPage = await apiClient.getMarkets({ integrationId, network, limit, offset: 0 });
  const totalPages = Math.ceil(firstPage.total / limit);

  if (totalPages <= 1) return firstPage.items;

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) =>
    apiClient.getMarkets({ integrationId, network, limit, offset: (i + 1) * limit }),
  );

  const results = await Promise.all(remainingPages);
  return [firstPage, ...results].flatMap((r) => r.items);
}

async function browseMarkets(
  apiClient: BorrowApiClient,
  integrationId: string,
  network: string,
): Promise<void> {
  const limit = 10;
  let offset = 0;

  while (true) {
    console.log("\nFetching markets...\n");
    const response = await apiClient.getMarkets({ integrationId, network, limit, offset });

    if (response.items.length === 0 && offset === 0) {
      console.log("No markets found\n");
      return;
    }

    const totalPages = Math.ceil(response.total / limit);
    const currentPage = Math.floor(offset / limit) + 1;

    console.log(`${"═".repeat(70)}`);
    console.log(`Markets - Page ${currentPage} of ${totalPages} (${response.total} total)`);
    console.log(`${"═".repeat(70)}\n`);

    for (const market of response.items) {
      console.log(`${"─".repeat(70)}`);
      console.log(`${market.loanToken.symbol} (${market.id})`);
      console.log(`${"─".repeat(70)}`);
      const price = Number.parseFloat(market.loanTokenPriceUsd) || 0;
      const supplyUsd = (Number.parseFloat(market.totalSupply) * price).toFixed(2);
      const borrowUsd = (Number.parseFloat(market.totalBorrow) * price).toFixed(2);
      const liquidityUsd = (Number.parseFloat(market.availableLiquidity) * price).toFixed(2);

      console.log(`  Type: ${market.type === "pool" ? "Shared Pool" : "Isolated"}`);
      console.log(`  Borrow Rate: ${formatRate(market.borrowRate)}`);
      console.log(`  Utilization: ${formatRate(market.utilizationRate)}`);
      console.log(
        `  Total Supply: ${formatUsd(supplyUsd)} | Total Borrow: ${formatUsd(borrowUsd)}`,
      );
      console.log(`  Available Liquidity: ${formatUsd(liquidityUsd)}`);
      console.log(`  Loan Token Price: ${formatUsd(market.loanTokenPriceUsd)}`);
      console.log(`  Borrowing: ${market.isBorrowEnabled ? "Enabled" : "Disabled"}`);

      if (market.collateralTokens.length > 0) {
        console.log("  Collateral:");
        for (const ct of market.collateralTokens) {
          console.log(
            `    ${ct.token.symbol} - LTV: ${formatRate(ct.ltv)} | Liq: ${formatRate(ct.liquidationThreshold)} | Supply APY: ${formatRate(ct.supplyRate)}`,
          );
        }
      }
      console.log();
    }

    const hasNext = offset + limit < response.total;
    const hasPrevious = offset > 0;
    const navChoices: string[] = [];
    if (hasPrevious) navChoices.push("Previous Page");
    if (hasNext) navChoices.push("Next Page");
    navChoices.push("Back");

    if (navChoices.length === 1) return;

    const { nav }: any = await Enquirer.prompt({
      type: "select",
      name: "nav",
      message: "Navigation:",
      choices: navChoices,
    });

    if (nav === "Next Page") {
      offset += limit;
    } else if (nav === "Previous Page") {
      offset = Math.max(0, offset - limit);
    } else {
      return;
    }
  }
}

async function executeActionFlow(
  apiClient: BorrowApiClient,
  integration: IntegrationDto,
  network: string,
  address: string,
  wallet: HDNodeWallet,
  actionType: BorrowActionType,
): Promise<void> {
  const actionDef = integration.actions.find((a) => a.id === actionType);
  if (!actionDef) {
    console.log(`Action ${actionType} is not supported by this integration`);
    return;
  }

  console.log(`\n${actionDef.label}\n`);

  if (actionDef.schema.notes) {
    console.log(`Note: ${actionDef.schema.notes}\n`);
  }

  console.log("Fetching markets...\n");
  const markets = await fetchAllMarkets(apiClient, integration.id, network);

  if (markets.length === 0) {
    console.log("No markets available");
    return;
  }

  const marketChoices = markets.map((m) => ({
    display: `${m.loanToken.symbol} - ${m.id} (Rate: ${formatRate(m.borrowRate)})`,
    market: m,
  }));

  const { selection }: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "selection",
    message: "Select market (type to search):",
    choices: marketChoices.map((c) => c.display),
  });

  const selected = marketChoices.find((c) => c.display === selection);
  if (!selected) throw new Error("Invalid market selected");

  const market = selected.market;
  const args: ArgumentsDto = { marketId: market.id };

  const collected = await promptFromSchema(actionDef.schema, ["marketId"]);
  Object.assign(args, collected);

  console.log("\nAction Summary:");
  console.log(`  Integration: ${integration.name}`);
  console.log(`  Network: ${network}`);
  console.log(`  Market: ${market.id} (${market.loanToken.symbol})`);
  console.log(`  Action: ${actionDef.label}`);

  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && key !== "marketId") {
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      const display = typeof value === "object" ? JSON.stringify(value) : value;
      console.log(`  ${label}: ${display}`);
    }
  }

  const { confirm }: any = await Enquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: "Proceed?",
  });

  if (!confirm) {
    console.log("Cancelled\n");
    return;
  }

  console.log("\nCreating action...\n");
  const actionResponse = await apiClient.createAction({
    integrationId: integration.id,
    action: actionType,
    address,
    args,
  });

  if (actionResponse.metadata) {
    displayActionMetadata(actionResponse.metadata);
    console.log();
  }

  if (actionResponse.totalSteps > 1) {
    console.log(
      `Multi-step action: ${actionResponse.totalSteps} steps total\n`,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
  await processMultiStepAction(actionResponse, wallet, apiClient);
  console.log("\nAction completed successfully!\n");
}

async function executePendingAction(
  apiClient: BorrowApiClient,
  integration: IntegrationDto,
  network: string,
  address: string,
  wallet: HDNodeWallet,
  pendingAction: PendingActionDto,
  sourceLabel: string,
): Promise<void> {
  const actionDef = integration.actions.find((a) => a.id === pendingAction.type);
  const schema = actionDef?.schema;
  const preFilledArgs = { ...pendingAction.args };
  const preFilledFields = Object.keys(preFilledArgs).filter(
    (k) => preFilledArgs[k] !== undefined && preFilledArgs[k] !== null,
  );

  console.log(`\n${pendingAction.label}\n`);

  if (schema?.notes) {
    console.log(`Note: ${schema.notes}\n`);
  }

  let additionalArgs: Record<string, any> = {};
  if (schema) {
    additionalArgs = await promptFromSchema(schema, preFilledFields);
  }

  const args: ArgumentsDto = { ...preFilledArgs, ...additionalArgs };

  console.log("\nAction Summary:");
  console.log(`  Source: ${sourceLabel}`);
  console.log(`  Action: ${pendingAction.label}`);

  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) {
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      const display = typeof value === "object" ? JSON.stringify(value) : value;
      console.log(`  ${label}: ${display}`);
    }
  }

  const { confirm }: any = await Enquirer.prompt({
    type: "confirm",
    name: "confirm",
    message: "Proceed?",
  });

  if (!confirm) {
    console.log("Cancelled\n");
    return;
  }

  console.log("\nCreating action...\n");
  const actionResponse = await apiClient.createAction({
    integrationId: integration.id,
    action: pendingAction.type,
    address,
    args,
  });

  if (actionResponse.metadata) {
    displayActionMetadata(actionResponse.metadata);
    console.log();
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));
  await processMultiStepAction(actionResponse, wallet, apiClient);
  console.log("\nAction completed successfully!\n");
}

main().catch((error) => {
  console.error("Script failed with error:", error);
  process.exit(1);
});
