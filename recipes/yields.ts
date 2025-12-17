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
  token: TokenDto;
  tokens: TokenDto[];
  providerId: string;
  rewardRate: {
    total: number;
    rateType: string;
  };
  status: {
    enter: boolean;
    exit: boolean;
  };
  metadata: {
    name: string;
    logoURI: string;
    description: string;
  };
  mechanics: {
    type: string;
    arguments?: {
      enter?: any;
      exit?: any;
      manage?: Record<string, any>;
    };
  };
}

interface BalanceDto {
  address: string;
  type: string;
  amount: string;
  amountRaw: string;
  token: TokenDto;
  pendingActions: PendingAction[];
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

  async getYield(yieldId: string): Promise<YieldOpportunity> {
    return this.makeRequest<YieldOpportunity>("GET", `/v1/yields/${yieldId}`);
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

  async getAction(actionId: string): Promise<Action> {
    return this.makeRequest<Action>("GET", `/v1/actions/${actionId}`);
  }

  async getValidators(yieldId: string): Promise<any[]> {
    const response = await this.makeRequest<{ items: any[] }>(
      "GET",
      `/v1/yields/${yieldId}/validators`,
    );
    return response.items;
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

async function promptForArguments(
  schema: any,
  yieldId?: string,
  apiClient?: YieldsApiClient,
): Promise<Record<string, any>> {
  const result: Record<string, any> = {};

  // Handle ArgumentSchemaDto structure with fields array
  const fields = schema?.fields || [];

  for (const field of fields) {
    const isRequired = field.required || false;
    const message = `${field.label || field.name}${!isRequired ? " (optional)" : ""}`;

    // Handle validator selection via optionsRef
    if (
      field.optionsRef &&
      yieldId &&
      apiClient &&
      (field.name === "validatorAddress" || field.name === "validatorAddresses")
    ) {
      const validators = await apiClient.getValidators(yieldId);

      if (validators.length > 0) {
        const validatorChoices = validators.map((v) => ({
          name: `${v.name || v.address} ${v.rewardRate ? `- APY: ${(v.rewardRate.total * 100).toFixed(2)}%` : ""} ${v.status ? `(${v.status})` : ""}`,
          value: v.address,
        }));

        const { selectedValidator }: any = await Enquirer.prompt({
          type: "autocomplete",
          name: "selectedValidator",
          message,
          choices: validatorChoices.map((c) => c.name),
        });

        const selected = validatorChoices.find((c) => c.name === selectedValidator);
        if (selected) {
          // Return as array for validatorAddresses, string for validatorAddress
          result[field.name] = field.isArray ? [selected.value] : selected.value;
        }
        continue;
      }
    }

    // Regular field handling
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
      // Handle array fields (e.g., amounts for multi-token deposits)
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
      // Handle nested objects (e.g., range with lowerPrice/upperPrice for LP)
      console.log(`\n${field.label || field.name}:`);
      const nestedResult = await promptForArguments({ fields: field.fields }, yieldId, apiClient);
      if (Object.keys(nestedResult).length > 0) {
        result[field.name] = nestedResult;
      }
    } else {
      // String or other types
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
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    if (tx.status === "CONFIRMED" || tx.status === "BROADCASTED") {
      console.log(
        `Step ${i + 1}/${transactions.length}: ${tx.type} (already ${tx.status.toLowerCase()})`,
      );
      continue;
    }

    console.log(`\nStep ${i + 1}/${transactions.length}: ${tx.type}`);

    try {
      console.log("Signing...");
      const signedTx = await wallet.signTransaction(JSON.parse(tx.unsignedTransaction));

      console.log("Submitting...");
      const result = await apiClient.submitTransaction(tx.id, signedTx);

      console.log("Submitted!");
      if (result.hash) {
        console.log(`  Hash: ${result.hash}`);
      }
      if (result.explorerUrl) {
        console.log(`  Explorer: ${result.explorerUrl}`);
      }

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
            if (status.explorerUrl) {
              console.log(`  Explorer: ${status.explorerUrl}`);
            }
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
        console.log("\nWarning: Transaction confirmation timeout, continuing...");
      }

      console.log("");
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

    // Get API configuration
    const apiUrl = process.env.YIELDS_API_URL || "https://api.yield.xyz";
    const apiKey = process.env.YIELDS_API_KEY;

    if (!apiKey) {
      console.log("Error: YIELDS_API_KEY environment variable is required");
      return;
    }

    const apiClient = new YieldsApiClient(apiUrl, apiKey);
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

    // Start directly with yield selection
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
    name: `${y.metadata?.name || y.id} (${y.token?.symbol || "?"}) - APY: ${((y.rewardRate?.total || 0) * 100).toFixed(2)}%`,
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

async function showYieldMenu(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  while (true) {
    console.log(`\n${yieldInfo.metadata?.name || yieldInfo.id}\n`);
    console.log(`Network: ${yieldInfo.network}`);
    console.log(`Token: ${yieldInfo.token.symbol}`);
    console.log(`APY: ${((yieldInfo.rewardRate?.total || 0) * 100).toFixed(2)}%`);
    console.log("");

    const choices = ["View Balances"];
    if (yieldInfo.status.enter) choices.push("Enter");
    if (yieldInfo.status.exit) choices.push("Exit");
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
      switch (action) {
        case "View Balances":
          await viewAndManageBalances(apiClient, yieldInfo, address, wallet);
          break;
        case "Enter":
          await enterYield(apiClient, yieldInfo, address, wallet);
          break;
        case "Exit":
          await exitYield(apiClient, yieldInfo, address, wallet);
          break;
      }
    } catch (error: any) {
      console.error("\nError:", error?.message || error);
    }

    console.log(`\n${"─".repeat(60)}\n`);
  }
}

async function enterYield(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nEnter Yield\n");

  const args: any = {};

  if (yieldInfo.mechanics?.arguments?.enter) {
    const collected = await promptForArguments(
      yieldInfo.mechanics.arguments.enter,
      yieldInfo.id,
      apiClient,
    );
    Object.assign(args, collected);
  } else {
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: "Enter amount:",
    });
    args.amount = amount;
  }

  console.log("\nAction Summary:");
  console.log(`  Yield: ${yieldInfo.metadata?.name || yieldInfo.id}`);
  console.log("  Action: Enter");
  for (const [key, value] of Object.entries(args)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");

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
  const action = await apiClient.enterYield(yieldInfo.id, address, args);
  await signAndSubmitTransactions(action.transactions, wallet, apiClient);
  console.log("\nYield entered successfully!\n");
}

async function exitYield(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nExit Yield\n");

  const args: any = {};

  if (yieldInfo.mechanics?.arguments?.exit) {
    const collected = await promptForArguments(
      yieldInfo.mechanics.arguments.exit,
      yieldInfo.id,
      apiClient,
    );
    Object.assign(args, collected);
  } else {
    const { amount }: any = await Enquirer.prompt({
      type: "input",
      name: "amount",
      message: "Exit amount:",
    });
    args.amount = amount;
  }

  console.log("\nAction Summary:");
  console.log(`  Yield: ${yieldInfo.metadata?.name || yieldInfo.id}`);
  console.log("  Action: Exit");
  for (const [key, value] of Object.entries(args)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");

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
  const action = await apiClient.exitYield(yieldInfo.id, address, args);
  await signAndSubmitTransactions(action.transactions, wallet, apiClient);
  console.log("\nYield exited successfully!\n");
}

async function viewAndManageBalances(
  apiClient: YieldsApiClient,
  yieldInfo: YieldOpportunity,
  address: string,
  wallet: HDNodeWallet,
): Promise<void> {
  console.log("\nView Balances\n");

  // Get balances for this yield
  console.log("\nFetching balances...\n");
  const balanceData = await apiClient.getBalances(yieldInfo.id, address);

  if (balanceData.balances.length === 0) {
    console.log("No balances found for this yield\n");
    return;
  }

  // Display balances
  console.log(`\n${yieldInfo.metadata?.name || yieldInfo.id} Balances:\n`);
  for (const balance of balanceData.balances) {
    console.log(`${balance.type.toUpperCase()}:`);
    console.log(`  Amount: ${balance.amount} ${balance.token.symbol}`);
    console.log(`  Earning: ${balance.isEarning ? "Yes" : "No"}`);
    if (balance.pendingActions.length > 0) {
      console.log(`  Available Actions: ${balance.pendingActions.map((a) => a.type).join(", ")}`);
    }
    console.log("");
  }

  // Check if there are any actions
  const balancesWithActions = balanceData.balances.filter((b) => b.pendingActions.length > 0);
  if (balancesWithActions.length === 0) {
    console.log("No actions available\n");
    return;
  }

  // Ask if user wants to perform an action
  const { performAction }: any = await Enquirer.prompt({
    type: "confirm",
    name: "performAction",
    message: "Perform an action on these balances?",
    initial: false,
  });

  if (!performAction) {
    return;
  }

  // Select balance
  const balanceChoices = balancesWithActions.map((b) => ({
    name: `${b.type} - ${b.amount} ${b.token.symbol}`,
    value: b,
  }));

  const { selectedBalance }: any = await Enquirer.prompt({
    type: "select",
    name: "selectedBalance",
    message: "Select balance:",
    choices: balanceChoices.map((c) => c.name),
  });

  const balanceChoice = balanceChoices.find((c) => c.name === selectedBalance);
  if (!balanceChoice) {
    throw new Error("Invalid balance selected");
  }

  const balance = balanceChoice.value;

  // Select action
  const actionChoices = balance.pendingActions.map((a: PendingAction) => a.type);

  const { selectedAction }: any = await Enquirer.prompt({
    type: "select",
    name: "selectedAction",
    message: "Select action:",
    choices: actionChoices,
  });

  const pendingAction = balance.pendingActions.find(
    (a: PendingAction) => a.type === selectedAction,
  );
  if (!pendingAction) {
    throw new Error("Invalid action selected");
  }

  // Collect arguments
  const args: any = {};
  if (pendingAction.arguments) {
    const collected = await promptForArguments(pendingAction.arguments, yieldInfo.id, apiClient);
    Object.assign(args, collected);
  }

  console.log("\nAction Summary:");
  console.log(`  Yield: ${yieldInfo.metadata?.name || yieldInfo.id}`);
  console.log(`  Balance: ${balance.type} - ${balance.amount} ${balance.token.symbol}`);
  console.log(`  Action: ${pendingAction.type}`);
  for (const [key, value] of Object.entries(args)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");

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
  const action = await apiClient.manageYield(
    yieldInfo.id,
    address,
    pendingAction.type,
    pendingAction.passthrough,
    args,
  );
  await signAndSubmitTransactions(action.transactions, wallet, apiClient);
  console.log("\nAction completed successfully!\n");
}

main().catch((error) => {
  console.error("Script failed with error:", error);
  process.exit(1);
});
