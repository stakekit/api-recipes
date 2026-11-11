/**
 * Lighter trading-key signer.
 *
 * Loads the Node WASM build of lighter-go v1.0.10 (see scripts/build-lighter-signer.sh).
 * The private key stays in this process. Callers must not log it.
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const loadModule = createRequire(__filename);

export interface LighterSchnorrPayload {
  fn: string;
  args: unknown[];
  accountIndex: number;
  apiKeyIndex: number;
  chainId: number;
  requiresWalletSignature: boolean;
}

export interface LighterKeyPair {
  privateKey: string;
  publicKey: string;
}

interface LighterCallResult {
  error?: string;
  privateKey?: string;
  publicKey?: string;
  txInfo?: string;
  messageToSign?: string;
  authToken?: string;
}

interface GoRuntime {
  importObject: WebAssembly.Imports;
  run: (instance: WebAssembly.Instance) => Promise<void>;
}

const VENDOR_DIR = path.join(__dirname, "..", "vendor", "lighter");

const LIGHTER_URLS: Record<number, string> = {
  304: "https://mainnet.zklighter.elliot.ai",
  300: "https://testnet.zklighter.elliot.ai",
};

const readyClients = new Set<string>();
let loading: Promise<void> | undefined;

function signerMissingError(): Error {
  return new Error(
    "Lighter signer files are missing from vendor/lighter/. Build them with `pnpm build:lighter-signer` (needs Go 1.23).",
  );
}

export function lighterSignerPresent(): boolean {
  return (
    fs.existsSync(path.join(VENDOR_DIR, "lighter-signer.wasm")) &&
    fs.existsSync(path.join(VENDOR_DIR, "wasm_exec.js"))
  );
}

export async function loadLighterSigner(): Promise<void> {
  if (!loading) {
    loading = startSigner().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  }
  return loading;
}

async function startSigner(): Promise<void> {
  const wasmPath = path.join(VENDOR_DIR, "lighter-signer.wasm");
  const execPath = path.join(VENDOR_DIR, "wasm_exec.js");
  if (!fs.existsSync(wasmPath) || !fs.existsSync(execPath)) {
    throw signerMissingError();
  }

  loadModule(execPath);
  const GoCtor = (globalThis as { Go?: new () => GoRuntime }).Go;
  if (!GoCtor) {
    throw new Error("Lighter wasm_exec.js did not define Go");
  }

  const go = new GoCtor();
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  // main() registers the signer functions, then blocks. Don't wait for it to exit.
  void go.run(instance).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Lighter signer stopped: ${message}`);
  });

  for (let attempt = 0; attempt < 50; attempt++) {
    if (typeof (globalThis as { GenerateAPIKey?: unknown }).GenerateAPIKey === "function") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Lighter signer did not start");
}

function callSigner(fn: string, args: unknown[]): LighterCallResult {
  const target = (globalThis as Record<string, unknown>)[fn];
  if (typeof target !== "function") {
    throw new Error(`Lighter signer has no ${fn}`);
  }
  const result = (target as (...values: unknown[]) => LighterCallResult)(...args);
  if (result?.error) throw new Error(result.error);
  return result ?? {};
}

export async function generateLighterApiKey(): Promise<LighterKeyPair> {
  await loadLighterSigner();
  const result = callSigner("GenerateAPIKey", []);
  if (!result.privateKey || !result.publicKey) {
    throw new Error("Lighter signer did not return a key pair");
  }
  return { privateKey: result.privateKey, publicKey: result.publicKey };
}

function lighterApiUrl(chainId: number): string {
  const override =
    chainId === 304 ? process.env.LIGHTER_API_URL : process.env.LIGHTER_TESTNET_API_URL;
  const url = (override || LIGHTER_URLS[chainId] || "").trim();
  if (!url) throw new Error(`Unsupported Lighter chain id ${chainId}`);
  return url;
}

async function ensureClient(
  privateKey: string,
  chainId: number,
  apiKeyIndex: number,
  accountIndex: number,
): Promise<void> {
  const cacheKey = `${chainId}:${apiKeyIndex}:${accountIndex}`;
  if (readyClients.has(cacheKey)) return;
  callSigner("CreateClient", [
    lighterApiUrl(chainId),
    privateKey,
    chainId,
    apiKeyIndex,
    accountIndex,
  ]);
  readyClients.add(cacheKey);
}

export async function signLighterPayload(
  payload: LighterSchnorrPayload,
  privateKey: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  await loadLighterSigner();
  await ensureClient(privateKey, payload.chainId, payload.apiKeyIndex, payload.accountIndex);
  const result = callSigner(payload.fn, payload.args);

  if (payload.fn === "CreateAuthToken") {
    if (!result.authToken) throw new Error("Lighter signer did not return an auth token");
    return result.authToken;
  }

  if (typeof result.txInfo !== "string" || result.txInfo.length === 0) {
    throw new Error(`Lighter signer did not return txInfo for ${payload.fn}`);
  }

  if (!payload.requiresWalletSignature) return result.txInfo;
  if (!result.messageToSign) {
    throw new Error(`Lighter signer did not return a wallet message for ${payload.fn}`);
  }

  const signature = await signMessage(result.messageToSign);
  const parsed = JSON.parse(result.txInfo) as Record<string, unknown>;
  parsed.L1Sig = signature;
  return JSON.stringify(parsed);
}
