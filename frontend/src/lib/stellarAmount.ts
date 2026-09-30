export const HORIZON_ASSET_DECIMALS = 7;
export const SOROBAN_ASSET_DECIMALS = 12;
const STROOPS_PER_UNIT = 10_000_000n;
const SOROBAN_UNITS_PER_STROOP = 100_000n;
const MAX_STELLAR_STROOPS = 9_223_372_036_854_775_807n;

export function parseStroops(amount: string, allowZero = false): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,7}))?$/.exec(amount);
  if (!match)
    throw new Error("Use a positive amount with at most 7 decimal places");
  const stroops =
    BigInt(match[1]) * STROOPS_PER_UNIT +
    BigInt((match[2] ?? "").padEnd(7, "0") || "0");
  if ((!allowZero && stroops === 0n) || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Amount is outside the Stellar range");
  }
  return stroops;
}

export function formatStroops(stroops: bigint): string {
  if (stroops < 0n || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Stroop amount is outside the Stellar range");
  }
  return `${stroops / STROOPS_PER_UNIT}.${(stroops % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, "0")}`;
}

export function canonicalizeStellarAmount(amount: string): string {
  return formatStroops(parseStroops(amount));
}

export function horizonStroopsToSorobanAmount(stroops: bigint): bigint {
  if (stroops < 0n || stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Stroop amount is outside the Stellar range");
  }
  return stroops * SOROBAN_UNITS_PER_STROOP;
}

export function sorobanAmountToHorizonStroops(amount: bigint): bigint {
  if (amount < 0n || amount % SOROBAN_UNITS_PER_STROOP !== 0n) {
    throw new Error("Soroban amount is not exactly representable with 7 Horizon decimals");
  }
  const stroops = amount / SOROBAN_UNITS_PER_STROOP;
  if (stroops > MAX_STELLAR_STROOPS) {
    throw new Error("Converted amount is outside the Stellar range");
  }
  return stroops;
}
