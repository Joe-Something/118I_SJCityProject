import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// Keep App Storage authentication on Replit's sidecar, as provisioned by the storage skill.
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export const SIGNED_UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
export const SIGNED_UPLOAD_IN_FLIGHT_GRACE_MS = 15 * 60 * 1000;

function getObjectFile(objectId: string, kind: "staging" | "final", generation?: string) {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR is not configured for App Storage.");
  if (!/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error("Invalid private document object ID.");
  const [bucketName, ...prefix] = privateDir.replace(/^\/+/, "").split("/");
  if (!bucketName || prefix.length === 0) throw new Error("PRIVATE_OBJECT_DIR is not a valid private bucket path.");
  return objectStorageClient.bucket(bucketName).file(
    [...prefix, "application-documents", kind, objectId].join("/"),
    generation ? { generation } : undefined,
  );
}

export const applicationDocumentStorage = {
  async createUploadUrl(stagingObjectId: string, _contentType: string): Promise<{ url: string; expiresAt: Date }> {
    const file = getObjectFile(stagingObjectId, "staging");
    const expiresAt = new Date(Date.now() + SIGNED_UPLOAD_URL_TTL_MS);
    const request = {
      bucket_name: file.bucket.name,
      object_name: file.name,
      method: "PUT",
      expires_at: expiresAt.toISOString(),
    };
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`App Storage failed to sign a private upload URL (status ${response.status}).`);
    const { signed_url: signedUrl } = await response.json() as { signed_url?: string };
    if (!signedUrl) throw new Error("App Storage did not return a private upload URL.");
    return { url: signedUrl, expiresAt };
  },

  async inspect(stagingObjectId: string): Promise<{ size: number; contentType: string; signature: Buffer; generation: string }> {
    const currentFile = getObjectFile(stagingObjectId, "staging");
    const [metadata] = await currentFile.getMetadata();
    const generation = String(metadata.generation ?? "");
    if (!generation) throw new Error("Uploaded document has no storage generation.");
    const file = getObjectFile(stagingObjectId, "staging", generation);
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size)) throw new Error("Uploaded document has invalid storage metadata.");
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    for await (const chunk of file.createReadStream({ start: 0, end: 15 })) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      bytesRead += buffer.length;
      if (bytesRead >= 16) break;
    }
    return {
      size,
      contentType: String(metadata.contentType ?? ""),
      signature: Buffer.concat(chunks).subarray(0, 16),
      generation,
    };
  },

  async promote(stagingObjectId: string, finalObjectId: string, sourceGeneration: string, documentId: string): Promise<string> {
    const source = getObjectFile(stagingObjectId, "staging", sourceGeneration);
    const destination = getObjectFile(finalObjectId, "final");
    try {
      await source.copy(destination, {
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { documentId, sourceGeneration },
      });
    } catch (error) {
      const [existing] = await destination.getMetadata().catch(() => [null]);
      if (existing?.metadata?.documentId !== documentId ||
          existing.metadata.sourceGeneration !== sourceGeneration) throw error;
    }
    const [metadata] = await destination.getMetadata();
    if (metadata.metadata?.documentId !== documentId ||
        metadata.metadata.sourceGeneration !== sourceGeneration ||
        !metadata.generation) {
      throw new Error("Promoted document generation did not match its verified source.");
    }
    return String(metadata.generation);
  },

  async verifyFinal(
    finalObjectId: string,
    finalGeneration: string | null,
    documentId: string,
    expectedSize: number,
    expectedContentType: string,
  ): Promise<void> {
    if (!finalGeneration) throw new Error("Ready document has no final storage generation.");
    const file = getObjectFile(finalObjectId, "final", finalGeneration);
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size);
    if (String(metadata.generation ?? "") !== finalGeneration ||
        metadata.metadata?.documentId !== documentId ||
        !Number.isSafeInteger(actualSize) ||
        actualSize !== expectedSize ||
        metadata.contentType !== expectedContentType) {
      throw new Error("Final document generation metadata did not match its ready document.");
    }
  },

  open(finalObjectId: string, finalGeneration: string) {
    return getObjectFile(finalObjectId, "final", finalGeneration).createReadStream();
  },

  async deleteStaging(stagingObjectId: string): Promise<void> {
    await getObjectFile(stagingObjectId, "staging").delete({ ignoreNotFound: true });
  },

  async deleteFinal(finalObjectId: string, generation: string | null, documentId: string): Promise<void> {
    const file = getObjectFile(finalObjectId, "final", generation ?? undefined);
    const [metadata] = await file.getMetadata().catch(error => {
      if ((error as { code?: number }).code === 404) return [null];
      throw error;
    });
    if (!metadata || metadata.metadata?.documentId !== documentId) return;
    await file.delete({ ignoreNotFound: true });
  },
};