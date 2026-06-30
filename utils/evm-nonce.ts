/**
 * EVM provider/nonce/broadcast helpers shared across recipes.
 *
 * The Yield.xyz APIs stamp a nonce onto the `signablePayload` they hand back
 * and then broadcast the signed tx server-side via `/submit`. Both of those
 * steps can fail in ways the recipe can recover from locally:
 *
 *   - Stale nonce on the API → reconcile with the chain's pending count.
 *   - Server-side broadcast failure (503 "Transaction broadcast failed") →
 *     rebroadcast the signed tx ourselves, then tell the API the resulting
 *     hash via `/submit { transactionHash }`.
 *
 * This module provides a cached `JsonRpcProvider` per network plus helpers
 * for both flows.
 */

import "cross-fetch/polyfill";
import { JsonRpcProvider, type TransactionResponse } from "ethers";

// Public, free RPC endpoints that are sufficient for read-only nonce lookups.
// Users can override any of these via `RPC_URL_<NETWORK>` env vars where
// <NETWORK> is the uppercased network slug with dashes replaced by underscores
// (e.g. `RPC_URL_BASE`, `RPC_URL_ARBITRUM_ONE`).
const DEFAULT_RPC_URLS: Record<string, string> = {
  ethereum: "https://eth.llamarpc.com",
  mainnet: "https://eth.llamarpc.com",
  base: "https://mainnet.base.org",
  "base-sepolia": "https://sepolia.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  "arbitrum-one": "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  "optimism-mainnet": "https://mainnet.optimism.io",
  binance: "https://bsc-dataseed.binance.org",
  bsc: "https://bsc-dataseed.binance.org",
  bnb: "https://bsc-dataseed.binance.org",
  "bnb-smart-chain": "https://bsc-dataseed.binance.org",
  polygon: "https://polygon-rpc.com",
  matic: "https://polygon-rpc.com",
  avalanche: "https://api.avax.network/ext/bc/C/rpc",
  "avalanche-c": "https://api.avax.network/ext/bc/C/rpc",
  linea: "https://rpc.linea.build",
  scroll: "https://rpc.scroll.io",
  zksync: "https://mainnet.era.zksync.io",
  "zksync-era": "https://mainnet.era.zksync.io",
  gnosis: "https://rpc.gnosischain.com",
  celo: "https://forno.celo.org",
};

export function getRpcUrl(network: string): string | undefined {
  if (!network) return undefined;
  const envKey = `RPC_URL_${network.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envKey] || DEFAULT_RPC_URLS[network.toLowerCase()];
}

const providerCache = new Map<string, JsonRpcProvider>();
export function getProvider(network: string): JsonRpcProvider | undefined {
  const rpcUrl = getRpcUrl(network);
  if (!rpcUrl) return undefined;
  let provider = providerCache.get(rpcUrl);
  if (!provider) {
    provider = new JsonRpcProvider(rpcUrl);
    providerCache.set(rpcUrl, provider);
  }
  return provider;
}

/**
 * Fetch the next nonce (including pending mempool txs) for `address` on
 * `network`. Returns `undefined` if no RPC is configured for the network or
 * the call fails so callers can fall back to the API-supplied nonce.
 */
export async function fetchPendingNonce(
  address: string,
  network: string,
): Promise<number | undefined> {
  const provider = getProvider(network);
  if (!provider) return undefined;
  try {
    return await provider.getTransactionCount(address, "pending");
  } catch (err: any) {
    console.warn(
      `Could not fetch pending nonce for ${address} on ${network}: ${err?.message || err}`,
    );
    return undefined;
  }
}

/**
 * Broadcast a serialized signed transaction directly to the chain via the
 * configured RPC. Returns the resulting tx hash, or `undefined` if no RPC
 * is available so callers can decide what to do.
 *
 * If the chain reports the tx is already known / already mined (e.g. because
 * the backend's broadcast actually went through despite returning an error),
 * the existing hash is extracted from the error and returned.
 */
export async function broadcastSignedTx(
  signedTx: string,
  network: string,
): Promise<string | undefined> {
  const provider = getProvider(network);
  if (!provider) return undefined;

  try {
    const response: TransactionResponse = await provider.broadcastTransaction(signedTx);
    return response.hash;
  } catch (err: any) {
    const msg: string = err?.message || String(err);
    if (/already known|already in mempool|nonce.*too low|already exists/i.test(msg)) {
      const hashMatch = msg.match(/0x[a-fA-F0-9]{64}/);
      if (hashMatch) {
        console.warn(`  Tx already broadcast; reusing hash ${hashMatch[0]}`);
        return hashMatch[0];
      }
    }
    throw err;
  }
}

/**
 * Heuristic: did `error` come from the API's `/submit` endpoint reporting a
 * broadcast failure that we can plausibly recover from by broadcasting
 * locally? We look for a 5xx plus the canonical "broadcast failed" phrase.
 */
export function isApiBroadcastFailure(error: unknown): boolean {
  const msg = (error as any)?.message;
  if (typeof msg !== "string") return false;
  return /\(Status:\s*5\d\d\)/.test(msg) && /broadcast/i.test(msg);
}
