/**
 * Yield.xyz Trade API Recipe
 *
 * Interactive CLI for perps, spot and prediction markets.
 * Forms come from each action's argument schema. Every write is simulated
 * first. Transactions are signed locally and submitted one at a time.
 */

import "cross-fetch/polyfill";
import fs from "node:fs";
import path from "node:path";
import * as dotenv from "dotenv";
import Enquirer from "enquirer";
import { HDNodeWallet } from "ethers";
import {
  type LighterSchnorrPayload,
  generateLighterApiKey,
  lighterSignerPresent,
  signLighterPayload,
} from "../utils/lighter-signer";
import { ApiError, request } from "../utils/requests";

dotenv.config();

// ===== Types (from the Trade API OpenAPI schemas) =====

interface Token {
  symbol: string;
  name?: string;
  network: string;
  address?: string;
  decimals: number;
  logoURI?: string;
}

interface TokenIdentifier {
  network: string;
  address?: string;
}

interface Entity {
  id: string;
  name: string;
  metadata?: {
    description?: string;
    logoURI?: string;
    website?: string;
  };
}

interface MarketStatus {
  state: string;
  reason?: string;
  nextOpenAt?: string | null;
  settlementPrice?: string | null;
}

interface MarketConstraints {
  tickSize: string;
  quantityStep: string;
  minOrderValue: string;
}

interface MarketFees {
  makerBps?: number;
  takerBps?: number;
  partnerBps?: number;
}

interface MarketSnapshot {
  price: string | null;
  markPrice?: string;
  bid?: string;
  ask?: string;
  change24h: string;
  volume24h: string;
  openInterest?: string | null;
  fundingRate?: string;
  fundingIntervalSeconds?: number;
  nextFundingAt?: string;
  updatedAt: string;
}

interface MarketEvent {
  id: string;
  title: string;
  startsAt?: string | null;
  resolvesAt?: string | null;
  outcomes?: Array<{ marketId: string; label: string }>;
}

interface Market {
  id: string;
  providerId: string;
  operator?: Entity;
  name: string;
  baseSymbol: string;
  logoURI?: string;
  type: string;
  assetClass: string;
  status: MarketStatus;
  quoteToken: Token;
  baseToken?: Token;
  balanceId: string;
  maxLeverage?: number;
  constraints: MarketConstraints;
  fees: MarketFees;
  snapshot: MarketSnapshot;
  capabilities?: { candleIntervals?: string[] };
  outcomes?: Array<{ marketId: string; label: string }>;
  outcomeLabel?: string | null;
  sideLabel?: string;
  resolutionAt?: string;
  event?: MarketEvent;
}

interface ArgumentOption {
  value: string;
  label: string;
}

interface ArgumentField {
  name: string;
  type:
    | "string"
    | "decimal"
    | "integer"
    | "boolean"
    | "enum"
    | "token"
    | "address"
    | "url"
    | "date";
  label: string;
  description: string;
  required: boolean;
  nullable: boolean;
  options?: ArgumentOption[] | Token[];
  minimum?: string | number;
  maximum?: string | number;
  step?: string | number;
  unit?: string;
  default?: string | number | boolean | TokenIdentifier | null;
  visibleWhen?: { field: string; values: string[] };
}

interface ArgumentSchema {
  fields: ArgumentField[];
  notes?: string;
}

interface PendingAction {
  action: string;
  label: string;
  marketId?: string;
  providerId?: string;
  arguments: Record<string, unknown>;
  argumentSchema?: ArgumentSchema;
}

interface MarketDetail extends Market {
  rules?: string;
  actions: PendingAction[];
}

interface Provider {
  id: string;
  name: string;
  metadata?: { description?: string; logoURI?: string; website?: string };
  types: string[];
  operators: Entity[];
  actions: PendingAction[];
}

interface Page<T> {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: T[];
}

interface Balance {
  providerId: string;
  label: string;
  token: Token;
  total: string;
  available: string;
  totalUsd: string;
  availableUsd: string;
  balanceIds: string[];
  pendingActions: PendingAction[];
}

interface PositionTpSl {
  status: string;
  takeProfitPrice?: string | null;
  stopLossPrice?: string | null;
  orderIds?: string[];
  expiresAt?: string | null;
}

interface Position {
  providerId: string;
  marketId: string;
  type: string;
  assetClass: string;
  operator?: Entity;
  balanceId: string;
  side?: string;
  quantity: string;
  available: string;
  entryPrice: string | null;
  markPrice: string;
  value: string;
  valueUsd: string;
  unrealizedPnl: string | null;
  unrealizedPnlUsd: string | null;
  leverage?: number;
  margin?: string;
  marginMode?: string;
  liquidationPrice?: string | null;
  fundingPaid?: string;
  tpSl?: PositionTpSl;
  pendingActions: PendingAction[];
}

interface PortfolioOrder {
  id: string;
  providerId: string;
  marketId: string;
  effect: string;
  side?: string;
  orderType: string;
  limitPrice?: string;
  triggerPrice?: string;
  quantity: string;
  filledQuantity: string;
  leverage?: number | null;
  margin?: string | null;
  expiresAt: string | null;
  createdAt: string;
  pendingActions: PendingAction[];
}

interface TradingKey {
  providerId: string;
  tradingKey: string;
  expiresAt: string | null;
}

interface Portfolio {
  equityUsd: string;
  balances: Balance[];
  positions: Position[];
  orders: PortfolioOrder[];
  ordersTruncated: boolean;
  setup: PendingAction[];
  tradingKeys: TradingKey[];
}

interface Fee {
  kind: string;
  label: string;
  amount: string;
  isUpperBound: boolean;
  token: Token;
}

interface Summary {
  balanceId?: string;
  available?: string;
  side?: string;
  positionEffect?: string;
  quantity?: string;
  value?: string;
  margin?: string;
  leverage?: number;
  marginMode?: string;
  estimatedPrice?: string;
  liquidationPrice?: string;
  priceBound?: string;
  takeProfitPrice?: string;
  stopLossPrice?: string;
  inputToken?: Token;
  outputToken?: Token;
  inputAmount?: string;
  outputAmount?: string;
  minOutputAmount?: string;
  estimatedDurationSeconds?: number;
  payout?: string;
  fees: Fee[];
}

interface SimulateResult {
  summary: Summary | null;
  requirements: PendingAction[];
}

interface FailureReason {
  code: string;
  message: string;
}

interface ActionResult {
  orderId: string | null;
  orderStatus: string;
  filledQuantity: string;
  averagePrice: string | null;
}

interface Eip712TypedDataPayload {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

interface EvmTransactionPayload {
  from: string;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  chainId: number;
  nonce: number;
}

interface Transaction {
  id: string;
  label: string;
  status: string;
  network: string;
  signer: string;
  signerAddress: string | null;
  signingFormat: string;
  signablePayload: Eip712TypedDataPayload | EvmTransactionPayload | Record<string, unknown>;
  hash: string | null;
  token?: Token;
  amount?: string;
  submitBy: string;
  failureReason: FailureReason | null;
}

interface Action {
  id: string;
  status: string;
  failureReason: FailureReason | null;
  address: string;
  providerId: string;
  marketId?: string;
  action: string;
  label: string;
  arguments: Record<string, unknown>;
  summary: Summary | null;
  result?: ActionResult | null;
  submitBy: string | null;
  createdAt: string;
  transactions: Transaction[];
}

interface Fill {
  id: string;
  orderId: string;
  providerId: string;
  marketId: string;
  effect: string;
  side?: string;
  fillType: string;
  price: string;
  quantity: string;
  fees: Fee[];
  realizedPnl: string | null;
  createdAt: string;
}

interface FieldError {
  field: string;
  message: string;
  suggestion?: string;
}

interface ErrorBody {
  message?: string;
  details?: {
    code?: string;
    field?: string;
    suggestion?: string;
    errors?: FieldError[];
    requirements?: PendingAction[];
  };
}

type ActionRoute = "buy" | "sell" | "manage";
type ActionOutcome = "success" | "failed" | "unconfirmed" | "cancelled";

const SKIP = Symbol("skip");
const MAX_REQUIREMENT_DEPTH = 5;
const TRANSACTION_POLL_MS = 2000;
const TRANSACTION_WAIT_MS = 90_000;
const ACTION_WAIT_MS = 60_000;

const SUMMARY_LABELS: Record<string, string> = {
  balanceId: "Balance",
  available: "Available",
  side: "Side",
  positionEffect: "Effect",
  quantity: "Quantity",
  value: "Value",
  margin: "Margin",
  leverage: "Leverage",
  marginMode: "Margin mode",
  estimatedPrice: "Estimated price",
  liquidationPrice: "Liquidation price",
  priceBound: "Price bound",
  takeProfitPrice: "Take profit",
  stopLossPrice: "Stop loss",
  inputAmount: "Input amount",
  outputAmount: "Output amount",
  minOutputAmount: "Minimum received",
  estimatedDurationSeconds: "Estimated time",
  payout: "Payout if it wins",
};

class UnsupportedSigning extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSigning";
  }
}

// ===== API client =====

class TradeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey.trim();
  }

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    return request<T>(this.baseUrl, this.apiKey, method, path, body, { silentError: true });
  }

  getProviders(): Promise<Page<Provider>> {
    return this.call("GET", "/v1/providers?includeTestnets=true&limit=100");
  }

  getProvider(providerId: string): Promise<Provider> {
    return this.call("GET", `/v1/providers/${encodeURIComponent(providerId)}`);
  }

  getMarkets(query: Record<string, string>): Promise<Page<Market>> {
    return this.call("GET", `/v1/markets?${new URLSearchParams(query).toString()}`);
  }

  getMarket(marketId: string): Promise<MarketDetail> {
    return this.call("GET", `/v1/markets/${encodeURIComponent(marketId)}`);
  }

  getPortfolio(providerId: string, address: string): Promise<Portfolio> {
    const params = new URLSearchParams({ providerId, address });
    return this.call("GET", `/v1/portfolio?${params.toString()}`);
  }

  getActions(providerId: string, address: string): Promise<Page<Action>> {
    const params = new URLSearchParams({ providerId, address, limit: "20" });
    return this.call("GET", `/v1/actions?${params.toString()}`);
  }

  getFills(providerId: string, address: string): Promise<Page<Fill>> {
    const params = new URLSearchParams({ providerId, address, limit: "20" });
    return this.call("GET", `/v1/fills?${params.toString()}`);
  }

  getAction(actionId: string): Promise<Action> {
    return this.call("GET", `/v1/actions/${encodeURIComponent(actionId)}`);
  }

  simulate(route: ActionRoute, body: Record<string, unknown>): Promise<SimulateResult> {
    return this.call("POST", `/v1/actions/${route}/simulate`, body);
  }

  create(route: ActionRoute, body: Record<string, unknown>): Promise<Action> {
    return this.call("POST", `/v1/actions/${route}`, body);
  }

  submit(transactionId: string, signedPayload: string): Promise<Action> {
    return this.call("POST", `/v1/transactions/${encodeURIComponent(transactionId)}/submit`, {
      signedPayload,
    });
  }
}

// ===== Formatting =====

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFraction(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  const percent = number * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function formatProbability(value: string): string {
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  return `${(number * 100).toFixed(2)}%`;
}

function formatCompact(value: string | undefined): string {
  if (!value) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(number / 1_000).toFixed(2)}K`;
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatStatus(status: MarketStatus): string {
  const reason = status.reason ? ` (${status.reason.replace(/_/g, " ")})` : "";
  const next = status.nextOpenAt ? `, opens ${status.nextOpenAt}` : "";
  const settlement = status.settlementPrice ? `, settled at ${status.settlementPrice}` : "";
  return `${status.state}${reason}${next}${settlement}`;
}

function formatMarketPrice(market: Market): string {
  const { price, markPrice } = market.snapshot;
  if (market.type === "prediction") {
    if (price != null) return formatProbability(price);
    if (markPrice != null) return `mark ${formatProbability(markPrice)}`;
    return "—";
  }
  return price ?? markPrice ?? "—";
}

function formatWhen(value: string): string {
  return value.replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC");
}

function tokenIdentifier(token: TokenIdentifier): TokenIdentifier {
  const identifier: TokenIdentifier = { network: token.network };
  if (token.address) identifier.address = token.address;
  return identifier;
}

function sameToken(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as TokenIdentifier;
  const b = right as TokenIdentifier;
  return a.network === b.network && (a.address ?? "") === (b.address ?? "");
}

function printApiError(error: unknown): void {
  if (error instanceof UnsupportedSigning) {
    console.error(error.message);
    return;
  }

  if (error instanceof ApiError) {
    const body = (error.body ?? {}) as ErrorBody;
    const code = body.details?.code;
    const message = body.message || error.message;
    console.error(code ? `${message} (${code})` : message);
    if (body.details?.suggestion) console.error(body.details.suggestion);
    if (body.details?.field) console.error(`Field: ${body.details.field}`);
    for (const fieldError of body.details?.errors ?? []) {
      console.error(`- ${fieldError.field}: ${fieldError.message}`);
      if (fieldError.suggestion) console.error(`  ${fieldError.suggestion}`);
    }
    const requirements = body.details?.requirements ?? [];
    if (requirements.length > 0) {
      console.error("Required steps:");
      for (const step of requirements) console.error(`- ${step.label} (${step.action})`);
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}

function printSummary(summary: Summary | null): void {
  console.log("\nSimulation");
  if (!summary) {
    console.log("  No summary yet. A required step is blocking the price.");
    return;
  }

  for (const [key, value] of Object.entries(summary)) {
    if (key === "fees" || value == null) continue;
    if (key === "inputToken" || key === "outputToken") {
      const token = value as Token;
      const label = key === "inputToken" ? "Pay" : "Receive";
      console.log(`  ${label}: ${token.symbol} on ${token.network}`);
      continue;
    }
    const label = SUMMARY_LABELS[key] ?? key;
    let text = String(value);
    if (key === "leverage") text = `${value}x`;
    if (key === "estimatedDurationSeconds") text = `${value}s`;
    console.log(`  ${label}: ${text}`);
  }

  if (summary.fees?.length) {
    console.log("  Fees:");
    for (const fee of summary.fees) {
      const bound = fee.isUpperBound ? "≤ " : "";
      console.log(`    ${fee.label}: ${bound}${fee.amount} ${fee.token.symbol} (${fee.kind})`);
    }
  }
}

function printActionResult(action: Action, unconfirmed: boolean): void {
  console.log(`\nAction ${action.id}`);
  console.log(`  ${action.label} · ${action.status}`);
  if (action.result) {
    console.log(`  Order: ${action.result.orderId ?? "—"} · ${action.result.orderStatus}`);
    console.log(`  Filled: ${action.result.filledQuantity} @ ${action.result.averagePrice ?? "—"}`);
  }
  if (action.failureReason) {
    console.log(`  ${action.failureReason.code}: ${action.failureReason.message}`);
  }
  for (const tx of action.transactions) {
    const failure = tx.failureReason
      ? ` · ${tx.failureReason.code}: ${tx.failureReason.message}`
      : "";
    console.log(`  - ${tx.label}: ${tx.status}${failure}`);
  }
  if (unconfirmed) {
    console.log(
      "  Status is unconfirmed. Check the portfolio for the venue's state before sending another action.",
    );
  }
}

function printMarket(market: Market): void {
  const operator = market.operator ? ` · ${market.operator.name}` : "";
  console.log(`\n${market.name}`);
  console.log(`  ID: ${market.id}`);
  console.log(`  Type: ${market.type} · ${market.assetClass}${operator}`);
  console.log(`  Status: ${formatStatus(market.status)}`);
  if (market.event) console.log(`  Event: ${market.event.title}`);
  if (market.outcomeLabel) console.log(`  Outcome: ${market.outcomeLabel}`);
  console.log(`  Price: ${formatMarketPrice(market)}`);
  if (market.type !== "prediction" && market.snapshot.markPrice) {
    console.log(`  Mark: ${market.snapshot.markPrice}`);
  }
  const change =
    market.type === "prediction" && market.snapshot.price == null
      ? "—"
      : formatFraction(market.snapshot.change24h);
  console.log(`  24h: ${change} · volume ${formatCompact(market.snapshot.volume24h)}`);
  if (market.snapshot.fundingRate) {
    const interval = market.snapshot.fundingIntervalSeconds
      ? ` / ${market.snapshot.fundingIntervalSeconds}s`
      : "";
    console.log(`  Funding: ${market.snapshot.fundingRate}${interval}`);
  }
  if (market.snapshot.openInterest) {
    console.log(`  Open interest: ${market.snapshot.openInterest}`);
  }
  const quote = market.quoteToken?.symbol ?? "quote";
  console.log(
    `  Min order: ${market.constraints.minOrderValue} ${quote} · quantity step ${market.constraints.quantityStep} · tick ${market.constraints.tickSize}`,
  );
  if (market.maxLeverage) console.log(`  Max leverage: ${market.maxLeverage}x`);
  if (market.fees) {
    const parts = [
      market.fees.makerBps != null ? `maker ${market.fees.makerBps} bps` : "",
      market.fees.takerBps != null ? `taker ${market.fees.takerBps} bps` : "",
    ].filter(Boolean);
    if (parts.length > 0) console.log(`  Fees: ${parts.join(" · ")}`);
  }
  console.log(`  Balance: ${market.balanceId}`);
  if (market.status.state === "close_only") {
    console.log("  Close only: sells, cancels and adding margin are available.");
  }
}

// ===== Prompts =====

async function promptChoice<T>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  current?: unknown,
): Promise<T> {
  if (choices.length === 0) throw new Error(`No choices for ${message}`);

  const used = new Set<string>();
  const unique = choices.map((choice) => {
    let name = choice.name;
    let suffix = 2;
    while (used.has(name)) name = `${choice.name} (${suffix++})`;
    used.add(name);
    return { name, value: choice.value };
  });

  let initial = 0;
  if (current !== undefined) {
    const index = unique.findIndex(
      (choice) => choice.value === current || sameToken(choice.value, current),
    );
    if (index >= 0) initial = index;
  }

  const response: any = await Enquirer.prompt({
    type: "select",
    name: "selected",
    message,
    choices: unique.map((choice) => choice.name),
    initial,
  } as any);

  const found = unique.find((choice) => choice.name === response.selected);
  if (!found) throw new Error("Invalid selection");
  return found.value;
}

async function confirm(message: string): Promise<boolean> {
  const response: any = await Enquirer.prompt({
    type: "confirm",
    name: "ok",
    message,
    initial: false,
  } as any);
  return Boolean(response.ok);
}

async function pause(): Promise<void> {
  await Enquirer.prompt({
    type: "input",
    name: "continue",
    message: "Press Enter to continue...",
  });
}

function fieldHint(field: ArgumentField): string {
  const parts = [field.description];
  if (field.unit) parts.push(field.unit);
  if (field.minimum != null) parts.push(`min ${field.minimum}`);
  if (field.maximum != null) parts.push(`max ${field.maximum}`);
  if (field.step != null) parts.push(`step ${field.step}`);
  return parts.filter(Boolean).join(" · ");
}

function withinRange(
  value: string,
  minimum?: string | number,
  maximum?: string | number,
): true | string {
  const number = Number(value);
  if (minimum != null && number < Number(minimum)) return `Must be at least ${minimum}`;
  if (maximum != null && number > Number(maximum)) return `Must be at most ${maximum}`;
  return true;
}

async function promptText(
  message: string,
  options: {
    initial?: string;
    required: boolean;
    nullable: boolean;
    validate: (input: string) => true | string;
  },
): Promise<string | null | undefined> {
  const skipHint = options.nullable ? 'empty skips, "clear" removes' : "optional";
  const response: any = await Enquirer.prompt({
    type: "input",
    name: "value",
    message: options.required ? message : `${message} (${skipHint})`,
    initial: options.initial ?? "",
    validate: (input: string) => {
      const value = input.trim();
      if (value === "") return options.required ? "Required" : true;
      if (value.toLowerCase() === "clear") {
        return options.nullable ? true : "This value cannot be cleared";
      }
      return options.validate(value);
    },
  } as any);

  const value = String(response.value ?? "").trim();
  if (value === "") return undefined;
  if (value.toLowerCase() === "clear") return null;
  return value;
}

function isVisible(field: ArgumentField, values: Record<string, unknown>): boolean {
  if (!field.visibleWhen) return true;
  const current = values[field.visibleWhen.field];
  if (current == null || current === "") return false;
  return field.visibleWhen.values.includes(String(current));
}

async function promptField(field: ArgumentField, current: unknown): Promise<unknown> {
  const message = `${field.label} — ${fieldHint(field)}`;

  if (field.type === "enum") {
    const options = (field.options ?? []) as ArgumentOption[];
    if (options.length === 0) throw new Error(`No options for ${field.label}`);
    const choices = options.map((option) => ({
      name: option.label,
      value: option.value as unknown,
    }));
    if (!field.required) choices.push({ name: "Skip", value: SKIP });
    const picked = await promptChoice(message, choices, current);
    return picked === SKIP ? undefined : picked;
  }

  if (field.type === "token") {
    const tokens = (field.options ?? []) as Token[];
    if (tokens.length === 0) throw new Error(`No tokens for ${field.label}`);
    const choices = tokens.map((token) => ({
      name: `${token.symbol} on ${token.network}`,
      value: tokenIdentifier(token) as unknown,
    }));
    if (!field.required) choices.push({ name: "Skip", value: SKIP });
    const picked = await promptChoice(message, choices, current);
    return picked === SKIP ? undefined : picked;
  }

  if (field.type === "boolean") {
    const choices: Array<{ name: string; value: unknown }> = [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ];
    if (!field.required) choices.push({ name: "Skip", value: SKIP });
    const picked = await promptChoice(message, choices, current);
    return picked === SKIP ? undefined : picked;
  }

  const initial = current == null ? "" : typeof current === "string" ? current : String(current);

  if (field.type === "integer") {
    const text = await promptText(message, {
      initial,
      required: field.required,
      nullable: field.nullable,
      validate: (input) => {
        if (!/^-?\d+$/.test(input)) return "Must be an integer";
        return withinRange(input, field.minimum, field.maximum);
      },
    });
    if (typeof text !== "string") return text;
    return Number(text);
  }

  if (field.type === "decimal") {
    return promptText(message, {
      initial,
      required: field.required,
      nullable: field.nullable,
      validate: (input) => {
        if (!/^-?\d+(\.\d+)?$/.test(input)) return "Must be a decimal";
        return withinRange(input, field.minimum, field.maximum);
      },
    });
  }

  if (field.type === "date") {
    const text = await promptText(message, {
      initial,
      required: field.required,
      nullable: field.nullable,
      validate: (input) => {
        const time = Date.parse(input);
        if (Number.isNaN(time)) return "Must be a date";
        if (field.minimum != null && time < Date.parse(String(field.minimum))) {
          return `Must be on or after ${field.minimum}`;
        }
        if (field.maximum != null && time > Date.parse(String(field.maximum))) {
          return `Must be on or before ${field.maximum}`;
        }
        return true;
      },
    });
    if (typeof text !== "string") return text;
    return new Date(text).toISOString();
  }

  return promptText(message, {
    initial,
    required: field.required,
    nullable: field.nullable,
    validate: (input) => {
      if (field.type === "address" && !/^0x[0-9a-fA-F]{40}$/.test(input)) {
        return "Must be a 0x address";
      }
      if (field.type === "url") {
        try {
          const url = new URL(input);
          if (!url.protocol.startsWith("http")) return "Must be an http(s) URL";
        } catch {
          return "Must be a URL";
        }
      }
      return true;
    },
  });
}

async function collectArguments(
  schema: ArgumentSchema | undefined,
  prefilled: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = schema?.fields ?? [];
  const values: Record<string, unknown> = {};

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(prefilled, field.name)) {
      values[field.name] = prefilled[field.name];
    } else if (field.default != null) {
      values[field.name] = field.default;
    }
  }

  for (const field of fields) {
    if (!isVisible(field, values)) {
      values[field.name] = undefined;
      continue;
    }
    values[field.name] = await promptField(field, values[field.name]);
  }

  const args: Record<string, unknown> = {};
  const fieldNames = new Set(fields.map((field) => field.name));
  for (const field of fields) {
    if (!isVisible(field, values)) continue;
    if (!Object.prototype.hasOwnProperty.call(values, field.name)) continue;
    const value = values[field.name];
    if (value === undefined || value === "") continue;
    args[field.name] = coerceField(field, value);
  }

  for (const [key, value] of Object.entries(prefilled)) {
    if (fieldNames.has(key) || value == null || value === "") continue;
    args[key] = value;
  }

  return args;
}

function coerceField(field: ArgumentField, value: unknown): unknown {
  if (value === null) return null;
  if (field.type === "integer") return typeof value === "number" ? value : Number(value);
  if (field.type === "decimal") return String(value);
  if (field.type === "boolean") return Boolean(value);
  if (field.type === "token") return tokenIdentifier(value as TokenIdentifier);
  return value;
}

function bindAction(
  action: PendingAction,
  target: { marketId?: string; providerId?: string },
): PendingAction {
  return {
    ...action,
    marketId: action.marketId ?? target.marketId,
    providerId: action.providerId ?? target.providerId,
  };
}

function actionRoute(action: string): ActionRoute {
  if (action === "buy" || action === "sell") return action;
  return "manage";
}

function actionBody(
  pending: PendingAction,
  address: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { address };
  if (pending.marketId) body.marketId = pending.marketId;
  else if (pending.providerId) body.providerId = pending.providerId;
  else throw new Error(`${pending.label} has no market or provider`);

  if (pending.action !== "buy" && pending.action !== "sell") body.action = pending.action;
  if (Object.keys(args).length > 0) body.arguments = args;
  return body;
}

// ===== Signing =====

function pastDeadline(value: string | null | undefined): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && Date.now() > time;
}

function describeSigning(tx: Transaction): string {
  const payload = tx.signablePayload as {
    domain?: { chainId?: number | string };
    chainId?: number | string;
  };
  const chain =
    tx.signingFormat === "eip712_typed_data" ? payload.domain?.chainId : payload.chainId;
  const chainText = chain != null ? ` · chain ${chain}` : "";
  const signer = tx.signerAddress ? `${tx.signer} ${tx.signerAddress}` : tx.signer;
  return `${tx.signingFormat} · ${signer} · ${tx.network}${chainText}`;
}

function lighterChainId(providerId: string | undefined): number | undefined {
  if (providerId === "lighter") return 304;
  if (providerId === "lighter-testnet") return 300;
  return undefined;
}

function lighterKeyEnv(chainId: number): { privateName: string; publicName: string } | undefined {
  if (chainId === 304) {
    return { privateName: "LIGHTER_TRADING_KEY", publicName: "LIGHTER_TRADING_PUBKEY" };
  }
  if (chainId === 300) {
    return {
      privateName: "LIGHTER_TESTNET_TRADING_KEY",
      publicName: "LIGHTER_TESTNET_TRADING_PUBKEY",
    };
  }
  return undefined;
}

function readEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function writeEnv(name: string, value: string): void {
  const file = path.join(process.cwd(), ".env");
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(current)
    ? current.replace(pattern, line)
    : `${current.replace(/\s*$/, "\n")}${line}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  process.env[name] = value;
}

async function ensureLighterTradingKey(chainId: number): Promise<string> {
  const names = lighterKeyEnv(chainId);
  if (!names) throw new Error(`Unsupported Lighter chain id ${chainId}`);

  const privateKey = readEnv(names.privateName);
  const publicKey = readEnv(names.publicName);
  if (privateKey && publicKey) return publicKey;
  if (privateKey) {
    throw new Error(
      `${names.privateName} is set but ${names.publicName} is empty. Add the matching public key. A new key would replace the one already saved.`,
    );
  }
  if (!lighterSignerPresent()) {
    throw new Error(
      "Lighter signer files are missing from vendor/lighter/. Build them with `pnpm build:lighter-signer` (needs Go 1.23).",
    );
  }

  const generated = await generateLighterApiKey();
  writeEnv(names.privateName, generated.privateKey);
  writeEnv(names.publicName, generated.publicKey);
  console.log("\nGenerated a new Lighter trading key.");
  console.log(`Public key: ${generated.publicKey}`);
  console.log(`The private key is saved in .env as ${names.privateName}. It is not shown here.`);
  console.log("Approving it replaces any trading key this app registered before.\n");
  return generated.publicKey;
}

function isNonceStale(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  return ((error.body ?? {}) as ErrorBody).details?.code === "NONCE_STALE";
}

async function signTransaction(tx: Transaction, wallet: HDNodeWallet): Promise<string> {
  const walletAddress = wallet.address.toLowerCase();

  if (tx.signingFormat === "lighter_schnorr") {
    const payload = tx.signablePayload as unknown as LighterSchnorrPayload;
    if (payload.requiresWalletSignature || tx.signer === "owner_and_trading_key") {
      if (tx.signerAddress && tx.signerAddress.toLowerCase() !== walletAddress) {
        throw new Error(
          `Transaction wants signer ${tx.signerAddress}, this wallet is ${wallet.address}`,
        );
      }
    }
    const names = lighterKeyEnv(payload.chainId);
    const privateKey = names ? readEnv(names.privateName) : "";
    if (!names || !privateKey) {
      throw new Error(
        "No Lighter trading key in .env. Run Approve a trading key on this provider first.",
      );
    }
    return signLighterPayload(payload, privateKey, (message) => wallet.signMessage(message));
  }

  if (tx.signer === "trading_key" || tx.signer === "owner_and_trading_key") {
    throw new UnsupportedSigning(
      `This step must be signed by ${tx.signer}${tx.signerAddress ? ` (${tx.signerAddress})` : ""}.`,
    );
  }
  if (tx.signerAddress && tx.signerAddress.toLowerCase() !== walletAddress) {
    throw new Error(
      `Transaction wants signer ${tx.signerAddress}, this wallet is ${wallet.address}`,
    );
  }

  if (tx.signingFormat === "eip712_typed_data") {
    const payload = tx.signablePayload as Eip712TypedDataPayload;
    // ethers v6 takes the domain separately and rejects EIP712Domain in types.
    const { EIP712Domain: _, ...types } = payload.types;
    return wallet.signTypedData(payload.domain, types, payload.message);
  }

  if (tx.signingFormat === "evm_transaction") {
    const payload = tx.signablePayload as EvmTransactionPayload;
    if (payload.from.toLowerCase() !== walletAddress) {
      throw new Error(`Transaction is from ${payload.from}, this wallet is ${wallet.address}`);
    }
    return wallet.signTransaction({
      type: 2,
      to: payload.to,
      data: payload.data,
      value: BigInt(payload.value),
      gasLimit: BigInt(payload.gasLimit),
      maxFeePerGas: BigInt(payload.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(payload.maxPriorityFeePerGas),
      chainId: payload.chainId,
      nonce: payload.nonce,
    });
  }

  throw new UnsupportedSigning(`Unsupported signing format ${tx.signingFormat}`);
}

async function pollTransaction(
  client: TradeClient,
  action: Action,
  transactionId: string,
): Promise<Action> {
  const started = Date.now();
  let current = action;
  process.stdout.write("  Waiting for confirmation");
  while (Date.now() - started < TRANSACTION_WAIT_MS) {
    const tx = current.transactions.find((item) => item.id === transactionId);
    if (!tx) break;
    if (tx.status === "CONFIRMED" || tx.status === "FAILED") break;
    if (current.status === "FAILED" || current.status === "SUCCESS") break;
    if (pastDeadline(tx.submitBy) && tx.status === "CREATED") break;
    await sleep(TRANSACTION_POLL_MS);
    process.stdout.write(".");
    current = await client.getAction(current.id);
  }
  process.stdout.write("\n");
  return current;
}

async function pollAction(client: TradeClient, action: Action): Promise<Action> {
  const estimateMs = (action.summary?.estimatedDurationSeconds ?? 0) * 1000;
  const timeout = Math.min(Math.max(ACTION_WAIT_MS, estimateMs + 15_000), 180_000);
  const interval = action.action === "deposit" || action.action === "withdraw" ? 5000 : 2000;
  const started = Date.now();
  let current = action;
  while (
    (current.status === "CREATED" || current.status === "PROCESSING") &&
    Date.now() - started < timeout
  ) {
    await sleep(interval);
    current = await client.getAction(current.id);
  }
  return current;
}

async function signAction(
  client: TradeClient,
  wallet: HDNodeWallet,
  action: Action,
): Promise<ActionOutcome> {
  let current = action;

  for (let index = 0; index < current.transactions.length; index++) {
    current = await client.getAction(current.id);
    const tx = current.transactions[index];
    if (!tx || tx.status === "CONFIRMED") continue;

    if (tx.status === "FAILED" || current.status === "FAILED") {
      printActionResult(current, false);
      return "failed";
    }

    if (tx.status !== "CREATED") {
      current = await pollTransaction(client, current, tx.id);
      const updated = current.transactions.find((item) => item.id === tx.id);
      if (updated?.status === "CONFIRMED") continue;
      const failed = updated?.status === "FAILED" || current.status === "FAILED";
      printActionResult(current, !failed);
      return failed ? "failed" : "unconfirmed";
    }

    if (pastDeadline(tx.submitBy) || pastDeadline(current.submitBy)) {
      console.log(`\nThe submit window ended (${tx.submitBy}).`);
      printActionResult(current, true);
      return "unconfirmed";
    }

    console.log(`\nSigning ${index + 1}/${current.transactions.length}: ${tx.label}`);
    console.log(`  ${describeSigning(tx)}`);

    let signedPayload: string;
    try {
      signedPayload = await signTransaction(tx, wallet);
    } catch (error) {
      if (error instanceof UnsupportedSigning) {
        console.log(error.message);
        return "cancelled";
      }
      throw error;
    }

    current = await client.submit(tx.id, signedPayload);
    current = await pollTransaction(client, current, tx.id);
    const updated = current.transactions.find((item) => item.id === tx.id);
    console.log(`  ${tx.label}: ${updated?.status ?? "unknown"}`);
    if (updated?.failureReason) {
      console.log(`  ${updated.failureReason.code}: ${updated.failureReason.message}`);
    }
    if (updated?.status !== "CONFIRMED") {
      const failed = updated?.status === "FAILED" || current.status === "FAILED";
      printActionResult(current, !failed);
      return failed ? "failed" : "unconfirmed";
    }
  }

  if (current.status !== "SUCCESS" && current.status !== "FAILED") {
    console.log("Waiting for the action to finish...");
    current = await pollAction(client, current);
  }
  const unconfirmed = current.status === "CREATED" || current.status === "PROCESSING";
  printActionResult(current, unconfirmed);
  if (current.status === "SUCCESS") return "success";
  if (current.status === "FAILED") return "failed";
  return "unconfirmed";
}

async function resolveSchema(
  client: TradeClient,
  pending: PendingAction,
): Promise<ArgumentSchema | undefined> {
  if (pending.argumentSchema) return pending.argumentSchema;
  if (pending.marketId) {
    const market = await client.getMarket(pending.marketId);
    return market.actions.find((action) => action.action === pending.action)?.argumentSchema;
  }
  if (pending.providerId) {
    const provider = await client.getProvider(pending.providerId);
    return provider.actions.find((action) => action.action === pending.action)?.argumentSchema;
  }
  return undefined;
}

async function finishRequirements(
  client: TradeClient,
  wallet: HDNodeWallet,
  pending: PendingAction,
  body: Record<string, unknown>,
  requirements: PendingAction[],
  depth: number,
): Promise<ActionOutcome> {
  console.log("\nSteps required first:");
  requirements.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.label} (${step.action})`);
  });

  const first = requirements[0];
  const accepted = await confirm(`Run "${first.label}" now?`);
  if (!accepted) {
    console.log("Cancelled\n");
    return "cancelled";
  }

  const outcome = await runPending(client, wallet, first, depth + 1);
  if (outcome !== "success") {
    console.log("The required step did not finish. The original action was not created.");
    return outcome;
  }
  return submitPrepared(client, wallet, pending, body, depth + 1);
}

async function submitPrepared(
  client: TradeClient,
  wallet: HDNodeWallet,
  pending: PendingAction,
  body: Record<string, unknown>,
  depth: number,
  allowNonceRetry = true,
): Promise<ActionOutcome> {
  if (depth > MAX_REQUIREMENT_DEPTH) {
    console.log("Stopped: too many required steps.");
    return "failed";
  }

  const route = actionRoute(pending.action);
  let simulation: SimulateResult;
  try {
    simulation = await client.simulate(route, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 412) {
      const requirements = ((error.body ?? {}) as ErrorBody).details?.requirements ?? [];
      if (requirements.length > 0) {
        return finishRequirements(client, wallet, pending, body, requirements, depth);
      }
    }
    printApiError(error);
    return "failed";
  }

  printSummary(simulation.summary);
  if (simulation.requirements.length > 0) {
    return finishRequirements(client, wallet, pending, body, simulation.requirements, depth);
  }

  const accepted = await confirm(`Create and sign ${pending.label}?`);
  if (!accepted) {
    console.log("Cancelled\n");
    return "cancelled";
  }

  let action: Action;
  try {
    action = await client.create(route, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 412) {
      const requirements = ((error.body ?? {}) as ErrorBody).details?.requirements ?? [];
      if (requirements.length > 0) {
        return finishRequirements(client, wallet, pending, body, requirements, depth);
      }
    }
    if (allowNonceRetry && isNonceStale(error)) {
      console.log("Lighter nonce was stale. Building this action again.");
      return submitPrepared(client, wallet, pending, body, depth, false);
    }
    printApiError(error);
    return "failed";
  }

  console.log(`\nCreated ${action.id}`);
  if (action.submitBy) console.log(`  Submit by ${formatWhen(action.submitBy)}`);
  return signAction(client, wallet, action);
}

async function runPending(
  client: TradeClient,
  wallet: HDNodeWallet,
  pending: PendingAction,
  depth = 0,
): Promise<ActionOutcome> {
  try {
    console.log(`\n${pending.label} (${pending.action})`);
    const schema = await resolveSchema(client, pending);
    if (schema?.notes) console.log(`\n${schema.notes}\n`);
    if (!schema?.fields?.length) console.log("This action takes no arguments.");

    let current = pending;
    const chainId = lighterChainId(pending.providerId);
    if (pending.action === "approve_trading_key" && chainId) {
      const publicKey = await ensureLighterTradingKey(chainId);
      current = {
        ...pending,
        arguments: { ...pending.arguments, tradingKey: publicKey },
      };
    }

    const args = await collectArguments(schema, current.arguments ?? {});
    const body = actionBody(current, wallet.address, args);
    return await submitPrepared(client, wallet, current, body, depth);
  } catch (error) {
    printApiError(error);
    return "failed";
  }
}

// ===== Screens =====

function formatTpSl(tpSl: PositionTpSl | undefined): string {
  if (!tpSl || tpSl.status !== "set") return "none";
  return `tp ${tpSl.takeProfitPrice ?? "—"} / sl ${tpSl.stopLossPrice ?? "—"}`;
}

async function showPortfolio(
  client: TradeClient,
  wallet: HDNodeWallet,
  providerId: string,
): Promise<void> {
  const portfolio = await client.getPortfolio(providerId, wallet.address);
  console.log(`\nEquity: ${portfolio.equityUsd} USD\n`);

  console.log("Balances");
  if (portfolio.balances.length === 0) console.log("  None");
  for (const balance of portfolio.balances) {
    console.log(
      `  ${balance.label}: ${balance.total} ${balance.token.symbol} (${balance.available} available, $${balance.availableUsd})`,
    );
    console.log(`    Pays: ${balance.balanceIds.join(", ")}`);
    if (balance.pendingActions.length > 0) {
      console.log(
        `    Actions: ${balance.pendingActions.map((action) => action.label).join(", ")}`,
      );
    }
  }

  console.log("\nPositions");
  if (portfolio.positions.length === 0) console.log("  None");
  for (const position of portfolio.positions) {
    const side = position.side ? `${position.side} ` : "";
    const leverage = position.leverage
      ? ` · ${position.leverage}x ${position.marginMode ?? ""}`
      : "";
    const pnl = position.unrealizedPnl == null ? "" : ` · pnl ${position.unrealizedPnl}`;
    console.log(
      `  ${side}${position.marketId} · qty ${position.quantity} · mark ${position.markPrice}${leverage}${pnl}`,
    );
    if (position.entryPrice) console.log(`    Entry ${position.entryPrice}`);
    if (position.liquidationPrice) console.log(`    Liquidation ${position.liquidationPrice}`);
    if (position.margin) console.log(`    Margin ${position.margin}`);
    if (position.tpSl) console.log(`    TP/SL ${formatTpSl(position.tpSl)}`);
  }

  console.log("\nOrders");
  if (portfolio.orders.length === 0) console.log("  None");
  for (const order of portfolio.orders) {
    const side = order.side ? `${order.side} ` : "";
    const limit = order.limitPrice ? ` · limit ${order.limitPrice}` : "";
    const trigger = order.triggerPrice ? ` · trigger ${order.triggerPrice}` : "";
    console.log(
      `  ${order.id} · ${order.orderType} ${side}${order.marketId} · qty ${order.quantity}${limit}${trigger}`,
    );
  }
  if (portfolio.ordersTruncated) console.log("  Order list is truncated by the provider.");

  console.log("\nSetup");
  if (portfolio.setup.length === 0) console.log("  None");
  for (const step of portfolio.setup) console.log(`  ${step.label} (${step.action})`);

  console.log("\nTrading keys");
  if (portfolio.tradingKeys.length === 0) console.log("  None");
  for (const key of portfolio.tradingKeys) {
    const expiry = key.expiresAt ? ` · expires ${formatWhen(key.expiresAt)}` : "";
    console.log(`  ${key.tradingKey}${expiry}`);
  }

  const rows: Array<{ name: string; actions: PendingAction[] }> = [];
  for (const balance of portfolio.balances) {
    if (balance.pendingActions.length === 0) continue;
    rows.push({
      name: `Balance · ${balance.label} · ${balance.available} ${balance.token.symbol} available`,
      actions: balance.pendingActions.map((action) =>
        bindAction(action, { providerId: balance.providerId }),
      ),
    });
  }
  for (const position of portfolio.positions) {
    if (position.pendingActions.length === 0) continue;
    const side = position.side ? `${position.side} ` : "";
    rows.push({
      name: `Position · ${side}${position.marketId} · qty ${position.quantity}`,
      actions: position.pendingActions.map((action) =>
        bindAction(action, { marketId: position.marketId, providerId: position.providerId }),
      ),
    });
  }
  for (const order of portfolio.orders) {
    if (order.pendingActions.length === 0) continue;
    rows.push({
      name: `Order · ${order.orderType} ${order.side ?? ""} ${order.marketId} · ${order.id}`,
      actions: order.pendingActions.map((action) =>
        bindAction(action, { marketId: order.marketId, providerId: order.providerId }),
      ),
    });
  }
  for (const step of portfolio.setup) {
    rows.push({
      name: `Setup · ${step.label}`,
      actions: [bindAction(step, { providerId: providerId })],
    });
  }

  if (rows.length === 0) {
    console.log("\nNo pending actions.\n");
    return;
  }

  const selected = await promptChoice("Manage a row", [
    ...rows.map((row) => ({ name: row.name, value: row })),
    { name: "Back", value: undefined },
  ]);
  if (!selected) return;

  const action =
    selected.actions.length === 1
      ? selected.actions[0]
      : await promptChoice("Select an action", [
          ...selected.actions.map((item) => ({ name: item.label, value: item })),
          { name: "Back", value: undefined },
        ]);
  if (!action) return;
  await runPending(client, wallet, action);
}

function marketChoiceLabel(market: Market): string {
  const price = formatMarketPrice(market);
  const status = market.status.state === "open" ? "" : ` · ${market.status.state}`;
  if (market.type === "prediction") {
    const title = market.event?.title ?? market.name;
    const outcome = market.outcomeLabel ?? market.name;
    return `${title} · ${outcome} · ${price}${status}`;
  }
  const operator = market.operator ? ` · ${market.operator.name}` : "";
  return `${market.baseSymbol} · ${market.name} · ${price}${operator}${status}`;
}

function printMarketList(markets: Market[]): void {
  const predictions = markets.filter((market) => market.type === "prediction");
  if (predictions.length > 0 && predictions.length === markets.length) {
    const groups = new Map<string, Market[]>();
    for (const market of markets) {
      const key = market.event?.id ?? market.id;
      const group = groups.get(key) ?? [];
      group.push(market);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      console.log(`\n${group[0].event?.title ?? group[0].name}`);
      for (const market of group) {
        console.log(
          `  ${market.outcomeLabel || market.name}  ${formatMarketPrice(market)}  ${formatStatus(market.status)}`,
        );
      }
    }
    console.log("");
    return;
  }

  for (const market of markets) {
    console.log(
      `${market.baseSymbol.padEnd(12)}${formatMarketPrice(market).padEnd(16)}${formatFraction(market.snapshot.change24h).padEnd(10)}${market.status.state.padEnd(12)}${market.name}`,
    );
  }
  console.log("");
}

async function showTrade(
  client: TradeClient,
  wallet: HDNodeWallet,
  provider: Provider,
): Promise<void> {
  const supported = new Set(provider.types);
  const typeChoices: Array<{ name: string; value: { type: string; assetClass?: string } }> = [
    { name: "Perps", value: { type: "perps" } },
    { name: "Stock perps", value: { type: "perps", assetClass: "stock" } },
    { name: "Spot", value: { type: "spot" } },
    { name: "Prediction", value: { type: "prediction" } },
  ];

  const filter = await promptChoice<{ type: string; assetClass?: string } | undefined>(
    "Market type",
    [
      ...typeChoices.filter((choice) => supported.has(choice.value.type)),
      { name: "Back", value: undefined },
    ],
  );
  if (!filter) return;

  let operatorId: string | undefined;
  if (provider.operators.length > 0) {
    const operator = await promptChoice("Operator", [
      { name: "Any operator", value: "" },
      ...provider.operators.map((item) => ({ name: `${item.name} (${item.id})`, value: item.id })),
    ]);
    if (operator) operatorId = operator;
  }

  const searchResponse: any = await Enquirer.prompt({
    type: "input",
    name: "value",
    message: "Search markets (empty shows the top by volume)",
  });
  const search = String(searchResponse.value ?? "").trim();

  const query: Record<string, string> = {
    providerId: provider.id,
    type: filter.type,
    limit: "100",
    sort: "volume",
  };
  if (filter.assetClass) query.assetClass = filter.assetClass;
  if (operatorId) query.operatorId = operatorId;
  if (search) query.search = search;

  const page = await client.getMarkets(query);
  if (page.items.length === 0) {
    console.log("\nNo markets matched.\n");
    return;
  }

  console.log(
    page.hasMore
      ? `\nShowing ${page.items.length} of ${page.total}. Refine the search to narrow this list.\n`
      : `\n${page.total} market${page.total === 1 ? "" : "s"}\n`,
  );
  printMarketList(page.items);

  const used = new Set<string>();
  const choices = page.items.map((market) => {
    let name = marketChoiceLabel(market);
    let suffix = 2;
    while (used.has(name)) name = `${marketChoiceLabel(market)} (${suffix++})`;
    used.add(name);
    return { name, market };
  });

  const selection: any = await Enquirer.prompt({
    type: "autocomplete",
    name: "selection",
    message: "Select a market",
    limit: 15,
    choices: choices.map((choice) => choice.name),
  } as any);
  const selected = choices.find((choice) => choice.name === selection.selection);
  if (!selected) throw new Error("Market not found");

  const market = await client.getMarket(selected.market.id);
  printMarket(market);

  try {
    const portfolio = await client.getPortfolio(provider.id, wallet.address);
    const position = portfolio.positions.find((item) => item.marketId === market.id);
    if (position) {
      const side = position.side ? `${position.side} ` : "";
      console.log(
        `\nOpen position: ${side}qty ${position.quantity} · entry ${position.entryPrice ?? "—"} · pnl ${position.unrealizedPnl ?? "—"}`,
      );
    }
    const orders = portfolio.orders.filter((order) => order.marketId === market.id);
    for (const order of orders) {
      console.log(
        `Open order: ${order.orderType} ${order.side ?? ""} qty ${order.quantity} · ${order.id}`,
      );
    }
  } catch (error) {
    printApiError(error);
  }

  const actions = market.actions.filter(
    (action) => action.action !== "buy" || market.status.state === "open",
  );
  if (market.status.state !== "open") {
    console.log(`\nBuy is unavailable while the market is ${formatStatus(market.status)}.`);
  }
  if (actions.length === 0) {
    console.log("\nThis market has no actions right now.\n");
    return;
  }

  const action = await promptChoice("Select an action", [
    ...actions.map((item) => ({ name: `${item.label} (${item.action})`, value: item })),
    { name: "Back", value: undefined },
  ]);
  if (!action) return;

  await runPending(client, wallet, {
    ...action,
    marketId: action.marketId ?? market.id,
  });
}

async function showAccount(
  client: TradeClient,
  wallet: HDNodeWallet,
  providerId: string,
): Promise<void> {
  const provider = await client.getProvider(providerId);
  if (provider.actions.length === 0) {
    console.log("\nThis provider has no account actions.\n");
    return;
  }

  const action = await promptChoice("Account action", [
    ...provider.actions.map((item) => ({ name: `${item.label} (${item.action})`, value: item })),
    { name: "Back", value: undefined },
  ]);
  if (!action) return;

  await runPending(client, wallet, {
    ...action,
    providerId: action.providerId ?? provider.id,
  });
}

async function showHistory(
  client: TradeClient,
  address: string,
  providerId: string,
): Promise<void> {
  const [actions, fills] = await Promise.all([
    client.getActions(providerId, address),
    client.getFills(providerId, address),
  ]);

  console.log("\nActions");
  if (actions.items.length === 0) console.log("  None");
  for (const action of actions.items) {
    const failure = action.failureReason ? ` · ${action.failureReason.code}` : "";
    const filled = action.result ? ` · filled ${action.result.filledQuantity}` : "";
    console.log(
      `  ${formatWhen(action.createdAt)}  ${action.action}  ${action.marketId ?? action.providerId}  ${action.status}${filled}${failure}`,
    );
    console.log(`    ${action.id}`);
  }
  if (actions.hasMore)
    console.log(`  ${actions.total} total. Showing the latest ${actions.items.length}.`);

  console.log("\nFills");
  if (fills.items.length === 0) console.log("  None");
  for (const fill of fills.items) {
    const side = fill.side ? `${fill.side} ` : "";
    const pnl = fill.realizedPnl ? ` · pnl ${fill.realizedPnl}` : "";
    console.log(
      `  ${formatWhen(fill.createdAt)}  ${fill.fillType}  ${fill.effect} ${side}${fill.marketId}  ${fill.quantity} @ ${fill.price}${pnl}`,
    );
  }
  if (fills.hasMore)
    console.log(`  ${fills.total} total. Showing the latest ${fills.items.length}.`);
  console.log("");
}

async function chooseProvider(client: TradeClient): Promise<Provider | undefined> {
  const page = await client.getProviders();
  if (page.items.length === 0) {
    console.log("No providers available.");
    return undefined;
  }

  return promptChoice("Select a provider", [
    ...page.items.map((provider) => ({
      name: `${provider.name} (${provider.id}) · ${provider.types.join(", ")}`,
      value: provider,
    })),
    { name: "Exit", value: undefined },
  ]);
}

async function session(
  client: TradeClient,
  wallet: HDNodeWallet,
  provider: Provider,
): Promise<"switch" | "exit"> {
  console.log(`\nProvider: ${provider.name} (${provider.id})\n`);

  while (true) {
    let portfolio: Portfolio | undefined;
    try {
      portfolio = await client.getPortfolio(provider.id, wallet.address);
    } catch (error) {
      printApiError(error);
    }

    if (portfolio) {
      console.log(
        `Equity ${portfolio.equityUsd} USD · ${portfolio.positions.length} positions · ${portfolio.orders.length} orders`,
      );
    }

    const choice = await promptChoice("Main menu", [
      { name: "Portfolio", value: "portfolio" },
      { name: "Trade", value: "trade" },
      { name: "Account", value: "account" },
      { name: "History", value: "history" },
      { name: "Switch provider", value: "switch" },
      { name: "Exit", value: "exit" },
    ]);

    if (choice === "switch" || choice === "exit") return choice;

    try {
      if (choice === "portfolio") await showPortfolio(client, wallet, provider.id);
      if (choice === "trade") await showTrade(client, wallet, provider);
      if (choice === "account") await showAccount(client, wallet, provider.id);
      if (choice === "history") await showHistory(client, wallet.address, provider.id);
    } catch (error) {
      printApiError(error);
    }

    console.log(`\n${"─".repeat(60)}\n`);
    await pause();
  }
}

async function main(): Promise<void> {
  console.log("\nYield.xyz Trade API\n");

  const apiKey = process.env.TRADE_API_KEY;
  const mnemonic = process.env.MNEMONIC;
  if (!apiKey || !mnemonic) {
    console.error("Error: MNEMONIC and TRADE_API_KEY environment variables are required");
    process.exit(1);
  }

  const apiUrl = process.env.TRADE_API_URL || "https://trade.stg.yield.xyz";
  const client = new TradeClient(apiUrl, apiKey);
  console.log(`API URL: ${apiUrl}`);

  const walletIndex = Number.parseInt(process.env.WALLET_INDEX || "0", 10);
  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, `m/44'/60'/0'/0/${walletIndex}`);
  console.log(`Address: ${wallet.address}\n`);

  while (true) {
    const provider = await chooseProvider(client);
    if (!provider) {
      console.log("\nGoodbye!\n");
      return;
    }
    const next = await session(client, wallet, provider);
    if (next === "exit") {
      console.log("\nGoodbye!\n");
      return;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/i.test(message)) {
    console.log("\nGoodbye!\n");
    process.exit(0);
  }
  console.error("Script failed:", message);
  process.exit(1);
});
