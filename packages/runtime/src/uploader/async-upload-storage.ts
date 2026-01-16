import type {
  AsyncUploadFileState,
  AsyncUploadPendingSubmit,
  AsyncUploadSession,
  RuntimeState
} from "../state.js";
import type { AsyncUploadStatus, ParsedRequestTarget } from "../types.js";
import { emitAsyncUploadError } from "./async-upload-errors.js";

const ASYNC_UPLOAD_DB_NAME = "hytde-async-upload";
const ASYNC_UPLOAD_DB_VERSION = 1;
const ASYNC_UPLOAD_CHUNK_STORE = "chunks";
const ASYNC_UPLOAD_FILE_STORE = "files";
const ASYNC_UPLOAD_PENDING_PREFIX = "hytde:async-upload:pending:";
const ASYNC_UPLOAD_SESSION_PREFIX = "hytde:async-upload:session:";
let asyncUploadDbPromise: Promise<IDBDatabase> | null = null;

export type AsyncUploadFileRecord = {
  uploadUuid: string;
  fileUuid: string;
  inputName: string;
  fileIndex: number;
  fileName: string;
  size: number;
  mime: string;
  chunkSizeBytes: number;
  totalChunks: number;
  uploadedChunks: number;
  status: AsyncUploadStatus;
  startedAt: number;
  lastError?: string;
  uploadId?: string;
  s3Path?: string;
  partUrls?: string[];
  partEtags?: Array<string | null>;
  fileId?: string;
};

type AsyncUploadChunkRecord = {
  uploadUuid: string;
  fileUuid: string;
  inputName: string;
  fileIndex: number;
  chunkIndex: number;
  blob: Blob;
};

type AsyncUploadSessionStorage = {
  uploadUuid: string;
  formId: string | null;
  updatedAt: string;
};

type AsyncUploadPendingStorage = {
  uploadUuid: string;
  formId: string | null;
  targetId?: string | null;
  method: string;
  actionUrl: string;
  payload: Record<string, unknown>;
};

export async function storeFileRecord(fileState: AsyncUploadFileState): Promise<void> {
  const db = await getAsyncUploadDb();
  const record: AsyncUploadFileRecord = {
    uploadUuid: fileState.uploadUuid,
    fileUuid: fileState.fileUuid,
    inputName: fileState.inputName,
    fileIndex: fileState.fileIndex,
    fileName: fileState.fileName,
    size: fileState.size,
    mime: fileState.mime,
    chunkSizeBytes: fileState.chunkSizeBytes,
    totalChunks: fileState.totalChunks,
    uploadedChunks: fileState.uploadedChunks,
    status: fileState.status,
    startedAt: fileState.startedAt,
    lastError: fileState.lastError,
    uploadId: fileState.uploadId,
    s3Path: fileState.s3Path,
    partUrls: fileState.partUrls,
    partEtags: fileState.partEtags,
    fileId: fileState.fileId
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASYNC_UPLOAD_FILE_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(ASYNC_UPLOAD_FILE_STORE).put(record);
  });
}

export async function loadStoredFiles(uploadUuid: string): Promise<AsyncUploadFileRecord[]> {
  const db = await getAsyncUploadDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASYNC_UPLOAD_FILE_STORE, "readonly");
    const store = tx.objectStore(ASYNC_UPLOAD_FILE_STORE);
    const index = store.index("byUploadUuid");
    const request = index.getAll(uploadUuid);
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function storeFileChunks(fileState: AsyncUploadFileState, file: File): Promise<void> {
  const db = await getAsyncUploadDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASYNC_UPLOAD_CHUNK_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(ASYNC_UPLOAD_CHUNK_STORE);
    const chunkSize = fileState.chunkSizeBytes;
    for (let index = 0; index < fileState.totalChunks; index += 1) {
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const blob = file.slice(start, end);
      const record: AsyncUploadChunkRecord = {
        uploadUuid: fileState.uploadUuid,
        fileUuid: fileState.fileUuid,
        inputName: fileState.inputName,
        fileIndex: fileState.fileIndex,
        chunkIndex: index,
        blob
      };
      store.put(record);
    }
  });
}

export async function loadChunkBlob(
  uploadUuid: string,
  inputName: string,
  fileIndex: number,
  chunkIndex: number
): Promise<Blob | null> {
  const db = await getAsyncUploadDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASYNC_UPLOAD_CHUNK_STORE, "readonly");
    const store = tx.objectStore(ASYNC_UPLOAD_CHUNK_STORE);
    const request = store.get([uploadUuid, inputName, fileIndex, chunkIndex]);
    request.onsuccess = () => resolve(request.result?.blob ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteStoredFile(
  uploadUuid: string,
  inputName: string,
  fileIndex: number,
  totalChunks: number
): Promise<void> {
  const db = await getAsyncUploadDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([ASYNC_UPLOAD_CHUNK_STORE, ASYNC_UPLOAD_FILE_STORE], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const chunkStore = tx.objectStore(ASYNC_UPLOAD_CHUNK_STORE);
    for (let index = 0; index < totalChunks; index += 1) {
      chunkStore.delete([uploadUuid, inputName, fileIndex, index]);
    }
    tx.objectStore(ASYNC_UPLOAD_FILE_STORE).delete([uploadUuid, inputName, fileIndex]);
  });
}

export async function deleteStoredChunk(
  uploadUuid: string,
  inputName: string,
  fileIndex: number,
  chunkIndex: number
): Promise<void> {
  const db = await getAsyncUploadDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ASYNC_UPLOAD_CHUNK_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(ASYNC_UPLOAD_CHUNK_STORE).delete([uploadUuid, inputName, fileIndex, chunkIndex]);
  });
}

export function readPendingSubmission(session: AsyncUploadSession, state: RuntimeState): AsyncUploadPendingSubmit | null {
  const key = `${ASYNC_UPLOAD_PENDING_PREFIX}${session.config.uploadUuid}`;
  let raw: string | null = null;
  try {
    raw = state.doc.defaultView?.localStorage?.getItem(key) ?? null;
  } catch (error) {
    emitAsyncUploadError(state, "Failed to read async upload pending state.", {
      uploadUuid: session.config.uploadUuid
    });
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as AsyncUploadPendingStorage;
    const target = resolvePendingSubmissionTarget(session, parsed, state);
    if (!target) {
      return null;
    }
    return {
      target,
      payload: parsed.payload ?? {},
      method: parsed.method,
      actionUrl: parsed.actionUrl
    };
  } catch (error) {
    emitAsyncUploadError(state, "Failed to parse async upload pending state.", {
      uploadUuid: session.config.uploadUuid
    });
    return null;
  }
}

export function writePendingSubmission(
  session: AsyncUploadSession,
  pending: AsyncUploadPendingSubmit,
  state: RuntimeState
): void {
  session.pendingSubmit = pending;
  const key = `${ASYNC_UPLOAD_PENDING_PREFIX}${session.config.uploadUuid}`;
  const targetId =
    pending.target.element instanceof HTMLElement && pending.target.element.id
      ? pending.target.element.id
      : null;
  const record: AsyncUploadPendingStorage = {
    uploadUuid: session.config.uploadUuid,
    formId: session.config.formId,
    targetId,
    method: pending.method,
    actionUrl: pending.actionUrl,
    payload: pending.payload
  };
  try {
    state.doc.defaultView?.localStorage?.setItem(key, JSON.stringify(record));
  } catch (error) {
    emitAsyncUploadError(state, "Failed to store async upload pending state.", {
      uploadUuid: session.config.uploadUuid
    });
  }
}

export function clearPendingSubmission(session: AsyncUploadSession, state: RuntimeState): void {
  const key = `${ASYNC_UPLOAD_PENDING_PREFIX}${session.config.uploadUuid}`;
  try {
    state.doc.defaultView?.localStorage?.removeItem(key);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to clear async upload pending state.", {
      uploadUuid: session.config.uploadUuid
    });
  }
}

async function getAsyncUploadDb(): Promise<IDBDatabase> {
  if (asyncUploadDbPromise) {
    return asyncUploadDbPromise;
  }
  asyncUploadDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ASYNC_UPLOAD_DB_NAME, ASYNC_UPLOAD_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASYNC_UPLOAD_CHUNK_STORE)) {
        db.createObjectStore(ASYNC_UPLOAD_CHUNK_STORE, {
          keyPath: ["uploadUuid", "inputName", "fileIndex", "chunkIndex"]
        });
      }
      if (!db.objectStoreNames.contains(ASYNC_UPLOAD_FILE_STORE)) {
        const store = db.createObjectStore(ASYNC_UPLOAD_FILE_STORE, {
          keyPath: ["uploadUuid", "inputName", "fileIndex"]
        });
        store.createIndex("byUploadUuid", "uploadUuid");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return asyncUploadDbPromise;
}

function getAsyncUploadSessionKey(form: HTMLFormElement, state: RuntimeState): string | null {
  const pathname = state.doc.defaultView?.location?.pathname ?? "";
  const formId = form.id?.trim();
  if (formId) {
    return `${ASYNC_UPLOAD_SESSION_PREFIX}${pathname}:form:${formId}`;
  }
  const name = form.getAttribute("name")?.trim();
  if (name) {
    return `${ASYNC_UPLOAD_SESSION_PREFIX}${pathname}:form-name:${name}`;
  }
  const action = form.getAttribute("action")?.trim() ?? form.action?.trim() ?? "";
  if (action) {
    return `${ASYNC_UPLOAD_SESSION_PREFIX}${pathname}:form-action:${action}`;
  }
  return null;
}

function readAsyncUploadSessionId(_form: HTMLFormElement, _state: RuntimeState): string | null {
  return null;
}

function writeAsyncUploadSessionId(_form: HTMLFormElement, _state: RuntimeState, _uploadUuid: string): void {
  void _form;
  void _state;
  void _uploadUuid;
}

function resolvePendingSubmissionTarget(
  session: AsyncUploadSession,
  parsed: AsyncUploadPendingStorage,
  state: RuntimeState
): ParsedRequestTarget | null {
  const candidates = state.parsed.requestTargets.filter(
    (target) => target.trigger === "submit" && target.form === session.config.form
  );
  if (candidates.length === 0) {
    return null;
  }
  if (parsed.targetId) {
    const match = candidates.find(
      (candidate) => candidate.element instanceof HTMLElement && candidate.element.id === parsed.targetId
    );
    if (match) {
      return match;
    }
  }
  return candidates[0];
}
