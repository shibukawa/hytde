import { buildAsyncUploadPayload } from "./payload";
import { collectFormValuesWithoutFiles, formEntriesToPayload } from "../forms/values";
import type {
  AsyncUploadConfig,
  AsyncUploadFileState,
  AsyncUploadSession,
  RuntimeState
} from "../state";
import type { ParsedAsyncUploadForm, ParsedRequestTarget } from "../types";
import { emitLog } from "../utils/logging";
import { resolveRequestUrl } from "../requests/runtime";
import { disableFormControls, restoreFormControls } from "../form/form-state";
import { emitAsyncUploadError } from "./async-upload-errors";
import { ASYNC_UPLOAD_CLEAR_DELAY_MS, ASYNC_UPLOAD_MAX_CONCURRENCY } from "../state/constants";
import type { AsyncUploadFileRecord } from "./async-upload-storage";
import {
  clearPendingSubmission,
  deleteStoredFile,
  loadStoredFiles,
  readPendingSubmission,
  storeFileChunks,
  storeFileRecord,
  writePendingSubmission
} from "./async-upload-storage";
import { removeAsyncUploadEntry, upsertAsyncUploadEntry } from "./async-upload-state";
import {
  finalizeUploads,
  markAsyncUploadFailed,
  maybeSubmitPendingAsyncUpload,
  startAsyncUploadForFile
} from "./async-upload-transfer";

export function setupAsyncUploadHandlers(state: RuntimeState): void {
  const forms = state.parsed.asyncUploadForms;
  for (const entry of forms) {
    const form = entry.form;
    if (state.asyncUploads.has(form)) {
      continue;
    }
    const config = buildAsyncUploadConfig(entry);
    const session: AsyncUploadSession = {
      config,
      files: new Map(),
      pendingSubmit: null
    };
    state.asyncUploads.set(form, session);
    attachAsyncUploadListeners(form, session, state);
    stripAsyncUploadAttributes(form);
    void resumePendingAsyncUpload(session, state);
  }
}

export function stripAsyncUploadAttributes(form: HTMLFormElement): void {
  const attrs = ["hy-async-upload", "hy-uploader-url", "hy-file-chunksize", "hy-after-submit-action"];
  for (const attr of attrs) {
    form.removeAttribute(attr);
  }
}

function attachAsyncUploadListeners(form: HTMLFormElement, session: AsyncUploadSession, state: RuntimeState): void {
  const inputs = Array.from(form.elements).filter(
    (element): element is HTMLInputElement => element instanceof HTMLInputElement && element.type === "file"
  );
  for (const input of inputs) {
    input.addEventListener("change", () => {
      if (!input.files || input.files.length === 0) {
        return;
      }
      void handleFileInputChange(input, session, state).catch((error) => {
        markAsyncUploadFailed(
          {
            key: "",
            uploadUuid: session.config.uploadUuid,
            fileUuid: createUploadUuid(),
            inputName: input.name ?? "",
            fileIndex: 0,
            fileName: input.files?.[0]?.name ?? "",
            size: input.files?.[0]?.size ?? 0,
            mime: input.files?.[0]?.type ?? "application/octet-stream",
            chunkSizeBytes: session.config.chunkSizeBytes,
            totalChunks: 0,
            uploadedChunks: 0,
            status: "failed",
            startedAt: Date.now(),
            inFlightProgress: new Map()
          },
          session,
          state,
          error
        );
      });
    });
  }
  form.addEventListener("drop", (event) => {
    const data = event.dataTransfer;
    if (!data || data.files.length === 0) {
      return;
    }
    event.preventDefault();
    if (inputs.length !== 1) {
      emitAsyncUploadError(state, "Drop upload requires exactly one file input.", {
        formId: session.config.formId ?? undefined
      });
      return;
    }
    void handleFileInputChange(inputs[0], session, state, data.files).catch((error) => {
      markAsyncUploadFailed(
        {
          key: "",
          uploadUuid: session.config.uploadUuid,
          fileUuid: createUploadUuid(),
          inputName: inputs[0].name ?? "",
          fileIndex: 0,
          fileName: data.files?.[0]?.name ?? "",
          size: data.files?.[0]?.size ?? 0,
          mime: data.files?.[0]?.type ?? "application/octet-stream",
          chunkSizeBytes: session.config.chunkSizeBytes,
          totalChunks: 0,
          uploadedChunks: 0,
          status: "failed",
          startedAt: Date.now(),
          inFlightProgress: new Map()
        },
        session,
        state,
        error
      );
    });
  });
  form.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) {
      event.preventDefault();
    }
  });
}

function buildAsyncUploadConfig(entry: ParsedAsyncUploadForm): AsyncUploadConfig {
  const formId = entry.form.id?.trim() ? entry.form.id.trim() : null;
  return {
    form: entry.form,
    formId,
    mode: entry.mode,
    uploaderUrl: entry.uploaderUrl,
    chunkSizeBytes: entry.chunkSizeBytes,
    concurrency: ASYNC_UPLOAD_MAX_CONCURRENCY,
    uploadUuid: createUploadUuid(),
    afterSubmitAction: entry.afterSubmitAction,
    afterSubmitActionPresent: entry.afterSubmitActionPresent,
    redirectConflict: entry.redirectConflict
  };
}

function createUploadUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export { emitAsyncUploadError } from "./async-upload-errors";
export async function scheduleClearAfterSubmit(
  form: HTMLFormElement,
  session: AsyncUploadSession,
  state: RuntimeState
): Promise<void> {
  disableFormControls(form, state);
  const view = state.doc.defaultView;
  if (view) {
    await new Promise<void>((resolve) => {
      view.setTimeout(resolve, ASYNC_UPLOAD_CLEAR_DELAY_MS);
    });
  }
  form.reset();
  await clearAsyncUploadSession(session, state);
  restoreFormControls(form, state);
  emitLog(state, {
    type: "info",
    message: "submit:clear",
    detail: { formId: form.id || undefined },
    timestamp: Date.now()
  });
}

async function resumePendingAsyncUpload(session: AsyncUploadSession, state: RuntimeState): Promise<void> {
  const pending = readPendingSubmission(session, state);
  if (pending) {
    session.pendingSubmit = pending;
  }
  let files: AsyncUploadFileRecord[] = [];
  try {
    files = await loadStoredFiles(session.config.uploadUuid);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to load stored async upload records; resuming with empty queue.", {
      uploadUuid: session.config.uploadUuid,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
  for (const record of files) {
    const key = buildAsyncUploadFileKey(record.inputName, record.fileIndex);
    if (session.files.has(key)) {
      continue;
    }
    const partEtags = Array.isArray(record.partEtags) ? record.partEtags : undefined;
    const chunkSizeBytes = record.chunkSizeBytes ?? session.config.chunkSizeBytes;
    const uploadedChunks =
      session.config.mode === "s3" && partEtags
        ? partEtags.filter((etag) => Boolean(etag)).length
        : record.uploadedChunks;
    const fileState: AsyncUploadFileState = {
      key,
      uploadUuid: record.uploadUuid,
      fileUuid: record.fileUuid || record.uploadUuid,
      inputName: record.inputName,
      fileIndex: record.fileIndex,
      fileName: record.fileName,
      size: record.size,
      mime: record.mime,
      chunkSizeBytes,
      totalChunks: record.totalChunks,
      uploadedChunks,
      status: record.status,
      startedAt: record.startedAt,
      lastError: record.lastError,
      uploadId: record.uploadId,
      s3Path: record.s3Path,
      partUrls: record.partUrls,
      partEtags,
      fileId: record.fileId,
      inFlightProgress: new Map()
    };
    session.files.set(key, fileState);
    upsertAsyncUploadEntry(session, fileState, state);
    if (fileState.status !== "completed" && fileState.status !== "failed") {
      void startAsyncUploadForFile(fileState, session, state);
    }
  }
  await maybeSubmitPendingAsyncUpload(session, state);
}

async function handleFileInputChange(
  input: HTMLInputElement,
  session: AsyncUploadSession,
  state: RuntimeState,
  filesOverride?: FileList
): Promise<void> {
  const files = filesOverride ?? input.files;
  if (!files || files.length === 0) {
    return;
  }
  const inputName = input.name?.trim();
  if (!inputName) {
    emitAsyncUploadError(state, "File input requires a name for async upload.", {
      formId: session.config.formId ?? undefined
    });
    return;
  }
  const existing = Array.from(session.files.values()).filter((file) => file.inputName === inputName);
  for (const file of existing) {
    await clearAsyncUploadFile(session, inputName, file.fileIndex, state);
  }
  const now = Date.now();
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const fileUuid = createUploadUuid();
    const totalChunks =
      session.config.mode === "s3" ? Math.max(1, Math.ceil(file.size / session.config.chunkSizeBytes)) : 1;
    const key = buildAsyncUploadFileKey(inputName, fileIndex);
    const fileState: AsyncUploadFileState = {
      key,
      uploadUuid: session.config.uploadUuid,
      fileUuid,
      inputName,
      fileIndex,
      fileName: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      chunkSizeBytes: session.config.mode === "s3" ? session.config.chunkSizeBytes : file.size,
      totalChunks,
      uploadedChunks: 0,
      status: "queued",
      startedAt: now,
      inFlightProgress: new Map(),
      file: session.config.mode === "simple" ? file : undefined
    };
    session.files.set(key, fileState);
    upsertAsyncUploadEntry(session, fileState, state);
    if (session.config.mode === "s3") {
      try {
        await storeFileRecord(fileState);
        await storeFileChunks(fileState, file);
      } catch (error) {
        emitAsyncUploadError(state, "IndexedDB unavailable for async upload; falling back to in-memory chunks.", {
          formId: session.config.formId ?? undefined,
          inputName,
          error: error instanceof Error ? error.message : String(error ?? "")
        });
      }
    }
    fileState.file = file;
    emitLog(state, {
      type: "info",
      message: "upload.session.create",
      detail: { uploadUuid: fileState.fileUuid, inputName, fileIndex },
      timestamp: Date.now()
    });
    void startAsyncUploadForFile(fileState, session, state);
  }
}

async function clearAsyncUploadFile(
  session: AsyncUploadSession,
  inputName: string,
  fileIndex: number,
  state: RuntimeState
): Promise<void> {
  const key = buildAsyncUploadFileKey(inputName, fileIndex);
  const existing = session.files.get(key);
  if (!existing) {
    try {
      await deleteStoredFile(session.config.uploadUuid, inputName, fileIndex, 0);
    } catch (error) {
      emitAsyncUploadError(state, "Failed to clear previous async upload state; continuing with new file.", {
        uploadUuid: session.config.uploadUuid,
        inputName,
        error: error instanceof Error ? error.message : String(error ?? "")
      });
    }
    return;
  }
  session.files.delete(key);
  removeAsyncUploadEntry(existing, state);
  try {
    await deleteStoredFile(existing.uploadUuid, inputName, fileIndex, existing.totalChunks);
  } catch (error) {
    emitAsyncUploadError(state, "Failed to clear stored chunks for async upload; continuing with new file.", {
      uploadUuid: session.config.uploadUuid,
      inputName,
      error: error instanceof Error ? error.message : String(error ?? "")
    });
  }
}

async function clearAsyncUploadSession(session: AsyncUploadSession, state: RuntimeState): Promise<void> {
  const files = Array.from(session.files.values());
  for (const file of files) {
    await clearAsyncUploadFile(session, file.inputName, file.fileIndex, state);
  }
  clearPendingSubmission(session, state);
}

function buildAsyncUploadFileKey(inputName: string, fileIndex: number): string {
  return `${inputName}:${fileIndex}`;
}

export async function prepareAsyncUploadSubmission(
  target: ParsedRequestTarget,
  state: RuntimeState
): Promise<{ blocked: boolean; overridePayload?: Record<string, unknown>; overrideUrl?: string }> {
  const form = target.form;
  if (!form) {
    return { blocked: false };
  }
  const session = state.asyncUploads.get(form);
  if (!session || target.method === "GET") {
    return { blocked: false };
  }
  const files = Array.from(session.files.values());
  if (files.length === 0) {
    return { blocked: false };
  }
  const failed = files.find((file) => file.status === "failed");
  if (failed) {
    emitAsyncUploadError(state, "Async upload failed; submission blocked.", {
      uploadUuid: session.config.uploadUuid,
      inputName: failed.inputName
    });
    return { blocked: true };
  }
  const pendingUploads = files.some((file) => file.uploadedChunks < file.totalChunks || file.status === "queued");
  if (pendingUploads) {
    const payload = formEntriesToPayload(collectFormValuesWithoutFiles(form));
    const actionUrl = resolveRequestUrl(target, state).value;
    writePendingSubmission(session, { target, payload, method: target.method, actionUrl }, state);
    emitLog(state, {
      type: "info",
      message: "upload.pending",
      detail: { uploadUuid: session.config.uploadUuid, formId: session.config.formId ?? undefined },
      timestamp: Date.now()
    });
    return { blocked: true };
  }
  const fileIds = await finalizeUploads(session, state);
  if (!fileIds) {
    const payload = formEntriesToPayload(collectFormValuesWithoutFiles(form));
    const actionUrl = resolveRequestUrl(target, state).value;
    writePendingSubmission(session, { target, payload, method: target.method, actionUrl }, state);
    return { blocked: true };
  }
  const payload = buildAsyncUploadPayload(formEntriesToPayload(collectFormValuesWithoutFiles(form)), fileIds);
  return { blocked: false, overridePayload: payload };
}
