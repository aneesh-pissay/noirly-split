import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

let client: S3Client | null = null;

function resolveR2AccountId(): string | undefined {
  const explicit = process.env.R2_ACCOUNT_ID?.trim();
  if (explicit) return explicit;

  const publicUrl = process.env.R2_PUBLIC_URL?.trim();
  if (!publicUrl) return undefined;

  try {
    const match = new URL(publicUrl).hostname.match(
      /^([a-f0-9]{32})\.r2\.cloudflarestorage\.com$/i,
    );
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** True when the server can write objects to R2 (needs API keys + bucket). */
export function canWriteToR2(): boolean {
  return Boolean(
    resolveR2AccountId() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET_NAME?.trim(),
  );
}

function getR2Client(): S3Client {
  if (client) return client;

  const accountId = resolveR2AccountId();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 write credentials are not configured");
  }

  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return client;
}

export function getPublicUrl(key: string): string {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/, "").trim();
  if (!base) {
    throw new Error("R2_PUBLIC_URL is required for R2 asset URLs");
  }
  return `${base}/${key}`;
}

export function buildObjectKey(filename: string, folder = "split/receipts"): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
  const ext = safe.includes(".") ? safe.slice(safe.lastIndexOf(".")) : "";
  const base = safe.replace(ext, "") || "asset";
  return `${folder}/${Date.now()}-${randomUUID().slice(0, 8)}-${base}${ext}`;
}

export async function uploadBuffer(
  buffer: Buffer,
  filename: string,
  contentType: string,
  folder = "split/receipts",
): Promise<{ key: string; publicUrl: string }> {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");

  const key = buildObjectKey(filename, folder);
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return { key, publicUrl: getPublicUrl(key) };
}

/** Stores an object under an exact key; for private files that are never linked publicly. */
export async function putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");
  await getR2Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }),
  );
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");
  const result = await getR2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("Empty object");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function deleteObject(key: string) {
  if (!canWriteToR2()) return;

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is required");

  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: key }),
  );
}

export function extractKeyFromUrl(url: string): string | null {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!base || !url.startsWith(base)) return null;
  return url.slice(base.length + 1);
}
