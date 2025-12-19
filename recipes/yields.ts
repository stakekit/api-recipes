/**
 * Yield.xyz Yields API Recipe
 *
 * This example demonstrates how to interact with yield opportunities (staking, liquid staking, etc.)
 * via the Yield.xyz Yields API using ethers.js for transaction signing.
 */

import * as dotenv from "dotenv";
import { HDNodeWallet } from "ethers";
import "cross-fetch/polyfill";
import Enquirer from "enquirer";
import { request } from "../utils/requests";

dotenv.config();

if (!process.env.MNEMONIC || !process.env.YIELDS_API_KEY) {
  console.error("Error: MNEMONIC and YIELDS_API_KEY environment variables are required");
  process.exit(1);
}

// ===== Type Definitions =====

interface TokenDto {
  symbol: string;
  name: string;
  decimals: number;
  network: string;
  address?: string;
  coinGeckoId?: string;
  logoURI?: string;
}

interface YieldOpportunity {
  id: string;
  network: string;
  chainId?: string;
  token: TokenDto;
  inputTokens?: TokenDto[];
  outputToken?: TokenDto;
  providerId: string;
  rewardRate: {
    total: number;
    rateType: string;
    components?: Array<{
      rate: number;
      rateType: string;
      token: TokenDto;
      yieldSource: string;
      description: string;
    }>;
  };
  status: {
    enter: boolean;
    exit: boolean;
  };
  metadata: {
    name: string;
    logoURI: string;
    description: string;
    documentation?: string;
    supportedStandards?: string[];
    underMaintenance?: boolean;
    deprecated?: boolean;
  };
  mechanics: {
    type: string;
    requiresValidatorSelection?: boolean;
    rewardSchedule?: string;
    rewardClaiming?: string;
    gasFeeToken?: TokenDto;
    entryLimits?: {
      minimum: string;
      maximum: string | null;
    };
    supportsLedgerWalletApi?: boolean;
    possibleFeeTakingMechanisms?: {
      depositFee?: boolean;
      managementFee?: boolean;
      performanceFee?: boolean;
      validatorRebates?: boolean;
    };
    arguments?: {
      enter?: any;
      exit?: any;
      manage?: Record<string, any>;
    };
  };
  tags?: string[];
  statistics?: {
    tvlUsd?: string;
    tvl?: string;
    uniqueUsers?: number | null;
    averagePositionSizeUsd?: string | null;
  };
  state?: {
    capacityState?: {
      current: string;
      max: string;
      remaining: string;
    };
  };
}

interface ValidatorDto {
  address: string;
  name?: string;
  logoURI?: string;
  website?: string;
  rewardRate?: {
    total: number;
    rateType: string;
    components?: Array<{
      rate: number;
      rateType: string;
      token: TokenDto;
      yieldSource: string;
      description: string;
    }>;
  };
  provider?: {
    name: string;
    uniqueId: string;
    website?: string;
    rank?: number;
    preferred?: boolean;
  };
  commission?: number;
  tvlUsd?: string;
  tvl?: string;
  tvlRaw?: string;
  votingPower?: number;
  preferred?: boolean;
  minimumStake?: string;
  remainingPossibleStake?: string;
  remainingSlots?: number;
  nominatorCount?: number;
  status?: string;
  providerId?: string;
  pricePerShare?: string;
  subnetId?: number;
  subnetName?: string;
  marketCap?: string;
  tokenSymbol?: string;
}

interface BalanceDto {
  address: string;
  type: string;
  amount: string;
  amountRaw: string;
  amountUsd?: string;
  token: TokenDto;
  pendingActions: PendingAction[];
  validator?: ValidatorDto | null;
  validators?: ValidatorDto[] | null;
  isEarning: boolean;
}

interface YieldBalancesDto {
  yieldId: string;
  balances: BalanceDto[];
}

interface PendingAction {
  intent: string;
  type: string;
  passthrough: string;
  arguments?: any;
}

interface Transaction {
  id: string;
  network: string;
  status: string;
  type: string;
  unsignedTransaction?: any;
  gasEstimate?: any;
  hash?: string;
  explorerUrl?: string;
}

interface Action {
  id: string;
  yieldId: string;
  type: string;
  status: string;
  transactions: Transaction[];
  createdAt: string;
}

// ===== API Client =====

class YieldsApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey.trim();
  }

  private async makeRequest<T>(method: string, path: string, body?: any): Promise<T> {
    return request<T>(this.baseUrl, this.apiKey, method, path, body);
  }

  async getYields(params?: { network?: string; limit?: number; offset?: number }): Promise<{
    items: YieldOpportunity[];
    total: number;
  }> {
    const query = new URLSearchParams();
    if (params?.network) query.append("network", params.network);
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.offset) query.append("offset", params.offset.toString());

    const queryString = query.toString();
    return this.makeRequest<{ items: YieldOpportunity[]; total: number }>(
      "GET",
      `/v1/yields${queryString ? `?${queryString}` : ""}`,
    );
  }

  async getBalances(yieldId: string, address: string): Promise<YieldBalancesDto> {
    return this.makeRequest<YieldBalancesDto>("POST", `/v1/yields/${yieldId}/balances`, {
      address,
    });
  }

  async enterYield(yieldId: string, address: string, args: any): Promise<Action> {
    return this.makeRequest<Action>("POST", "/v1/actions/enter", {
      yieldId,
      address,
      arguments: args,
    });
  }

  async exitYield(yieldId: string, address: string, args: any): Promise<Action> {
    return this.makeRequest<Action>("POST", "/v1/actions/exit", {
      yieldId,
      address,
      arguments: args,
    });
  }

  async manageYield(
    yieldId: string,
    address: string,
    action: string,
    passthrough: string,
    args: any,
  ): Promise<Action> {
    return this.makeRequest<Action>("POST", "/v1/actions/manage", {
      yieldId,
      address,
      action,
      passthrough,
      arguments: args,
    });
  }

  async getValidators(
    yieldId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ items: ValidatorDto[]; total: number; offset: number; limit: number }> {
    const params = new URLSearchParams();
    if (limit) params.append("limit", limit.toString());
    if (offset) params.append("offset", offset.toString());

    const query = params.toString();
    return this.makeRequest<{
      items: ValidatorDto[];
      total: number;
      offset: number;
      limit: number;
    }>("GET", `/v1/yields/${yieldId}/validators${query ? `?${query}` : ""}`);
  }

  async submitTransaction(transactionId: string, signedTransaction: string): Promise<any> {
    return this.makeRequest<any>("POST", `/v1/transactions/${transactionId}/submit`, {
      signedTransaction,
    });
  }

  async getTransaction(transactionId: string): Promise<Transaction> {
    return this.makeRequest<Transaction>("GET", `/v1/transactions/${transactionId}`);
  }
}

// ===== Helper Functions =====

function formatUsd(value: string): string {
  const num = Number.parseFloat(value);
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

function formatApy(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function displayTransactionInfo(tx: Transaction): void {
  if (tx.hash) console.log(`  Hash: ${tx.hash}`);
  if (tx.explorerUrl) console.log(`  Explorer: ${tx.explorerUrl}`);
}

async function promptForArguments(
  schema: any,
  yieldId?: string,
  apiClient?: YieldsApiClient,
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};
  const fields = schema?.fields || [];

  for (const field of fields) {
    const isRequired = field.required || false;
    const message = `${field.label || field.name}${!isRequired ? " (optional)" : ""}`;

    if (
      field.optionsRef &&
      yieldId &&
      apiClient &&
      (field.name === "validatorAddress" || field.name === "validatorAddresses")
    ) {
      const validatorsResponse = await apiClient.getValidators(yieldId, 100, 0);

      if (validatorsResponse.items.length > 0) {
          const validatorChoices = validatorsResponse.items.map((v: ValidatorDto) => ({
            name: `${v.name || v.address} ${v.rewardRate ? `- APY: ${formatApy(v.rewardRate.total)}` : ""} ${v.status ? `(${v.status})` : ""}`,
            value: v.address,
          }));

        const { selectedValidator }: any = await Enquirer.prompt({
          type: "autocomplete",
          name: "selectedValidator",
          message,
          choices: validatorChoices.map((c: { name: string; value: string }) => c.name),
        });

        const selected = validatorChoices.find((c: { name: string; value: string }) => c.name === selectedValidator);
        if (selected) {
          result[field.name] = field.isArray ? [selected.value] : selected.value;
        }
        continue;
      }
    }

    if (field.options && field.options.length > 0) {
      const response: any = await Enquirer.prompt({
        type: "select",
        name: "value",
        message,
        choices: field.options,
      } as any);
      result[field.name] = response.value;
    } else if (field.type === "number") {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message,
        initial: field.default,
        validate: (input: string) => {
          if (!isRequired && input === "") return true;
          const num = Number.parseFloat(input);
          if (Number.isNaN(num)) return "Must be a valid number";
          if (field.minimum && num < Number.parseFloat(field.minimum)) {
            return `Must be at least ${field.minimum}`;
          }
          if (field.maximum && num > Number.parseFloat(field.maximum)) {
            return `Must be at most ${field.maximum}`;
          }
          return true;
        },
      } as any);
      if (response.value) {
        result[field.name] = Number.parseFloat(response.value);
      }
    } else if (field.type === "boolean") {
      const response: any = await Enquirer.prompt({
        type: "confirm",
        name: "value",
        message,
        initial: field.default || false,
      } as any);
      result[field.name] = response.value;
    } else if (field.isArray) {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message: `${message} (comma-separated)`,
        initial: field.default,
      } as any);
      if (response.value) {
        result[field.name] = response.value.split(",").map((v: string) => v.trim());
      }
    } else if (field.type === "object" && field.fields) {
      console.log(`\n${field.label || field.name}:`);
      const nestedResult = await promptForArguments({ fields: field.fields }, yieldId, apiClient);
      if (Object.keys(nestedResult).length > 0) {
        result[field.name] = nestedResult;
      }
    } else {
      const response: any = await Enquirer.prompt({
        type: "input",
        name: "value",
        message,
        initial: field.default,
        validate: (input: string) => {
          if (!isRequired && input === "") return true;
          if (isRequired && input === "") return `${field.label || field.name} is required`;
          return true;
        },
      } as any);
      if (response.value || isRequired) {
        result[field.name] = response.value;
      }
    }
  }

  return result;
}

async function signAndSubmitTransactions(
  transactions: Transaction[],
  wallet: HDNodeWallet,
  apiClient: YieldsApiClient,
): Promise<void> {
  let nonceOffset = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.status === "CONFIRMED" || tx.status === "BROADCASTED") {
      console.log(
        `Step ${i + 1}/${transactions.length}: ${tx.type} (already ${tx.status.toLowerCase()})`,
      );
      displayTransactionInfo(tx);
      continue;
    }

    console.log(`\nStep ${i + 1}/${transactions.length}: ${tx.type}`);

    if (!tx.unsignedTransaction) {
      console.log("Skipping: No unsigned transaction data");
      continue;
    }

    try {
      console.log("Signing...");
      const txData = JSON.parse(tx.unsignedTransaction);

      // Increment nonce by 1 for each transaction
      if (txData.nonce !== undefined && txData.nonce !== null) {
        txData.nonce = Number(txData.nonce) + nonceOffset;
        console.log(`  Using nonce: ${txData.nonce}`);
      }

      nonceOffset++;

      const signedTx = await wallet.signTransaction(txData);

      console.log("Submitting...");
      const result = await apiClient.submitTransaction(tx.id, signedTx);

      console.log("Submitted!");
      displayTransactionInfo(result);

      console.log("Waiting for confirmation...");
      let confirmed = false;
      let attempts = 0;
      const maxAttempts = 60;

      while (!confirmed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          const status = await apiClient.getTransaction(tx.id);

          if (status.status === "CONFIRMED") {
            console.log("Confirmed!");
            displayTransactionInfo(status);
            confirmed = true;
          } else if (status.status === "FAILED") {
            console.error("Transaction failed!");
            throw new Error("Transaction failed");
          } else {
            process.stdout.write(".");
          }
        } catch (error: any) {
          process.stdout.write(".");
        }

        attempts++;
      }

      if (!confirmed) {
        console.log("\nWarning: Transaction confirmation timeout, continuing...\n");
      }
    } catch (error: any) {
      console.error(`Failed: ${error.message}`);
      throw error;
    }
  }
}

// ===== Main Function =====

async function main() {
  try {
    console.log("\nYield.xyz Yields API\n");

    const apiUrl = process.env.YIELDS_API_URL || "https://api.yield.xyz";
    const apiKey = process.env.YIELDS_API_KEY;

    if (!apiKey) {
      console.log("Error: YIELDS_API_KEY environment variable is required");
      return;
    }

    const apiClient = new YieldsApiClient(apiUrl, apiKey);
    console.log(`API URL: ${apiUrl}\n`);

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

    await selectYieldFlow(apiClient, address, wallet);
  } catch (e: any) {
    console.error("Fatal Error:", e?.message || e);
  }
}

// ===== Menu Functions =====

async function fetchAllYields(apiClient: YieldsApiClient): Promise<YieldOpportunity[]> {
  const limit = 100;
  const firstPage = await apiClient.getYields({ limit, offset: 0 });
  const totalPages = Math.ceil(firstPage.total / limit);

  if (totalPages === 1) {
    return firstPage.items;
  }

  const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) =>
    apiClient.getYields({ limit, offset: (i + 1) * limit }),
  );

  const results = await Promise.all(remainingPages);
  return [firstPage, ...results].flatMap((r) => r.items);
}

async function selectYieldFlow(
  apiClient: YieldsApiClient,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nFetching all yield opportunities...\n");
  const yields = await fetchAllYields(apiClient);
  console.log(`Loaded ${yields.length} yield opportunities\n`);

  const yieldChoices = yields.map((y) => ({
    name: `${y.metadata?.name || y.id} (${y.token?.symbol || "?"}) on ${y.network} - APY: ${formatApy(y.rewardRate?.total || 0)}`,
    value: y,
  }));

  while (true) {
    console.log("\nSelect a Yield\n");

    const { selectedYield }: any = await Enquirer.prompt({
      type: "autocomplete",
      name: "selectedYield",
      message: "Select yield (or Esc to exit):",
      choices: yieldChoices.map((c) => c.name),
    });

    const yieldChoice = yieldChoices.find((c) => c.name === selectedYield);
    if (!yieldChoice) {
      throw new Error("Invalid yield selected");
    }

    await showYieldMenu(apiClient, yieldChoice.value, address, wallet);
  }
}

function displayYieldInfo(yieldInfo: YieldOpportunity): void {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`${yieldInfo.metadata?.name || yieldInfo.id}`);
  console.log(`${"═".repeat(70)}\n`);
  
  if (yieldInfo.metadata?.description) {
    console.log(`${yieldInfo.metadata.description}\n`);
  }
  
  console.log(`${"─".repeat(70)}`);
  console.log("Key Metrics");
  console.log(`${"─".repeat(70)}`);
  
  console.log(`  APY: ${formatApy(yieldInfo.rewardRate?.total || 0)}`);
  
  if (yieldInfo.statistics?.tvlUsd) {
    console.log(`  TVL: ${formatUsd(yieldInfo.statistics.tvlUsd)}`);
  }
  
  console.log(`  Type: ${yieldInfo.mechanics?.type || "N/A"}\n`);
  
  console.log(`${"─".repeat(70)}`);
  console.log("Input Token");
  console.log(`${"─".repeat(70)}`);
  if (yieldInfo.inputTokens && yieldInfo.inputTokens.length > 0) {
    for (const token of yieldInfo.inputTokens) {
      console.log(`  ${token.symbol}${token.name ? ` - ${token.name}` : ""}${token.address ? ` (${token.address})` : ""}`);
    }
  } else if (yieldInfo.token) {
    console.log(`  ${yieldInfo.token.symbol}${yieldInfo.token.name ? ` - ${yieldInfo.token.name}` : ""}${yieldInfo.token.address ? ` (${yieldInfo.token.address})` : ""}`);
  } else {
    console.log("  N/A");
  }
  
  if (yieldInfo.outputToken && yieldInfo.outputToken.symbol !== yieldInfo.token?.symbol) {
    console.log(`${"─".repeat(70)}`);
    console.log("Output Token");
    console.log(`${"─".repeat(70)}`);
    console.log(`  ${yieldInfo.outputToken.symbol}${yieldInfo.outputToken.name ? ` - ${yieldInfo.outputToken.name}` : ""}${yieldInfo.outputToken.address ? ` (${yieldInfo.outputToken.address})` : ""}\n`);
  }
  
  if (yieldInfo.rewardRate?.components && yieldInfo.rewardRate.components.length > 0) {
    console.log(`${"─".repeat(70)}`);
    console.log("Reward Rate Breakdown");
    console.log(`${"─".repeat(70)}`);
    for (const component of yieldInfo.rewardRate.components) {
      console.log(`  ${formatApy(component.rate)} ${component.rateType} from ${component.yieldSource}`);
      if (component.description) {
        console.log(`    └─ ${component.description}`);
      }
      if (component.token) {
        console.log(`    └─ Token: ${component.token.symbol}`);
      }
    }
  }
  
  if (yieldInfo.mechanics?.entryLimits) {
    console.log(`${"─".repeat(70)}`);
    console.log("Entry Limits");
    console.log(`${"─".repeat(70)}`);
    const limits = yieldInfo.mechanics.entryLimits;
    console.log(`  Minimum: ${limits.minimum}`);
    console.log(`  Maximum: ${limits.maximum || "No limit"}\n`);
  }
  
  console.log(`${"─".repeat(70)}`);
  console.log("Network & Provider");
  console.log(`${"─".repeat(70)}`);
  console.log(`  Network: ${yieldInfo.network}${yieldInfo.chainId ? ` (Chain ID: ${yieldInfo.chainId})` : ""}`);
  console.log(`  Provider: ${yieldInfo.providerId}\n`);
  
  console.log(`${"─".repeat(70)}`);
  console.log("Available Actions");
  console.log(`${"─".repeat(70)}`);
  console.log(`  Enter: ${yieldInfo.status.enter ? "Yes" : "No"}`);
  console.log(`  Exit: ${yieldInfo.status.exit ? "Yes" : "No"}\n`);
}

async function showYieldMenu(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  let metadataShown = false;
  
  while (true) {
    if (!metadataShown) {
      displayYieldInfo(yieldInfo);
      metadataShown = true;
    }

    const choices: string[] = [];
    const actionMap = new Map<string, { balance: BalanceDto; action: PendingAction }>();
    let hasPendingActions = false;

    try {
      const balanceData = await apiClient.getBalances(yieldInfo.id, address);
      displayBalances(balanceData, yieldInfo);
      
      for (const balance of balanceData.balances) {
        for (const pendingAction of balance.pendingActions) {
          hasPendingActions = true;
          let validatorInfo = "";
          if (balance.validator) {
            validatorInfo = ` - ${balance.validator.name || balance.validator.address}`;
          } else if (balance.validators && balance.validators.length > 0) {
            validatorInfo = ` - ${balance.validators.length} validator${balance.validators.length > 1 ? "s" : ""}`;
          }
          const actionLabel = `${balance.type} - ${pendingAction.type} (${balance.amount} ${balance.token.symbol})${validatorInfo}`;
          actionMap.set(actionLabel, { balance, action: pendingAction });
        }
      }
    } catch (error: any) {
      console.error(`\nError fetching balances: ${error?.message || error}\n`);
    }

    if (yieldInfo.mechanics?.requiresValidatorSelection) {
      choices.push("View Validators");
    }
    if (yieldInfo.status.enter) choices.push("Enter");
    if (yieldInfo.status.exit) choices.push("Exit");
    if (hasPendingActions) {
      choices.push("Manage");
    }
    choices.push("Back");

    const { action }: any = await Enquirer.prompt({
      type: "select",
      name: "action",
      message: "What would you like to do?",
      choices,
    });

    if (action === "Back") {
      return;
    }

    try {
      if (action === "Manage") {
        const manageChoices = Array.from(actionMap.keys());
        manageChoices.push("Back");

        const { selectedAction }: any = await Enquirer.prompt({
          type: "select",
          name: "selectedAction",
          message: "Select action to manage:",
          choices: manageChoices,
        });

        if (selectedAction === "Back") {
          continue;
        }

        const selectedActionData = actionMap.get(selectedAction);
        if (selectedActionData) {
          await executeAction(apiClient, yieldInfo, address, wallet, "manage", {
            balance: selectedActionData.balance,
            pendingAction: selectedActionData.action,
          });
        }
      } else {
        switch (action) {
          case "View Validators":
            await viewValidators(apiClient, yieldInfo);
            break;
          case "Enter":
            await executeAction(apiClient, yieldInfo, address, wallet, "enter");
            break;
          case "Exit":
            await executeAction(apiClient, yieldInfo, address, wallet, "exit");
            break;
        }
      }
    } catch (error: any) {
      console.error("\nError:", error?.message || error);
    }

    console.log(`\n${"─".repeat(60)}\n`);
  }
}

async function executeAction(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
  type: "enter" | "exit" | "manage",
  manageActionArguments?: { balance: BalanceDto; pendingAction: PendingAction },
): Promise<void> {
  const isManage = type === "manage";
  const actionLabel = type === "enter" ? "Enter" : type === "exit" ? "Exit" : manageActionArguments?.pendingAction.type || "Manage";
  
  console.log(`\n${isManage ? actionLabel : `${actionLabel} Yield`}\n`);

  const args: any = {};
  let schema: any;

  if (isManage && manageActionArguments?.pendingAction.arguments) {
    schema = manageActionArguments.pendingAction.arguments;
  } else if (!isManage) {
    schema = yieldInfo.mechanics?.arguments?.[type];
  }

  if (schema) {
    const collected = await promptForArguments(schema, yieldInfo.id, apiClient);
    Object.assign(args, collected);
  } else if (!isManage) {
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: `${actionLabel} amount:`,
    });
    args.amount = amount;
  }

  console.log("\nAction Summary:");
  console.log(`  Yield: ${yieldInfo.metadata?.name || yieldInfo.id}`);
  if (manageActionArguments?.balance) {
    console.log(`  Balance: ${manageActionArguments.balance.type} - ${manageActionArguments.balance.amount} ${manageActionArguments.balance.token.symbol}`);
  }
  console.log(`  Action: ${actionLabel}`);
  for (const [key, value] of Object.entries(args)) {
    console.log(`  ${key}: ${value}`);
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

  try {
    console.log("\nCreating action...\n");
    let actionResponse: Action;

    if (isManage && manageActionArguments) {
      actionResponse = await apiClient.manageYield(
        yieldInfo.id,
        address,
        manageActionArguments.pendingAction.type,
        manageActionArguments.pendingAction.passthrough,
        args,
      );
    } else if (type === "enter") {
      actionResponse = await apiClient.enterYield(yieldInfo.id, address, args);
    } else {
      actionResponse = await apiClient.exitYield(yieldInfo.id, address, args);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await signAndSubmitTransactions(actionResponse.transactions, wallet, apiClient);
    
    const successMessage = isManage
      ? "\nAction completed successfully!\n"
      : `\nYield ${type === "enter" ? "entered" : "exited"} successfully!\n`;
    console.log(successMessage);
  } catch (error: any) {
    console.error("\nError:", error?.message || error);
    throw error;
  }
}

async function viewValidators(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
): Promise<void> {
  const limit = 10;
  let offset = 0;

  while (true) {
    try {
      console.log("\nFetching validators...\n");
      const response = await apiClient.getValidators(yieldInfo.id, limit, offset);

      if (response.items.length === 0 && offset === 0) {
        console.log("No validators found for this yield\n");
        return;
      }

      console.log(`\n${"═".repeat(70)}`);
      console.log(`${yieldInfo.metadata?.name || yieldInfo.id} - Validators`);
      console.log(`Page ${Math.floor(offset / limit) + 1} of ${Math.ceil(response.total / limit)} (${response.total} total)`);
      console.log(`${"═".repeat(70)}\n`);

      for (const validator of response.items) {
        console.log(`${"─".repeat(70)}`);
        console.log(`${validator.name || validator.address}`);
        console.log(`${"─".repeat(70)}`);
        console.log(`  Address: ${validator.address}`);
        if (validator.status) {
          console.log(`  Status: ${validator.status}`);
        }
        if (validator.rewardRate) {
          console.log(`  APY: ${formatApy(validator.rewardRate.total)} ${validator.rewardRate.rateType}`);
          if (validator.rewardRate.components && validator.rewardRate.components.length > 0) {
            for (const component of validator.rewardRate.components) {
              console.log(`    - ${formatApy(component.rate)} ${component.rateType} from ${component.yieldSource}`);
            }
          }
        }
        if (validator.commission !== undefined) {
          console.log(`  Commission: ${(validator.commission * 100).toFixed(2)}%`);
        }
        if (validator.tvlUsd) {
          console.log(`  TVL: ${formatUsd(validator.tvlUsd)}`);
        }
        if (validator.votingPower !== undefined) {
          console.log(`  Voting Power: ${(validator.votingPower * 100).toFixed(2)}%`);
        }
        if (validator.preferred) {
          console.log("  Preferred: Yes");
        }
        if (validator.provider) {
          console.log(`  Provider: ${validator.provider.name} (${validator.provider.uniqueId})`);
        }
        console.log();
      }

      const hasNext = offset + limit < response.total;
      const hasPrevious = offset > 0;

      const choices: string[] = [];
      if (hasPrevious) choices.push("Previous Page");
      if (hasNext) choices.push("Next Page");
      choices.push("Back");

      if (choices.length === 1) {
        return;
      }

      const { action }: any = await Enquirer.prompt({
        type: "select",
        name: "action",
        message: "Navigation:",
        choices,
      });

      if (action === "Next Page") {
        offset += limit;
      } else if (action === "Previous Page") {
        offset = Math.max(0, offset - limit);
      } else {
        return;
      }
    } catch (error: any) {
      console.error(`\nError fetching validators: ${error?.message || error}\n`);
      return;
    }
  }
}

function displayBalances(balanceData: YieldBalancesDto, yieldInfo: YieldOpportunity): void {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`${yieldInfo.metadata?.name || yieldInfo.id} - Balances`);
  console.log(`${"═".repeat(70)}\n`);

  if (balanceData.balances.length === 0) {
    console.log("No balances found for this yield\n");
    return;
  }

  for (const balance of balanceData.balances) {
    console.log(`${"─".repeat(70)}`);
    console.log(`${balance.type.toUpperCase()}`);
    console.log(`${"─".repeat(70)}`);
    console.log(`  Amount: ${balance.amount} ${balance.token.symbol}`);
    if (balance.amountUsd) {
      console.log(`  Value: ${formatUsd(balance.amountUsd)}`);
    }
    if (balance.token.address) {
      console.log(`  Token Address: ${balance.token.address}`);
    }
    if (balance.address) {
      console.log(`  Balance Address: ${balance.address}`);
    }
    console.log(`  Earning: ${balance.isEarning ? "Yes" : "No"}`);
    
    if (balance.validator) {
      console.log(`  Validator: ${balance.validator.name || balance.validator.address}`);
      if (balance.validator.address) {
        console.log(`    Address: ${balance.validator.address}`);
      }
      if (balance.validator.rewardRate) {
        console.log(`    APY: ${formatApy(balance.validator.rewardRate.total)} ${balance.validator.rewardRate.rateType}`);
      }
      if (balance.validator.commission !== undefined) {
        console.log(`    Commission: ${(balance.validator.commission * 100).toFixed(2)}%`);
      }
      if (balance.validator.status) {
        console.log(`    Status: ${balance.validator.status}`);
      }
    }
    
    if (balance.validators && balance.validators.length > 0) {
      console.log(`  Validators (${balance.validators.length}):`);
      for (const validator of balance.validators) {
        console.log(`    - ${validator.name || validator.address}`);
        if (validator.rewardRate) {
          console.log(`      APY: ${formatApy(validator.rewardRate.total)} ${validator.rewardRate.rateType}`);
        }
        if (validator.commission !== undefined) {
          console.log(`      Commission: ${(validator.commission * 100).toFixed(2)}%`);
        }
      }
    }
    
    if (balance.pendingActions.length > 0) {
      console.log("  Available Actions:");
      for (const action of balance.pendingActions) {
        console.log(`    - ${action.type}${action.intent ? ` (${action.intent})` : ""}`);
      }
      console.log();
    } else {
      console.log("  Available Actions: None\n");
    }
  }
}


main().catch((error) => {
  console.error("Script failed with error:", error);
  process.exit(1);
});
