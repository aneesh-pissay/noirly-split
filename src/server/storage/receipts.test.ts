import { describe, expect, it } from "vitest";
import { isGroupReceiptUrl, receiptUrl } from "@/src/server/storage/receipt-links";

const group = "6a0c1f2e3d4b5a6978809a1b";
const other = "6a0c1f2e3d4b5a6978809a1c";
const name = "1760000000000-0123456789ab.jpg";

describe("receipt links", () => {
  it("accepts this group's own receipts", () => {
    expect(isGroupReceiptUrl(group, receiptUrl(group, name))).toBe(true);
  });

  it("refuses other groups, outside links and odd names", () => {
    expect(isGroupReceiptUrl(group, receiptUrl(other, name))).toBe(false);
    expect(isGroupReceiptUrl(group, "https://tracker.example/pixel.gif")).toBe(false);
    expect(isGroupReceiptUrl(group, `/api/groups/${group}/receipts/../../../etc/passwd`)).toBe(false);
    expect(isGroupReceiptUrl(group, `/api/groups/${group}/receipts/evil.html`)).toBe(false);
  });
});
