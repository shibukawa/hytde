import type { FileSubmitValue } from "./types";

export function buildAsyncUploadPayload(
  basePayload: Record<string, unknown>,
  files: Record<string, FileSubmitValue | FileSubmitValue[]>
): Record<string, unknown> {
  const payload = { ...basePayload };
  for (const [key, value] of Object.entries(files)) {
    payload[key] = value;
  }
  return payload;
}
