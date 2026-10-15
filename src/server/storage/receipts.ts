import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/src/server/api/http";
import { canWriteToR2, getObjectBuffer, putObject } from "@/src/server/storage/r2";
import { RECEIPT_NAME, isGroupReceiptUrl, receiptUrl } from "@/src/server/storage/receipt-links";

/**
 * Receipt photos belong to a group and are only served to its members, through
 * /api/groups/<groupId>/receipts/<name>. They are never given a public URL: in
 * R2 they sit under split/receipts/<groupId>/ (keep that bucket private), and
 * on disk under .data/receipts/<groupId>/, outside the public folder.
 */

const TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, ext]) => [ext, mime]));
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const NAME = RECEIPT_NAME;
const LOCAL_ROOT = path.join(process.cwd(), ".data", "receipts");

export { isGroupReceiptUrl, receiptUrl };

export async function saveReceipt(groupId: string, file: { bytes: Buffer; mime: string }) {
  const ext = TYPES[file.mime];
  if (!ext) throw new ApiError(400, "invalid_request", "Only image uploads are allowed");
  if (file.bytes.byteLength > MAX_RECEIPT_BYTES) {
    throw new ApiError(400, "invalid_request", "File must be under 5MB");
  }
  const name = `${Date.now()}-${randomBytes(6).toString("hex")}.${ext}`;
  if (canWriteToR2()) {
    await putObject(`split/receipts/${groupId}/${name}`, file.bytes, file.mime);
  } else {
    const dir = path.join(LOCAL_ROOT, groupId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), file.bytes);
  }
  return { name, url: receiptUrl(groupId, name) };
}

export async function readReceipt(groupId: string, name: string): Promise<{ bytes: Buffer; mime: string }> {
  if (!/^[a-f0-9]{24}$/i.test(groupId) || !NAME.test(name)) {
    throw new ApiError(404, "not_found", "Receipt not found");
  }
  const mime = MIME_BY_EXT[name.split(".").pop()!]!;
  try {
    const bytes = canWriteToR2()
      ? await getObjectBuffer(`split/receipts/${groupId}/${name}`)
      : await readFile(path.join(LOCAL_ROOT, groupId, name));
    return { bytes, mime };
  } catch {
    throw new ApiError(404, "not_found", "Receipt not found");
  }
}
