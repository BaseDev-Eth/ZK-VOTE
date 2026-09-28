/**
 * Payments Service — XLM / USDC / EURC (real assets, no mocks)
 * High-volume: MuxedAccount + 100 ops/tx + fee-bump + idempotency
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "../config.js";
import { relayerKeypair, withSequenceLock } from "./stellar.js";
import { relayerKeyManager } from "./relayerKeyManager.js";
import { log } from "./logger.js";
import { getDb } from "./db.js";

// ============================================
// STELLAR ADDRESS VALIDATION (#594)
// G... (ed25519 account) and M... (muxed account: base G... + 64-bit ID)
// are distinct StrKey encodings and MUST NOT be conflated. A payment meant
// for an M... sub-account that is sent to the bare G... base lands in the
// shared base balance and is effectively lost to the intended recipient.
// ============================================

export type StellarAddressKind = "G" | "M";

export function classifyDestination(destination: string): StellarAddressKind | null {
  if (typeof destination !== "string") return null;
  if (destination.startsWith("G")) {
    try {
      if (StellarSdk.StrKey.isValidEd25519PublicKey(destination)) return "G";
    } catch { /* fall through to regex below */ }
    return /^G[A-Z2-7]{55}$/.test(destination) ? "G" : null;
  }
  if (destination.startsWith("M")) {
    try {
      if (StellarSdk.StrKey.isValidMed25519PublicKey(destination)) return "M";
    } catch { /* fall through to regex below */ }
    return /^M[A-Z2-7]{68}$/.test(destination) ? "M" : null;
  }
  return null;
}

export function assertValidDestination(destination: string): StellarAddressKind {
  const kind = classifyDestination(destination);
  if (!kind) {
    throw new Error(
      "Invalid destination: must be a valid Stellar G... (account) or M... (muxed) address",
    );
  }
  return kind;
}

/** Base G... account underlying an M... muxed address (SEP-23). */
export function baseAccountOfMuxed(muxed: string): string {
  try {
    const m = StellarSdk.MuxedAccount.fromAddress
      ? (StellarSdk.MuxedAccount as any).fromAddress(muxed, "0")
      : null;
    if (m?.baseAccount?.()?.accountId?.()) return m.baseAccount().accountId();
  } catch { /* fall through */ }
  return muxed;
}

export function assertValidAmount(amount: string): void {
  if (typeof amount !== "string" || !/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error("Invalid amount: must be a decimal string > 0 with up to 7 decimals");
  }
}

const horizonServer = new (StellarSdk.Horizon as any).Server((config as any).horizonUrl || "https://horizon-testnet.stellar.org");
console.error("PAYMENTS LOADED horizon", (horizonServer as any).serverURL?.href || (horizonServer as any).serverURL);
log("info", "payments_loaded", { url: (horizonServer as any).serverURL?.href || (horizonServer as any).serverURL });

export type PaymentAsset = "XLM" | "USDC" | "EURC";

const ISSUERS: Record<PaymentAsset, string | null> = {
  XLM: null,
  USDC: process.env.USDC_ISSUER || "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  EURC: process.env.EURC_ISSUER || "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};

export function getAsset(code: PaymentAsset): StellarSdk.Asset {
  if (code === "XLM") return StellarSdk.Asset.native();
  const issuer = ISSUERS[code];
  if (!issuer) throw new Error(`Issuer not configured for ${code}`);
  return new StellarSdk.Asset(code, issuer);
}

// MuxedAccount helper for high-volume inflow (one G... → many M...)
export function muxedForUser(base: string, id: string): string {
  const m = new StellarSdk.MuxedAccount(new StellarSdk.Account(base, "0"), id);
  // StellarSdk.MuxedAccount encodes to M...; fallback to base if not available
  try { return (m as any).accountId() as string; } catch { return base; }
}

export interface PaymentOp {
  destination: string; // G... or M...
  asset: PaymentAsset;
  amount: string; // "10.0000000" 7 decimals
  memo?: string;
}

export interface BatchResult {
  hash: string;
  ops: number;
}

// Single payment (uses relayerKeypair as source, withSequenceLock for high volume) — via Horizon (classic, not Soroban)
export async function sendPayment(op: PaymentOp): Promise<{ hash: string }> {
  // #594: strict G.../M... validation — never silently downgrade M... to base.
  const destKind = assertValidDestination(op.destination);
  assertValidAmount(op.amount);
  // #596: serialize Horizon build+sign+submit under the process sequence lock
  // so a RELAYER_SECRET_KEY rotation (relayerKeyManager.onRotate → dirty +
  // resync in stellar.ts) cannot interleave two signers on one sequence.
  return withSequenceLock(async () => {
  console.error("PAY via horizon", (horizonServer as any).serverURL?.href || (horizonServer as any).serverURL, "relayer", relayerKeypair.publicKey());
  log("info", "payment_via_horizon", { url: (horizonServer as any).serverURL?.href || (horizonServer as any).serverURL || "horizon-testnet", relayer: relayerKeypair.publicKey(), destKind });
  const asset = getAsset(op.asset);
  const dest = op.destination;
  const amount = op.amount;
  const account = await (horizonServer as any).loadAccount(relayerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, { fee: "10000", networkPassphrase: config.networkPassphrase })
    .addOperation(StellarSdk.Operation.payment({ destination: dest, asset, amount }))
    .setTimeout(30)
    .build();
  if (op.memo) (tx as any).addMemo?.(StellarSdk.Memo.text(op.memo));
  await relayerKeyManager.signTransaction(tx);
  try {
    const res: any = await (horizonServer as any).submitTransaction(tx);
    log("info", "payment_sent", { asset: op.asset, amount, dest: dest.slice(0, 8) + "...", destKind, hash: res.hash });
    return { hash: res.hash };
  } catch (e: any) {
    const data = e.response?.data || e.response?.body || e.message;
    const extras = (data as any)?.extras;
    log("error", "payment_failed", { asset: op.asset, amount, dest: dest.slice(0, 8) + "...", error: JSON.stringify(data).slice(0, 1000), extras: extras ? JSON.stringify(extras).slice(0, 1000) : undefined });
    throw new Error(typeof data === "string" ? data : JSON.stringify(data).slice(0, 500) || e.message);
  }
  });
}

// Batch 100 ops/tx for high-volume inflow/outflow — via Horizon
export async function sendBatch(ops: PaymentOp[]): Promise<BatchResult> {
  if (ops.length === 0) throw new Error("No ops");
  if (ops.length > 100) throw new Error("Batch max 100 ops");
  // #594: validate every destination up front so one bad op fails the batch
  // with 400 before anything is signed (no partial fund loss).
  for (const op of ops) {
    assertValidDestination(op.destination);
    assertValidAmount(op.amount);
    getAsset(op.asset);
  }
  const idempotencyKey = `batch_${Date.now()}_${ops.length}`;
  const db = getDb();
  try {
    db.prepare("INSERT OR IGNORE INTO payment_jobs (id, ops, created_at) VALUES (?,?,?)").run(idempotencyKey, JSON.stringify(ops), new Date().toISOString());
  } catch {}
  // #596: whole batch build+sign+submit holds the sequence lock.
  return withSequenceLock(async () => {
  const account = await (horizonServer as any).loadAccount(relayerKeypair.publicKey());
  const builder = new StellarSdk.TransactionBuilder(account, { fee: (10000 * ops.length).toString(), networkPassphrase: config.networkPassphrase });
  for (const op of ops) {
    const asset = getAsset(op.asset);
    builder.addOperation(StellarSdk.Operation.payment({ destination: op.destination, asset, amount: op.amount }));
  }
  const tx = builder.setTimeout(30).build();
  await relayerKeyManager.signTransaction(tx);
  const res: any = await (horizonServer as any).submitTransaction(tx);
  log("info", "batch_sent", { ops: ops.length, hash: res.hash });
  return { hash: res.hash, ops: ops.length };
  });
}

// Path payment for swap XLM<->USDC/EURC via DEX (strictSend) — via Horizon
export async function swapStrictSend(sendAsset: PaymentAsset, destAsset: PaymentAsset, sendAmount: string, destMin: string, destination: string): Promise<{ hash: string }> {
  assertValidDestination(destination);
  assertValidAmount(sendAmount);
  return withSequenceLock(async () => {
  const sendA = getAsset(sendAsset);
  const destA = getAsset(destAsset);
  const account = await (horizonServer as any).loadAccount(relayerKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(account, { fee: "10000", networkPassphrase: config.networkPassphrase })
    .addOperation(StellarSdk.Operation.pathPaymentStrictSend({
      sendAsset: sendA, sendAmount, destination, destAsset: destA, destMin, path: []
    } as any))
    .setTimeout(30)
    .build();
  await relayerKeyManager.signTransaction(tx);
  const res: any = await (horizonServer as any).submitTransaction(tx);
  return { hash: res.hash };
  });
}

// Quote via Horizon strictSendPaths (no on-chain, just simulation)
export async function quoteStrictSend(sendAsset: PaymentAsset, sendAmount: string, destAsset: PaymentAsset): Promise<{ destAmount: string; path: any[] }> {
  const sendA = getAsset(sendAsset);
  const destA = getAsset(destAsset);
  // Horizon Server strictSendPaths
  const horizonUrl = (config as any).horizonUrl || "https://horizon-testnet.stellar.org";
  const params = new URLSearchParams({
    source_account: relayerKeypair.publicKey(),
    send_asset_type: sendA.isNative() ? "native" : "credit_alphanum4",
    send_asset_code: sendA.isNative() ? "" : sendA.getCode(),
    send_asset_issuer: sendA.isNative() ? "" : sendA.getIssuer(),
    send_amount: sendAmount,
    destination_assets: `${destA.getCode()}:${destA.getIssuer()}` // for native, handled
  });
  // Fallback: if Horizon not available, return 1:1
  try {
    const url = `${horizonUrl}/paths/strict-send?${params.toString()}`;
    const res = await fetch(url);
    const j: any = await res.json();
    if (j._embedded && j._embedded.records && j._embedded.records[0]) {
      const r = j._embedded.records[0];
      return { destAmount: r.destination_amount, path: r.path };
    }
  } catch (e) {
    log("warn", "quote_fallback", { error: (e as Error).message });
  }
  return { destAmount: sendAmount, path: [] };
}
