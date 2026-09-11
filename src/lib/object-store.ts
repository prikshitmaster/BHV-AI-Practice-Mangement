/**
 * Object store — the S3-compatible layer behind DOC01/DOC02 (PRD §15).
 *
 * SPEC.md §1 picks MinIO, self-hosted and firm-controlled, "swap for
 * India-region S3 later without code changes". This module is that seam: it
 * speaks plain AWS SigV4 over `fetch`, so pointing MINIO_ENDPOINT at S3 is a
 * configuration change, not a rewrite. SigV4 is implemented here on
 * `node:crypto` rather than pulling in the AWS SDK — the signing algorithm is
 * small and fully specified, and a document store is not somewhere to add a
 * large dependency tree for four requests.
 *
 * Two rules this module exists to hold:
 *
 *  1. ORG04 — every key is prefixed with the practice's `documentNamespace`.
 *     Two practices cannot collide, and neither can enumerate the other's
 *     objects even with direct store access.
 *
 *  2. DOC04 — `presignGet` exists, but it is NOT what end users receive.
 *     A presigned URL is a bearer credential that stays valid until it
 *     expires, no matter what happens to the holder's access in the meantime.
 *     DOC04 requires links that "revoke on permission change", which a
 *     presigned URL cannot do. So presigned URLs are for server-to-server and
 *     administrative use only; user-facing links go through
 *     `DocumentAccessToken`, which is re-authorised against live state on
 *     every redemption. See `documents.ts` → `redeemAccessToken`.
 */

import { createHash, createHmac } from "node:crypto";

const REGION = process.env.MINIO_REGION ?? "us-east-1";
const SERVICE = "s3";

export class ObjectStoreError extends Error {
  readonly status = 502;
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

type StoreConfig = {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
};

function config(): StoreConfig {
  const endpoint = process.env.MINIO_ENDPOINT;
  const bucket = process.env.MINIO_BUCKET;
  const accessKey = process.env.MINIO_ROOT_USER;
  const secretKey = process.env.MINIO_ROOT_PASSWORD;

  // Fail closed and loudly. A document store that silently falls back to a
  // default endpoint is how originals end up somewhere nobody audits.
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new ObjectStoreError(
      "Object store is not configured (MINIO_ENDPOINT, MINIO_BUCKET, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD)",
      "STORE_NOT_CONFIGURED",
    );
  }
  return { endpoint: endpoint.replace(/\/+$/, ""), bucket, accessKey, secretKey };
}

/** True when the store is configured — lets callers degrade instead of crash. */
export function objectStoreConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- key layout

/**
 * ORG04 object key. Content-addressed under the practice namespace:
 *
 *   <namespace>/documents/<aa>/<bb>/<sha256>
 *
 * Content addressing means DOC02's "immutable originals with a cryptographic
 * hash" is a property of the storage layout, not a promise made in code — an
 * altered byte lands on a different key and cannot overwrite the original.
 */
export function documentObjectKey(documentNamespace: string, sha256: string): string {
  assertNamespace(documentNamespace);
  assertSha256(sha256);
  return `${documentNamespace}/documents/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}

/**
 * DOC01 quarantine. A separate prefix, never under `documents/`, so no
 * document route can reach a quarantined file even by constructing a key.
 */
export function quarantineObjectKey(documentNamespace: string, sha256: string): string {
  assertNamespace(documentNamespace);
  assertSha256(sha256);
  return `${documentNamespace}/quarantine/${sha256}`;
}

/**
 * POR03 resumable-upload staging (T13). A separate prefix from `documents/`
 * and `quarantine/`, because a part is not a document: it has passed no DOC01
 * check, it is not addressed by the content of anything whole, and no document
 * route may be able to reach it by constructing a key. Parts are deleted once
 * the upload is assembled, or expire with it.
 */
export function portalUploadPartKey(
  documentNamespace: string,
  uploadId: string,
  partNumber: number,
): string {
  assertNamespace(documentNamespace);
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) {
    throw new ObjectStoreError("Invalid upload id", "BAD_UPLOAD_ID");
  }
  if (!Number.isInteger(partNumber) || partNumber < 0 || partNumber > 100_000) {
    throw new ObjectStoreError("Invalid part number", "BAD_PART_NUMBER");
  }
  // Zero-padded so a lexical listing is also the assembly order.
  return `${documentNamespace}/portal-staging/${uploadId}/${String(partNumber).padStart(6, "0")}`;
}

function assertNamespace(ns: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(ns)) {
    throw new ObjectStoreError(`Invalid document namespace: ${ns}`, "BAD_NAMESPACE");
  }
}

function assertSha256(hex: string) {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new ObjectStoreError("Invalid SHA-256 digest", "BAD_DIGEST");
  }
}

export function sha256Hex(body: Buffer | string): string {
  return createHash("sha256").update(body).digest("hex");
}

// ---------------------------------------------------------------- operations

export async function putObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; sha256: string; sizeBytes: number }> {
  const cfg = config();
  const digest = sha256Hex(params.body);

  const res = await signedFetch(cfg, {
    method: "PUT",
    key: params.key,
    body: params.body,
    payloadHash: digest,
    headers: { "content-type": params.contentType },
  });

  if (!res.ok) {
    throw new ObjectStoreError(
      `PUT ${params.key} failed with ${res.status}`,
      "PUT_FAILED",
    );
  }
  return { key: params.key, sha256: digest, sizeBytes: params.body.byteLength };
}

export async function getObject(key: string): Promise<Buffer | null> {
  const cfg = config();
  const res = await signedFetch(cfg, { method: "GET", key, payloadHash: EMPTY_HASH });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ObjectStoreError(`GET ${key} failed with ${res.status}`, "GET_FAILED");
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function objectExists(key: string): Promise<boolean> {
  const cfg = config();
  const res = await signedFetch(cfg, { method: "HEAD", key, payloadHash: EMPTY_HASH });
  return res.ok;
}

/** DOC06 execution step. Only ever called after eligibility + approval. */
export async function deleteObject(key: string): Promise<void> {
  const cfg = config();
  const res = await signedFetch(cfg, { method: "DELETE", key, payloadHash: EMPTY_HASH });
  if (!res.ok && res.status !== 404) {
    throw new ObjectStoreError(`DELETE ${key} failed with ${res.status}`, "DELETE_FAILED");
  }
}

/**
 * BCP04 health probe: does the configured bucket answer a signed HEAD? Throws
 * STORE_NOT_CONFIGURED like every other call, so an unconfigured store reads
 * as a fault rather than as healthy.
 */
export async function bucketReachable(): Promise<boolean> {
  const cfg = config();
  const res = await signedFetch(cfg, { method: "HEAD", key: "", payloadHash: EMPTY_HASH });
  return res.ok;
}

/** Creates the bucket if it is missing. Idempotent; used by dev bootstrap. */
export async function ensureBucket(): Promise<void> {
  const cfg = config();
  const head = await signedFetch(cfg, { method: "HEAD", key: "", payloadHash: EMPTY_HASH });
  if (head.ok) return;

  const res = await signedFetch(cfg, { method: "PUT", key: "", payloadHash: EMPTY_HASH });
  // 409 = someone else created it between the HEAD and the PUT.
  if (!res.ok && res.status !== 409) {
    throw new ObjectStoreError(
      `Could not create bucket ${cfg.bucket} (${res.status})`,
      "BUCKET_FAILED",
    );
  }
}

/**
 * Server-to-server / administrative use ONLY — read the DOC04 note at the top
 * of this file before handing the result to anyone. The signature is valid for
 * `expiresInSeconds` regardless of what happens to the requester's access, so
 * this can never satisfy "revoke on permission change".
 */
export function presignGet(key: string, expiresInSeconds = 300): string {
  const cfg = config();
  const { amzDate, dateStamp } = timestamps();
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${cfg.accessKey}/${credentialScope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", "host");

  const canonicalRequest = [
    "GET",
    url.pathname,
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const signature = sign(cfg, dateStamp, stringToSign(amzDate, credentialScope, canonicalRequest));
  url.searchParams.set("X-Amz-Signature", signature);
  return url.toString();
}

// ---------------------------------------------------------------- SigV4

const EMPTY_HASH = createHash("sha256").update("").digest("hex");

async function signedFetch(
  cfg: StoreConfig,
  req: {
    method: string;
    key: string;
    body?: Buffer;
    payloadHash: string;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const { amzDate, dateStamp } = timestamps();
  const path = req.key ? `/${cfg.bucket}/${encodeKey(req.key)}` : `/${cfg.bucket}`;
  const url = new URL(`${cfg.endpoint}${path}`);

  const headers: Record<string, string> = {
    ...(req.headers ?? {}),
    host: url.host,
    "x-amz-content-sha256": req.payloadHash,
    "x-amz-date": amzDate,
  };

  const signedHeaderNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaderNames
    .map((h) => `${h}:${String(headers[headerKey(headers, h)]).trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    req.method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    req.payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const signature = sign(cfg, dateStamp, stringToSign(amzDate, credentialScope, canonicalRequest));

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    return await fetch(url, {
      method: req.method,
      headers,
      body: req.body as unknown as BodyInit | undefined,
    });
  } catch (e) {
    throw new ObjectStoreError(
      `Object store unreachable at ${cfg.endpoint}: ${(e as Error).message}`,
      "STORE_UNREACHABLE",
    );
  }
}

function headerKey(headers: Record<string, string>, lower: string): string {
  return Object.keys(headers).find((k) => k.toLowerCase() === lower) ?? lower;
}

function stringToSign(amzDate: string, credentialScope: string, canonicalRequest: string): string {
  return [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
}

function sign(cfg: StoreConfig, dateStamp: string, toSign: string): string {
  const kDate = createHmac("sha256", `AWS4${cfg.secretKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(REGION).digest();
  const kService = createHmac("sha256", kRegion).update(SERVICE).digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  return createHmac("sha256", kSigning).update(toSign).digest("hex");
}

function timestamps() {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** RFC 3986 encoding, path separators preserved — S3 signs the encoded path. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
