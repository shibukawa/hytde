import { buildAsyncUploadPayload } from "./payload";
import type { FileSubmitValue } from "./types";
import type { AsyncUploadFileState, AsyncUploadSession, RuntimeState } from "../state";
import { emitLog } from "../utils/logging";
import { emitAsyncUploadError } from "./async-upload-errors";
import { clearPendingSubmission, deleteStoredChunk, loadChunkBlob, storeFileRecord } from "./async-upload-storage";
import { upsertAsyncUploadEntry } from "./async-upload-state";
import { handleRequest } from "../requests/runtime";

export async function startAsyncUploadForFile(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<void> {
  if (fileState.status === "failed" || fileState.status === "completed") {
    return;
  }
  try {
    if (session.config.mode === "s3") {
      await initS3Upload(fileState, session, state);
      fileState.status = "uploading";
      upsertAsyncUploadEntry(session, fileState, state);
      try {
        await storeFileRecord(fileState);
      } catch (error) {
        emitAsyncUploadError(state, "Failed to persist async upload state; continuing in-memory.", {
          uploadUuid: session.config.uploadUuid,
          inputName: fileState.inputName,
          error: error instanceof Error ? error.message : String(error ?? "")
        });
      }
      await uploadFileChunks(fileState, session, state);
    } else {
      fileState.status = "uploading";
      upsertAsyncUploadEntry(session, fileState, state);
      await uploadSimpleFile(fileState, session, state);
    }
  } catch (error) {
    markAsyncUploadFailed(fileState, session, state, error);
  }
}

function pickS3Path(
  upload: { s3Path?: string; path?: string },
  fileState: AsyncUploadFileState
): string {
  const rawPath = [upload.s3Path, upload.path].find(
    (value): value is string => typeof value === "string" && value.length > 0
  );
  if (rawPath) {
    return rawPath;
  }
  const encodedInput = encodeURIComponent(fileState.inputName);
  const encodedName = encodeURIComponent(fileState.fileName);
  return `/s3/${fileState.fileUuid}/${encodedInput}/${encodedName}`;
}

function pickSimplePath(payload: unknown, fileState: AsyncUploadFileState): string {
  const path =
    typeof (payload as { path?: unknown })?.path === "string" && (payload as { path: string }).path.length > 0
      ? (payload as { path: string }).path
      : typeof (payload as { fileId?: unknown })?.fileId === "string" &&
          (payload as { fileId: string }).fileId.length > 0
        ? (payload as { fileId: string }).fileId
        : null;
  if (path) {
    return path;
  }
  const encodedInput = encodeURIComponent(fileState.inputName);
  const encodedName = encodeURIComponent(fileState.fileName);
  return `/simple/${fileState.fileUuid}/${encodedInput}/${encodedName}`;
}

async function initS3Upload(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<void> {
  if (fileState.uploadId && fileState.partUrls && fileState.partUrls.length > 0) {
    return;
  }
  const base = session.config.uploaderUrl?.replace(/\/$/, "") ?? "";
  const response = await fetch(`${resolveUploaderUrl(base, state.doc)}/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [
        {
          inputName: fileState.inputName,
          fileName: fileState.fileName,
          size: fileState.size,
          mime: fileState.mime,
          chunks: fileState.totalChunks
        }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`S3 init failed: ${response.status}`);
  }
  const payload = (await safeJson(response)) as
    | {
        uploads?: Array<{
          inputName?: string;
          uploadId?: string;
          s3Path?: string;
          path?: string;
          parts?: Array<{ partNumber?: number; url?: string }>;
        }>;
      }
    | null;
  const upload = Array.isArray(payload?.uploads)
    ? payload.uploads.find((entry) => entry?.inputName === fileState.inputName)
    : null;
  if (!upload) {
    throw new Error("S3 init missing upload metadata.");
  }
  const s3Path = pickS3Path(upload, fileState);
  const parts = Array.isArray(upload.parts) ? upload.parts.slice() : [];
  parts.sort((a: { partNumber?: number }, b: { partNumber?: number }) => (a.partNumber ?? 0) - (b.partNumber ?? 0));
  const urls = parts
    .map((part: { url?: string }) => part.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
  if (urls.length !== fileState.totalChunks) {
    throw new Error("S3 init returned mismatched part count.");
  }
  fileState.uploadId = upload.uploadId;
  fileState.s3Path = s3Path;
  fileState.partUrls = urls;
  fileState.partEtags = new Array(fileState.totalChunks).fill(null);
  try {
    await storeFileRecord(fileState);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to persist S3 init metadata; continuing in-memory.", {
      uploadUuid: fileState.uploadUuid,
      inputName: fileState.inputName,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
}

export async function maybeSubmitPendingAsyncUpload(session: AsyncUploadSession, state: RuntimeState): Promise<void> {
  if (!session.pendingSubmit) {
    return;
  }
  const files = Array.from(session.files.values());
  const failed = files.find((file) => file.status === "failed");
  if (failed) {
    emitAsyncUploadError(state, "Async upload failed; pending submission blocked.", {
      uploadUuid: session.config.uploadUuid,
      inputName: failed.inputName
    });
    return;
  }
  const pendingUploads = files.some((file) => file.uploadedChunks < file.totalChunks || file.status === "queued");
  if (pendingUploads) {
    return;
  }
  const fileIds = await finalizeUploads(session, state);
  if (!fileIds) {
    return;
  }
  const pending = session.pendingSubmit;
  const payload = buildAsyncUploadPayload(pending.payload, fileIds);
  clearPendingSubmission(session, state);
  session.pendingSubmit = null;
  void handleRequest(pending.target, state, {
    overridePayload: payload,
    overrideUrl: pending.actionUrl,
    skipAsyncGate: true
  });
}

async function uploadSimpleFile(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<void> {
  if (!fileState.file) {
    throw new Error("Missing file data for simple upload.");
  }
  const uploadFile = fileState.file;
  const base = session.config.uploaderUrl?.replace(/\/$/, "") ?? "";
  if (!base) {
    throw new Error("Simple upload requires uploader URL.");
  }
  const targetUrl = resolveUploaderUrl(base, state.doc);
  const formData = new FormData();
  formData.append("inputName", fileState.inputName);
  formData.append("fileName", fileState.fileName);
  formData.append("size", String(fileState.size));
  formData.append("mime", fileState.mime);
  formData.append(fileState.inputName, uploadFile, fileState.fileName);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", targetUrl);
    xhr.upload.onprogress = (event) => {
      const progress = event.total > 0 ? event.loaded / event.total : 0;
      fileState.inFlightProgress.set(0, progress);
      emitLog(state, {
        type: "info",
        message: "upload.simple.progress",
        detail: {
          uploadUuid: fileState.fileUuid,
          inputName: fileState.inputName,
          loaded: event.loaded,
          total: event.total
        },
        timestamp: Date.now()
      });
      upsertAsyncUploadEntry(session, fileState, state);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const text = xhr.responseText ?? "";
        let payload: unknown = null;
        try {
          payload = JSON.parse(text);
        } catch {
          payload = null;
        }
        const path = pickSimplePath(payload, fileState);
        fileState.fileId = path;
        fileState.uploadedChunks = fileState.totalChunks;
        fileState.inFlightProgress.delete(0);
        fileState.status = "completed";
        upsertAsyncUploadEntry(session, fileState, state);
        emitLog(state, {
          type: "info",
          message: "upload.simple.complete",
          detail: {
            uploadUuid: fileState.fileUuid,
            inputName: fileState.inputName,
            path
          },
          timestamp: Date.now()
        });
        void storeFileRecord(fileState).catch((error) => {
          emitAsyncUploadError(state, "Failed to persist simple upload completion; continuing.", {
            uploadUuid: fileState.uploadUuid,
            inputName: fileState.inputName,
            error: error instanceof Error ? error.message : String(error ?? "")
          });
        });
        fileState.file = undefined;
        resolve();
      } else {
        fileState.file = undefined;
        reject(new Error(`Simple upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      fileState.file = undefined;
      reject(new Error("Simple upload network error."));
    };
    xhr.send(formData);
  });
  await maybeSubmitPendingAsyncUpload(session, state);
}

async function uploadFileChunks(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<void> {
  const concurrency = session.config.concurrency;
  const pendingChunks: number[] = [];
  if (session.config.mode === "s3") {
    if (!fileState.partEtags) {
      fileState.partEtags = new Array(fileState.totalChunks).fill(null);
    }
    for (let index = 0; index < fileState.totalChunks; index += 1) {
      if (!fileState.partEtags[index]) {
        pendingChunks.push(index);
      }
    }
  } else {
    for (let index = fileState.uploadedChunks; index < fileState.totalChunks; index += 1) {
      pendingChunks.push(index);
    }
  }

  if (pendingChunks.length === 0) {
    await maybeSubmitPendingAsyncUpload(session, state);
    return;
  }

  let aborted = false;
  let active = 0;

  await new Promise<void>((resolve) => {
    const runNext = () => {
      if (aborted) {
        if (active === 0) {
          resolve();
        }
        return;
      }
      while (active < concurrency && pendingChunks.length > 0) {
        const chunkIndex = pendingChunks.shift() ?? 0;
        active += 1;
        void uploadChunk(fileState, session, state, chunkIndex)
          .catch((error) => {
            aborted = true;
            markAsyncUploadFailed(fileState, session, state, error);
          })
          .finally(() => {
            active -= 1;
            runNext();
            if (!aborted && active === 0 && pendingChunks.length === 0) {
              resolve();
            }
          });
      }
    };

    runNext();
  });

  if (session.config.mode === "s3" && fileState.file && pendingChunks.length === 0 && !aborted) {
    fileState.file = undefined;
  }

  await maybeSubmitPendingAsyncUpload(session, state);
}

async function uploadChunk(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState,
  chunkIndex: number
): Promise<void> {
  fileState.inFlightProgress.set(chunkIndex, 0);
  emitLog(state, {
    type: "info",
    message: "upload.chunk.start",
    detail: {
      uploadUuid: fileState.fileUuid,
      inputName: fileState.inputName,
      chunkIndex,
      totalChunks: fileState.totalChunks
    },
    timestamp: Date.now()
  });
  let blob: Blob | null = null;
  try {
    blob = await loadChunkBlob(fileState.uploadUuid, fileState.inputName, fileState.fileIndex, chunkIndex);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to read chunk from IndexedDB; using in-memory slice fallback.", {
      uploadUuid: fileState.uploadUuid,
      inputName: fileState.inputName,
      chunkIndex,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
  if (!blob && fileState.file) {
    const start = chunkIndex * fileState.chunkSizeBytes;
    const end = Math.min(fileState.size, start + fileState.chunkSizeBytes);
    blob = fileState.file.slice(start, end);
  }
  if (!blob) {
    throw new Error("Missing chunk data.");
  }
  if (session.config.mode === "s3") {
    await uploadChunkToS3(fileState, session, state, chunkIndex, blob);
  } else {
    throw new Error("Chunk upload is only supported for S3 mode.");
  }
  blob = null as unknown as Blob;
  fileState.inFlightProgress.delete(chunkIndex);
  fileState.uploadedChunks = Math.min(fileState.totalChunks, fileState.uploadedChunks + 1);
  upsertAsyncUploadEntry(session, fileState, state);
  try {
    await storeFileRecord(fileState);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to update async upload progress in storage; continuing in-memory.", {
      uploadUuid: fileState.uploadUuid,
      inputName: fileState.inputName,
      chunkIndex,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
  try {
    await deleteStoredChunk(fileState.uploadUuid, fileState.inputName, fileState.fileIndex, chunkIndex);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to prune uploaded chunk from IndexedDB; continuing.", {
      uploadUuid: fileState.uploadUuid,
      inputName: fileState.inputName,
      chunkIndex,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
  emitLog(state, {
    type: "info",
    message: "upload.chunk.complete",
    detail: {
      uploadUuid: fileState.fileUuid,
      inputName: fileState.inputName,
      chunkIndex
    },
    timestamp: Date.now()
  });
}

async function uploadChunkToS3(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState,
  chunkIndex: number,
  blob: Blob
): Promise<void> {
  const url = fileState.partUrls?.[chunkIndex];
  if (!url) {
    throw new Error("Missing S3 part URL.");
  }
  const result = await uploadChunkWithXhr(url, "PUT", blob, {}, (loaded, total) => {
    const progress = total > 0 ? loaded / total : 0;
    fileState.inFlightProgress.set(chunkIndex, progress);
    emitLog(state, {
      type: "info",
      message: "upload.chunk.progress",
      detail: {
        uploadUuid: fileState.fileUuid,
        inputName: fileState.inputName,
        chunkIndex,
        loaded,
        total
      },
      timestamp: Date.now()
    });
    upsertAsyncUploadEntry(session, fileState, state);
  });
  const etag = result.etag ?? `etag-${chunkIndex + 1}`;
  if (!fileState.partEtags) {
    fileState.partEtags = new Array(fileState.totalChunks).fill(null);
  }
  fileState.partEtags[chunkIndex] = etag;
}

export async function finalizeUploads(
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<Record<string, FileSubmitValue | FileSubmitValue[]> | null> {
  const files = Array.from(session.files.values());
  if (session.config.mode === "simple") {
    const missing = files.find((file) => !file.fileId);
    if (missing) {
      emitAsyncUploadError(state, "Simple upload missing fileId/path.", {
        uploadUuid: session.config.uploadUuid,
        inputName: missing.inputName
      });
      return null;
    }
    return mapFilePayloads(files);
  }
  const pending = files.filter((file) => file.uploadedChunks >= file.totalChunks && !file.fileId);
  if (pending.length === 0) {
    return mapFilePayloads(files);
  }
  for (const file of pending) {
    file.status = "finalizing";
    upsertAsyncUploadEntry(session, file, state);
    try {
      await storeFileRecord(file);
    } catch (error) {
      emitAsyncUploadError(state, "Failed to persist async upload state before finalize; continuing.", {
        uploadUuid: session.config.uploadUuid,
        inputName: file.inputName,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
    }
  }
  emitLog(state, {
    type: "info",
    message: "upload.finalize.start",
    detail: { uploadUuid: session.config.uploadUuid },
    timestamp: Date.now()
  });
  const fileIds = await finalizeS3Uploads(session, pending, state);
  if (!fileIds) {
    for (const file of pending) {
      file.status = "failed";
      file.lastError = file.lastError ?? "Finalize failed.";
      upsertAsyncUploadEntry(session, file, state);
      try {
        await storeFileRecord(file);
      } catch (error) {
        emitAsyncUploadError(state, "Failed to persist async upload failure; continuing.", {
          uploadUuid: session.config.uploadUuid,
          inputName: file.inputName,
          error: error instanceof Error ? error.message : String(error ?? "")
        });
      }
    }
    return null;
  }
  for (const file of pending) {
    const value = fileIds[file.inputName];
    let resolved: string | undefined;
    if (Array.isArray(value)) {
      resolved = value[file.fileIndex] ?? value[0];
    } else if (typeof value === "string") {
      resolved = value;
    }
    if (session.config.mode === "s3") {
      resolved = file.s3Path ?? resolved;
    }
    if (resolved) {
      file.fileId = resolved;
    }
    file.status = "completed";
    upsertAsyncUploadEntry(session, file, state);
    try {
      await storeFileRecord(file);
    } catch (error) {
      emitAsyncUploadError(state, "Failed to persist finalized async upload; continuing.", {
        uploadUuid: session.config.uploadUuid,
        inputName: file.inputName,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
    }
  }
  emitLog(state, {
    type: "info",
    message: "upload.finalize.complete",
    detail: { uploadUuid: session.config.uploadUuid },
    timestamp: Date.now()
  });
  return mapFilePayloads(files);
}

async function finalizeS3Uploads(
  session: AsyncUploadSession,
  files: AsyncUploadFileState[],
  state: RuntimeState
): Promise<Record<string, string | string[]> | null> {
  const base = session.config.uploaderUrl?.replace(/\/$/, "") ?? "";
  const uploads = files.map((file) => {
    if (!file.uploadId || !file.partEtags) {
      throw new Error("Missing S3 upload metadata.");
    }
    const parts = file.partEtags.map((etag, index) => {
      if (!etag) {
        throw new Error("Missing S3 part ETag.");
      }
      return { PartNumber: index + 1, ETag: etag };
    });
    const path = file.s3Path ?? pickS3Path({}, file);
    return { inputName: file.inputName, uploadId: file.uploadId, path, s3Path: path, parts };
  });
  const response = await fetch(`${resolveUploaderUrl(base, state.doc)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uploads
    })
  });
  if (!response.ok) {
    emitAsyncUploadError(state, "S3 finalize failed.", {
      status: response.status
    });
    return null;
  }
  const payload = await safeJson(response);
  const mapped = mapFinalizeFiles(payload);
  for (const file of files) {
    if (!mapped[file.inputName]) {
      mapped[file.inputName] = file.s3Path ?? pickS3Path({}, file);
    }
  }
  return mapped;
}

function mapFinalizeFiles(payload: unknown): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  const files = Array.isArray((payload as { files?: unknown[] })?.files)
    ? (payload as { files: Array<{ inputName?: string; fileId?: string; s3Path?: string; path?: string }> }).files
    : [];
  for (const entry of files) {
    const id = [entry?.s3Path, entry?.path, entry?.fileId].find(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    if (!entry?.inputName || !id) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(result, entry.inputName)) {
      const existing = result[entry.inputName];
      if (Array.isArray(existing)) {
        existing.push(id);
      } else {
        result[entry.inputName] = [existing as string, id];
      }
    } else {
      result[entry.inputName] = id;
    }
  }
  return result;
}

function resolveUploaderUrl(base: string, doc: Document): string {
  try {
    const resolved = new URL(base, doc.baseURI ?? doc.defaultView?.location?.href ?? undefined);
    return resolved.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
}

function mapFilePayloads(files: AsyncUploadFileState[]): Record<string, FileSubmitValue | FileSubmitValue[]> {
  const result: Record<string, FileSubmitValue | FileSubmitValue[]> = {};
  for (const file of files) {
    if (!file.fileId) {
      continue;
    }
    const value: FileSubmitValue = {
      fileId: file.fileId,
      contentType: file.mime,
      fileName: file.fileName,
      fileSize: file.size
    };
    if (Object.prototype.hasOwnProperty.call(result, file.inputName)) {
      const existing = result[file.inputName];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[file.inputName] = [existing as FileSubmitValue, value];
      }
    } else {
      result[file.inputName] = value;
    }
  }
  return result;
}

async function uploadChunkWithXhr(
  url: string,
  method: "PUT" | "PATCH",
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void
): Promise<{ status: number; etag: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ status: xhr.status, etag });
      } else {
        reject(new Error(`Chunk upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Chunk upload network error."));
    xhr.send(body);
  });
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

export function markAsyncUploadFailed(
  fileState: AsyncUploadFileState,
  session: AsyncUploadSession,
  state: RuntimeState,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  fileState.status = "failed";
  fileState.lastError = message;
  fileState.file = undefined;
  fileState.inFlightProgress.clear();
  upsertAsyncUploadEntry(session, fileState, state);
  void storeFileRecord(fileState).catch((storeError) => {
    emitAsyncUploadError(state, "Failed to persist failed async upload state; continuing.", {
      uploadUuid: fileState.fileUuid,
      inputName: fileState.inputName,
      error: storeError instanceof Error ? storeError.message : String(storeError ?? "")
    });
  });
  emitLog(state, {
    type: "error",
    message: "upload.failed",
    detail: {
      uploadUuid: fileState.fileUuid,
      inputName: fileState.inputName,
      error: message
    },
    timestamp: Date.now()
  });
}
