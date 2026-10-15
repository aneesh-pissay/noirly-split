/** Receipt file names as saved: `<ms timestamp>-<12 hex>.<image ext>`. */
export const RECEIPT_NAME = /^\d{13}-[a-f0-9]{12}\.(jpg|png|webp|gif)$/;

export function receiptUrl(groupId: string, name: string) {
  return `/api/groups/${groupId}/receipts/${name}`;
}

/** True when `url` is a receipt stored for this group (what an expense may point at). */
export function isGroupReceiptUrl(groupId: string, url: string): boolean {
  const prefix = `/api/groups/${groupId}/receipts/`;
  return url.startsWith(prefix) && RECEIPT_NAME.test(url.slice(prefix.length));
}
