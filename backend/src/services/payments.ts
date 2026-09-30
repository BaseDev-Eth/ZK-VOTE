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
import { trustlinePreflightFailureTotal } from "./metrics.js";
import {
  canonicalizeStellarAmount,
  horizonStroopsToSorobanAmount,
  parseStroops,
} from "../utils/stellarAmount.js";

const horizonServer = new (StellarSdk.Horizon as any).Server(
  (config as any).horizonUrl || "https://horizon-testnet.stellar.org",
);
log("info", "payments_loaded", {});

export type PaymentAsset = "XLM" | "USDC" | "EURC";

const ISSUERS: Record<PaymentAsset, string | null> = {
  XLM: null,
  USDC: process.env.USDC_ISSUER || null,
  EURC: process.env.EURC_ISSUER || null,
};

/**
 * Resolves a Stellar Asset instance for the given asset code.
 * @param code Asset code (XLM, USDC, EURC)
 * @returns Configured StellarSdk.Asset instance
 */
export function getAsset(code: PaymentAsset): StellarSdk.Asset {
  if (code === "XLM") return StellarSdk.Asset.native();
  const issuer = ISSUERS[code];
  if (!issuer) throw new Error(`Issuer not configured for ${code}`);
  return new StellarSdk.Asset(code, issuer);
}

export interface TrustlineStatus {
  account: string;
  asset: PaymentAsset;
  issuer: string | null;
  exists: boolean;
  authorized: boolean;
  ready: boolean;
  reason?: "missing_trustline" | "issuer_authorization_required";
}

function baseAccountId(address: string): string {
  const extract = (StellarSdk as any).extractBaseAddress;
  if (typeof extract === "function") {
    try {
      return extract(address);
    } catch {
      // Fall through to Horizon validation for ordinary G... addresses.
    }
  }
  return address;
}

function findTrustline(account: any, asset: StellarSdk.Asset): any | undefined {
  if (asset.isNative()) return undefined;
  return (account.balances ?? []).find(
    (line: any) =>
      line.asset_code === asset.getCode() &&
      line.asset_issuer === asset.getIssuer(),
  );
}

export async function getTrustlineStatus(
  accountId: string,
  assetCode: PaymentAsset,
): Promise<TrustlineStatus> {
  if (assetCode === "XLM") {
    return {
      account: baseAccountId(accountId),
      asset: assetCode,
      issuer: null,
      exists: true,
      authorized: true,
      ready: true,
    };
  }

  const asset = getAsset(assetCode);
  const account = await (horizonServer as any).loadAccount(baseAccountId(accountId));
  const line = findTrustline(account, asset);
  const exists = Boolean(line);
  const authorized = exists && line.is_authorized !== false;
  return {
    account: baseAccountId(accountId),
    asset: assetCode,
    issuer: asset.getIssuer(),
    exists,
    authorized,
    ready: exists && authorized,
    reason: !exists
      ? "missing_trustline"
      : !authorized
        ? "issuer_authorization_required"
        : undefined,
  };
}

async function assertDestinationTrustline(
  accountId: string,
  assetCode: PaymentAsset,
): Promise<void> {
  if (assetCode === "XLM") return;
  const status = await getTrustlineStatus(accountId, assetCode);
  if (status.ready) return;

  const reason = status.reason ?? "missing_trustline";
  trustlinePreflightFailureTotal.inc({
    asset: assetCode,
    role: "destination",
    reason,
  });
  throw new Error(
    reason === "issuer_authorization_required"
      ? `${assetCode} trustline exists but is not authorized by issuer ${status.issuer}`
      : `Destination must create a ${assetCode} trustline to issuer ${status.issuer} before payment`,
  );
}

export async function ensureRelayerTrustline(
  assetCode: PaymentAsset,
): Promise<void> {
  if (assetCode === "XLM") return;

  const relayer = relayerKeypair.publicKey();
  let status = await getTrustlineStatus(relayer, assetCode);
  if (status.ready) return;
  if (status.exists && !status.authorized) {
    trustlinePreflightFailureTotal.inc({
      asset: assetCode,
      role: "relayer",
      reason: "issuer_authorization_required",
    });
    throw new Error(`${assetCode} relayer trustline is awaiting issuer authorization`);
  }

  const account = await (horizonServer as any).loadAccount(relayer);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset: getAsset(assetCode) }))
    .setTimeout(30)
    .build();
  await relayerKeyManager.signTransaction(tx);
  await (horizonServer as any).submitTransaction(tx);

  status = await getTrustlineStatus(relayer, assetCode);
  if (!status.ready) {
    const reason = status.reason ?? "missing_trustline";
    trustlinePreflightFailureTotal.inc({
      asset: assetCode,
      role: "relayer",
      reason,
    });
    throw new Error(`${assetCode} relayer trustline was created but is not authorized`);
  }
}

/**
 * Creates a MuxedAccount ID (M...) for user routing from a base public key and ID.
 * @param base Base public key (G...)
 * @param id Unique multiplexing sub-account ID
 * @returns Muxed account address (M...) or base key on fallback
 */
export function muxedForUser(base: string, id: string): string {
  const m = new StellarSdk.MuxedAccount(new StellarSdk.Account(base, "0"), id);
  // StellarSdk.MuxedAccount encodes to M...; fallback to base if not available
  try {
    return (m as any).accountId() as string;
  } catch {
    return base;
  }
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

/**
 * Submits a single payment transaction via Horizon using the relayer account.
 * @param op Payment operation specifications (destination, asset, amount, memo)
 * @returns Transaction submission hash
 */
export async function sendPayment(op: PaymentOp): Promise<{ hash: string }> {
  log("info", "payment_via_horizon", {});
  const asset = getAsset(op.asset);
  const dest = op.destination;
  const amount = canonicalizeStellarAmount(op.amount);
  if (op.asset !== "XLM") {
    await ensureRelayerTrustline(op.asset);
    await assertDestinationTrustline(dest, op.asset);
  }
  const account = await (horizonServer as any).loadAccount(
    relayerKeypair.publicKey(),
  );
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({ destination: dest, asset, amount }),
    )
    .setTimeout(30)
    .build();
  if (op.memo) (tx as any).addMemo?.(StellarSdk.Memo.text(op.memo));
  await relayerKeyManager.signTransaction(tx);
  try {
    const res: any = await (horizonServer as any).submitTransaction(tx);
    log("info", "payment_sent", {
      asset: op.asset,
      amount,
      dest: dest.slice(0, 8) + "...",
      hash: res.hash,
    });
    return { hash: res.hash };
  } catch (e: any) {
    const data = e.response?.data || e.response?.body || e.message;
    const extras = (data as any)?.extras;
    log("error", "payment_failed", {
      asset: op.asset,
      amount,
      dest: dest.slice(0, 8) + "...",
      error: JSON.stringify(data).slice(0, 1000),
      extras: extras ? JSON.stringify(extras).slice(0, 1000) : undefined,
    });
    throw new Error(
      typeof data === "string"
        ? data
        : JSON.stringify(data).slice(0, 500) || e.message,
    );
  }
}

/**
 * Parses a decimal string amount into integer stroops (1 unit = 10^7 stroops)
 * using string parsing and BigInt arithmetic to avoid floating-point precision drift.
 * @param amount String representation of decimal amount (e.g. "10.5000000")
 * @returns BigInt representation in stroops
 */
export function parseAmountToStroops(amount: string): bigint {
  if (!amount || typeof amount !== "string") {
    throw new Error("Invalid amount: must be a non-empty string");
  }
  return parseStroops(amount.trim());
}

/**
 * Submits a batch of payments (up to 100 ops/tx) via Horizon with tenant-scoped idempotency.
 * @param ops Array of payment operations
 * @param tenantId Tenant identifier for scoping idempotency and outbox records
 * @returns Result containing deterministic transaction hash and operation count
 */
export async function sendBatch(
  ops: PaymentOp[],
  tenantId: string = "default",
): Promise<BatchResult> {
  if (ops.length === 0) throw new Error("No ops");
  if (ops.length > 100) throw new Error("Batch max 100 ops");
  const opsJson = JSON.stringify(ops);
  const hash = StellarSdk.hash(
    Buffer.from(`${tenantId}:${opsJson}`, "utf8"),
  ).toString("hex");
  const totalAmount = ops.reduce(
    (sum, op) => sum + parseAmountToStroops(op.amount),
    0n,
  );
  const db = getDb();

  const existingJob: any = db
    .prepare("SELECT id FROM payment_jobs WHERE id = ?")
    .get(hash);
  if (existingJob) {
    log("info", "batch_payment_idempotent_hit", {
      hash,
      tenantId,
      ops: ops.length,
    });
    return { hash, ops: ops.length };
  }

  // Validate every credit-asset trustline before persisting idempotency state.
  // A rejected preflight must remain retryable and must not look completed.
  const creditAssets = Array.from(
    new Set(ops.map((op) => op.asset).filter((asset) => asset !== "XLM")),
  ) as PaymentAsset[];
  for (const assetCode of creditAssets) {
    await ensureRelayerTrustline(assetCode);
  }
  for (const op of ops) {
    if (op.asset !== "XLM") {
      await assertDestinationTrustline(op.destination, op.asset);
    }
  }

  try {
    db.prepare(
      "INSERT INTO payment_jobs (id, tenant_id, amount, ops, created_at) VALUES (?,?,?,?,?)",
    ).run(
      hash,
      tenantId,
      totalAmount.toString(),
      opsJson,
      new Date().toISOString(),
    );
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint failed")) {
      return { hash, ops: ops.length };
    }
    throw err;
  }

  const account = await (horizonServer as any).loadAccount(
    relayerKeypair.publicKey(),
  );
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: (10000 * ops.length).toString(),
    networkPassphrase: config.networkPassphrase,
  });
  for (const op of ops) {
    const asset = getAsset(op.asset);
    builder.addOperation(
      StellarSdk.Operation.payment({
        destination: op.destination,
        asset,
        amount: canonicalizeStellarAmount(op.amount),
      }),
    );
  }
  const tx = builder.setTimeout(30).build();
  await relayerKeyManager.signTransaction(tx);
  const res: any = await (horizonServer as any).submitTransaction(tx);
  log("info", "batch_sent", { ops: ops.length, hash: res.hash });
  if (muxedCount > 0) {
    noteSponsorshipCreated(muxedCount);
    const { sponsorshipReserveXlm: gauge } = await import("./metrics.js");
    gauge.set(getSponsorshipReserveXlm());
  }
  return { hash: res.hash, ops: ops.length };
  });
}

/**
 * Executes a path payment to swap assets via Stellar DEX using strictSend.
 * @param sendAsset Asset to send
 * @param destAsset Destination asset to receive
 * @param sendAmount Exact amount of sendAsset to spend
 * @param destMin Minimum acceptable amount of destAsset to receive (slippage limit)
 * @param destination Recipient public address
 * @returns Transaction hash of the swap
 */
export async function swapStrictSend(
  sendAsset: PaymentAsset,
  destAsset: PaymentAsset,
  sendAmount: string,
  destMin: string,
  destination: string,
): Promise<{ hash: string }> {
  if (sendAsset === destAsset) throw new Error("Swap assets must be distinct");
  const sendA = getAsset(sendAsset);
  const destA = getAsset(destAsset);
  const canonicalSendAmount = canonicalizeStellarAmount(sendAmount);
  const canonicalDestMin = canonicalizeStellarAmount(destMin, true);
  if (sendAsset !== "XLM") {
    await ensureRelayerTrustline(sendAsset);
  }
  if (destAsset !== "XLM") {
    if (baseAccountId(destination) === relayerKeypair.publicKey()) {
      await ensureRelayerTrustline(destAsset);
    } else {
      await assertDestinationTrustline(destination, destAsset);
    }
  }
  const account = await (horizonServer as any).loadAccount(
    relayerKeypair.publicKey(),
  );
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset: sendA,
        sendAmount: canonicalSendAmount,
        destination,
        destAsset: destA,
        destMin: canonicalDestMin,
        path: [],
      } as any),
    )
    .setTimeout(30)
    .build();
  await relayerKeyManager.signTransaction(tx);
  const res: any = await (horizonServer as any).submitTransaction(tx);
  return { hash: res.hash };
  });
}

/**
 * Queries simulated strictSend payment paths from Horizon to obtain a price quote.
 * @param sendAsset Asset to send
 * @param sendAmount Amount to send
 * @param destAsset Asset to receive
 * @returns Estimated destination amount and payment routing path
 */
export interface StrictSendQuote {
  sendAmount: string;
  sendStroops: string;
  sendSorobanAmount: string;
  destAmount: string;
  destStroops: string;
  destSorobanAmount: string;
  path: unknown[];
}
export async function quoteStrictSend(
  sendAsset: PaymentAsset,
  sendAmount: string,
  destAsset: PaymentAsset,
): Promise<StrictSendQuote> {
  if (sendAsset === destAsset) throw new Error("Swap assets must be distinct");
  const sendA = getAsset(sendAsset);
  const destA = getAsset(destAsset);
  const canonicalSendAmount = canonicalizeStellarAmount(sendAmount);
  const sendStroops = parseStroops(canonicalSendAmount);
  // Horizon Server strictSendPaths
  const horizonUrl =
    (config as any).horizonUrl || "https://horizon-testnet.stellar.org";
  const params = new URLSearchParams({
    source_account: relayerKeypair.publicKey(),
    send_asset_type: sendA.isNative() ? "native" : "credit_alphanum4",
    send_asset_code: sendA.isNative() ? "" : sendA.getCode(),
    send_asset_issuer: sendA.isNative() ? "" : sendA.getIssuer(),
    send_amount: canonicalSendAmount,
    destination_assets: destA.isNative()
      ? "native"
      : `${destA.getCode()}:${destA.getIssuer()}`,
  });
  try {
    const url = `${horizonUrl}/paths/strict-send?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(`Horizon strict-send returned HTTP ${res.status}`);
    const j: any = await res.json();
    if (j._embedded && j._embedded.records && j._embedded.records[0]) {
      const r = j._embedded.records[0];
      const destStroops = parseStroops(String(r.destination_amount));
      return {
        sendAmount: canonicalSendAmount,
        sendStroops: sendStroops.toString(),
        sendSorobanAmount: horizonStroopsToSorobanAmount(sendStroops).toString(),
        destAmount: canonicalizeStellarAmount(String(r.destination_amount)),
        destStroops: destStroops.toString(),
        destSorobanAmount: horizonStroopsToSorobanAmount(destStroops).toString(),
        path: Array.isArray(r.path) ? r.path : [],
      };
    }
    throw new Error("No path found for the requested swap");
  } catch (e) {
    log("error", "quote_failed", { error: (e as Error).message });
    throw new Error(`Quote unavailable: ${(e as Error).message}`);
  }
}
