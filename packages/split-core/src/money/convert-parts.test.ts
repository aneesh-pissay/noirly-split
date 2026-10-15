import { describe, expect, it } from "vitest";
import { allocateEvenly, applyFx, convertParts, sumMinor } from "./index";

describe("convertParts", () => {
  it("keeps converted shares equal to the converted total", () => {
    // Rounding each share alone gave 51 + 50 + 50 = 151 against 150 paid.
    const owed = convertParts(allocateEvenly(100, 3), 1.5);
    expect(sumMinor(owed)).toBe(applyFx(100, 1.5));
    expect(owed).toEqual([51, 50, 49]);
  });

  it("never drifts, across many amounts, splits and rates", () => {
    for (const rate of [0.83, 1.5, 1.07, 83.12, 0.0123]) {
      for (let amount = 1; amount <= 2000; amount += 7) {
        for (const people of [2, 3, 4, 7]) {
          const parts = allocateEvenly(amount, people);
          const converted = convertParts(parts, rate);
          expect(sumMinor(converted)).toBe(applyFx(amount, rate));
          // Each part stays within one unit of its exact value.
          converted.forEach((value, i) => expect(Math.abs(value - parts[i]! * rate)).toBeLessThan(1));
        }
      }
    }
  });

  it("is the identity at rate 1, and handles a single part", () => {
    expect(convertParts([34, 33, 33], 1)).toEqual([34, 33, 33]);
    expect(convertParts([999], 1.2345)).toEqual([applyFx(999, 1.2345)]);
  });
});
