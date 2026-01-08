import type { AsyncUploadEntry } from "../types";
import type { AsyncUploadFileState, AsyncUploadSession, RuntimeState } from "../state";

export function upsertAsyncUploadEntry(
  session: AsyncUploadSession,
  fileState: AsyncUploadFileState,
  state: RuntimeState
): void {
  const key = fileState.key;
  const existing = state.asyncUploadEntries.get(key);
  const progress = computeUploadProgress(fileState);
  const entry: AsyncUploadEntry =
    existing ?? {
      uploadUuid: fileState.fileUuid,
      formId: session.config.formId,
      inputName: fileState.inputName,
      fileName: fileState.fileName,
      size: fileState.size,
      mime: fileState.mime,
      status: fileState.status,
      totalChunks: fileState.totalChunks,
      uploadedChunks: fileState.uploadedChunks,
      progress,
      startedAt: fileState.startedAt
    };
  entry.status = fileState.status;
  entry.totalChunks = fileState.totalChunks;
  entry.uploadedChunks = fileState.uploadedChunks;
  entry.progress = progress;
  entry.lastError = fileState.lastError;
  state.asyncUploadEntries.set(key, entry);
  const list = state.globals.hy.uploading;
  if (list && !list.includes(entry)) {
    list.push(entry);
  }
}

export function removeAsyncUploadEntry(fileState: AsyncUploadFileState, state: RuntimeState): void {
  const entry = state.asyncUploadEntries.get(fileState.key);
  if (!entry) {
    return;
  }
  state.asyncUploadEntries.delete(fileState.key);
  const list = state.globals.hy.uploading;
  if (!list) {
    return;
  }
  const index = list.indexOf(entry);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function computeUploadProgress(fileState: AsyncUploadFileState): number {
  const inflight = Array.from(fileState.inFlightProgress.values()).reduce((sum, value) => sum + value, 0);
  if (fileState.totalChunks <= 0) {
    return 0;
  }
  return Math.min(1, (fileState.uploadedChunks + inflight) / fileState.totalChunks);
}
