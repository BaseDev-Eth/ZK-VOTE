import { config } from "../config.js";

/**
 * Returns network-aware Stellar Expert URL.
 * Automatically inspects networkPassphrase or horizonUrl/rpcUrl to resolve 'testnet', 'futurenet', 'public'.
 */
export function getExplorerUrl(type: "tx" | "account" | "contract", id: string): string {
  const passphrase = (config.networkPassphrase || "").toLowerCase();
  let net = "testnet";
  if (passphrase.includes("futurenet")) {
    net = "futurenet";
  } else if (passphrase.includes("public")) {
    net = "public";
  }
  return `https://stellar.expert/explorer/${net}/${type}/${id}`;
}
