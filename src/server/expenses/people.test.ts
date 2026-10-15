import { describe, expect, it, vi } from "vitest";

// The real module pulls in the sign-in setup; the error class is all this needs.
vi.mock("@/src/server/api/http", () => ({
  ApiError: class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
      super(message);
    }
  },
}));

const { assertExpensePeople } = await import("@/src/server/expenses/people");

const members = new Set(["ana", "ben", "cyd"]);
const base = { payers: [{ userId: "ana" }], participantIds: ["ana", "ben"] };

describe("assertExpensePeople", () => {
  it("accepts members, for equal and uneven splits", () => {
    expect(() => assertExpensePeople(members, { ...base, splitMethod: "equal" })).not.toThrow();
    expect(() => assertExpensePeople(members, {
      ...base, splitMethod: "unequal", allocations: [{ userId: "ana" }, { userId: "ben" }],
    })).not.toThrow();
  });

  it("refuses outsiders anywhere in the expense", () => {
    expect(() => assertExpensePeople(members, { ...base, splitMethod: "equal", payers: [{ userId: "zed" }] })).toThrow(/Payer/);
    expect(() => assertExpensePeople(members, { ...base, splitMethod: "equal", participantIds: ["ana", "zed"] })).toThrow(/participants/);
    // The case that slipped through: uneven shares are decided by allocations.
    expect(() => assertExpensePeople(members, {
      ...base, splitMethod: "unequal", allocations: [{ userId: "ana" }, { userId: "zed" }],
    })).toThrow(/participants/);
  });

  it("needs exactly one share per participant", () => {
    expect(() => assertExpensePeople(members, {
      ...base, splitMethod: "percentage", allocations: [{ userId: "ana" }],
    })).toThrow(/Every participant/);
    expect(() => assertExpensePeople(members, {
      ...base, splitMethod: "shares", allocations: [{ userId: "ana" }, { userId: "ana" }],
    })).toThrow(/once/);
  });
});
