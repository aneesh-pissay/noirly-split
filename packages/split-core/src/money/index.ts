import type { MinorAmount } from "../models/types";

/** Split total into n parts; remainder cents go to the first recipients. */
export function allocateEvenly(
  total: MinorAmount,
  count: number,
): MinorAmount[] {
  if (count <= 0) return [];
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("total must be a non-negative integer (minor units)");
  }
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Apply FX rate and round to nearest minor unit. */
export function applyFx(amount: MinorAmount, rate: number): MinorAmount {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("fx rate must be a positive finite number");
  }
  return Math.round(amount * rate);
}

/**
 * Converts parts of one amount at `rate` so they add up exactly to the
 * converted whole. Rounding each part on its own can leave the parts a unit or
 * two off the total, and those units become debts nobody can settle. Here
 * every part is rounded down, then the leftover units go to the parts with the
 * largest fractions (earlier parts win ties).
 */
export function convertParts(
  parts: readonly MinorAmount[],
  rate: number,
): MinorAmount[] {
  const total = applyFx(sumMinor(parts), rate);
  const exact = parts.map((part) => part * rate);
  const result = exact.map((value) => Math.floor(value));
  let leftover = total - sumMinor(result);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (leftover <= 0) break;
    result[index]! += 1;
    leftover -= 1;
  }
  return result;
}

export function sumMinor(amounts: readonly MinorAmount[]): MinorAmount {
  return amounts.reduce((acc, n) => acc + n, 0);
}

export function formatMoney(
  amount: MinorAmount,
  currency: string,
  locale = "en-US",
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount / 100);
}
