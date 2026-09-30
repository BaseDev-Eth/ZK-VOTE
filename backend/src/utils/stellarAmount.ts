export const HORIZON_ASSET_DECIMALS = 7;
export const SOROBAN_ASSET_DECIMALS = 12;
export const STROOPS_PER_UNIT = 10_000_000n;
export const SOROBAN_UNITS_PER_STROOP = 100_000n;
const MAX_STELLAR_STROOPS = 9_223_372_036_854_775_807n;

export function parseStroops(amount: string, allowZero = false): bigint {
  if (typeof amount !== "string") {
    throw new Error("Amount must be a decimal string");
  }

  const match = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(amount);
  if (!match) {
    throw new Error("Amount must use at most 7 decimal places");
  }

  const whole = BigInt(match[1]);
  const fractional = BigInt((match[2] ?? "").padEnd(7, "0") || "0");
  const stroops = whole * STROOPS_PER_UNIT + fractional;
  if ((!allowZero && stroops === 0n) || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Amount is outside the Stellar int64 range");
  }
  return stroops;
}

export function formatStroops(stroops: bigint): string {
  if (stroops < 0n || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Stroop amount is outside the Stellar int64 range");
  }
  const whole = stroops / STROOPS_PER_UNIT;
  const fractional = (stroops % STROOPS_PER_UNIT).toString().padStart(7, "0");
  return `${whole}.${fractional}`;
}

export function canonicalizeStellarAmount(
  amount: string,
  allowZero = false,
): string {
  return formatStroops(parseStroops(amount, allowZero));
}

/** Convert 7-decimal Horizon stroops to 12-decimal Soroban token units exactly. */
export function horizonStroopsToSorobanAmount(stroops: bigint): bigint {
  if (stroops < 0n || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Stroop amount is outside the Stellar int64 range");
  }
  return stroops * SOROBAN_UNITS_PER_STROOP;
}

/** Convert 12-decimal Soroban token units to Horizon stroops without rounding. */
export function sorobanAmountToHorizonStroops(amount: bigint): bigint {
  if (amount < 0n || amount % SOROBAN_UNITS_PER_STROOP !== 0n) {
    throw new Error("Soroban amount is not exactly representable with 7 Horizon decimals");
  }
  const stroops = amount / SOROBAN_UNITS_PER_STROOP;
  if (stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Converted Horizon amount exceeds the Stellar int64 range");
  }
  return stroops;
}

export function stellarDecimalToSorobanAmount(
  amount: string,
  allowZero = false,
): bigint {
  return horizonStroopsToSorobanAmount(parseStroops(amount, allowZero));
}
