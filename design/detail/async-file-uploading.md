# Async File Uploading (S3 Multipart / Simple Multipart)

This spec defines HyTDE async file uploading for `<form>` with `hy-async-upload`.
The feature supports S3 multipart uploads with chunking + finalize, and a simple non-chunked multipart upload with XHR progress. JSON form submission replaces file inputs with finalized paths/IDs. Step 2 expands to multiple files per input, richer payload metadata, and post-submit UX (reset/redirect, progress dialog).

## 1. Goals
- Support async uploads for file inputs while keeping the HTML form functional.
- Allow resumable background uploads with explicit finalize semantics.
- Provide UI state for in-flight uploads (`hy.uploading`).
- Support multiple files per input and array submits with file metadata.
- Provide clear post-submit UX (reset/redirect) and a progress dialog.

## 2. Non-goals
- Auto-merging files on the client (server remains the authority).
- Implicit server-side scopes or template scripting.

## 3. Attributes
### 3.1 `hy-async-upload`
Applied to a `<form>`.
- `hy-async-upload="s3"` enables S3 multipart flow (server-mediated).
- `hy-async-upload="simple"` enables simple single-request multipart upload (no chunking).
- When present with an empty value, `simple` is the default.

### 3.2 `hy-uploader-url`
Optional base URL for uploader endpoints.
- Used for S3 init/complete and simple upload POST.
- Required when `hy-async-upload="s3"`.
- Optional when `hy-async-upload="simple"`; if omitted, the form `action` is used.

### 3.3 `hy-file-chunksize`
Chunk size in MiB units (`1024 * 1024` bytes).
- Default: `10` (10 MiB).
- Minimum: `5` (5 MiB, aligned with S3 multipart minimum).
- Applies to S3 only; simple mode ignores this attribute.

## 4. Runtime lifecycle
1. On form initialization, generate a UUID for the upload session (`uploadUuid`).
2. When a file input changes or a file is dropped onto the form:
   - Enqueue each selected file as its own upload under the input name (multi-file allowed); maintain array order.
   - S3: split into chunks (size from `hy-file-chunksize`), persist chunks into IndexedDB keyed by `uploadUuid`/`inputName`/file index/chunk index, and start uploading with XHR progress (max 6 in flight per file).
   - Simple: send a single multipart upload per file via XHR (no chunking) that includes `uploadUuid`, `inputName`, and file metadata; track progress via XHR events; no IndexedDB persistence.
3. Uploads continue independently of the form submission event.

## 5. Submission gating + persistence
- When the user submits the form:
  - If any async upload is incomplete, delay the submission.
  - Persist the pending submission metadata in localStorage with `uploadUuid` so it can resume after reload.
- When uploads are ready:
  - S3: run finalize for each file to obtain stable S3 paths.
  - Simple: rely on the known path/UUID from the completed upload (no finalize call).
- Submit the original form payload as JSON, replacing file inputs with arrays of file objects `{ fileId, contentType, fileName, fileSize }` (single file may be represented as an object).

## 6. Finalize timing
- S3 finalize is executed immediately before the actual form submission.
  - Rationale: servers can garbage-collect unfinalized chunks after a time window (e.g. 1 day).
- Simple mode has no finalize; completion is the XHR upload finishing successfully.

## 7. `hy.uploading` state
`hy.uploading` exposes a list of in-flight uploads for UI panels.

Required fields:
- `uploadUuid`: upload session UUID (form-scoped).
- `formId`: form element ID (or generated identifier).
- `inputName`: file input name.
- `fileName`: original file name.
- `size`: bytes.
- `mime`: MIME type.
- `status`: `queued | uploading | finalizing | completed | failed`.
- `totalChunks`: total chunk count.
- `uploadedChunks`: number uploaded.
- `progress`: `0..1` based on uploaded chunks (not finalize).
- `startedAt`: timestamp.
- `lastError`: optional error message.

Notes:
- `hy.uploading` does not expose `uploaderUrl`. Entries include file index for multi-file inputs.

## 8. S3 multipart flow (server-mediated)
The server mediates S3 multipart uploads and can allocate per-chunk URLs.

### 8.1 Endpoint base
The uploader base is `hy-uploader-url` if present; otherwise the form action URL.

### 8.2 Init
`POST {uploaderBase}/init`

Request:
```json
{
  "uploadUuid": "uuid",
  "files": [
    {
      "inputName": "file",
      "fileName": "report.pdf",
      "size": 12345,
      "mime": "application/pdf",
      "chunks": 12
    }
  ]
}
```

Response:
```json
{
  "uploads": [
    {
      "inputName": "file",
      "uploadId": "s3-upload-id",
      "s3Path": "/s3/uploads/file.pdf",
      "parts": [
        { "partNumber": 1, "url": "https://..." }
      ]
    }
  ]
}
```

Notes:
- `parts` is a list of per-chunk upload URLs or tokens provided by the server.
- `s3Path` is the eventual S3 object path used for complete + final form submit (dummy is acceptable for mock flows).

### 8.3 Upload chunks
`PUT {parts[i].url}` with the chunk body.

### 8.4 Complete
`POST {uploaderBase}/complete`

Request:
```json
{
  "uploadUuid": "uuid",
  "uploads": [
    {
      "inputName": "file",
      "uploadId": "s3-upload-id",
      "path": "/s3/uploads/file.pdf",
      "parts": [
        { "PartNumber": 1, "ETag": "etag" }
      ]
    }
  ]
}
```

Response:
```json
{
  "files": [
    { "inputName": "file", "fileId": "/s3/uploads/file.pdf" }
  ]
}
```

## 9. Simple multipart flow (single XHR, no finalize)
Simple mode is a single-request multipart upload with client-managed UUIDs.

### 9.1 Endpoint base
The uploader base is `hy-uploader-url` if present; otherwise the form action URL.

### 9.2 Upload
`POST {uploaderBase}` with `multipart/form-data`

Fields (alongside the file part under the original input name):
- `uploadUuid`: the session UUID.
- `inputName`: file input name.
- `fileName`: original file name.
- `size`: file size in bytes.
- `mime`: MIME type.

Response:
```json
{
  "inputName": "file",
  "path": "/simple/uploads/file.pdf"
}
```

Notes:
- XHR is used to emit progress events (bytes loaded / total).
- No chunking, no IndexedDB persistence, no finalize call.
- The client uses the returned `path` (or echoes a deterministic path/UUID if the server omits it) as the `fileId` in the final submit payload.

## 10. Form submission payload
The final submit replaces file inputs with file objects (or arrays of file objects for multi-file inputs).

File object shape:
```json
{ "fileId": "/s3/uploads/file.pdf", "contentType": "application/pdf", "fileName": "report.pdf", "fileSize": 12345 }
```

Example JSON submit:
```json
{
  "title": "Monthly Report",
  "files": [
    { "fileId": "/s3/uploads/file-1.pdf", "contentType": "application/pdf", "fileName": "file-1.pdf", "fileSize": 111 },
    { "fileId": "/s3/uploads/file-2.pdf", "contentType": "application/pdf", "fileName": "file-2.pdf", "fileSize": 222 }
  ]
}
```

Notes:
- For S3 async uploads, the submitted `fileId` value is the S3 object path (not the uploadId).
- For simple uploads, the submitted `fileId` value is the returned path (or deterministic client path based on UUID/input).

## 11. Post-submit behavior
- Redirect (`hy-redirect`): disable all submitters/inputs once submission starts; keep disabled unless an error occurs (then re-enable). Redirect includes file-dialog-triggered submits.
- Reset: after successful submit, disable controls for ~2s, then clear form fields and upload queue, and show a confirmation popover/toast. On error, re-enable without clearing.

## 12. Error handling
- S3: if any chunk upload fails, the file status becomes `failed` and the form submission remains gated; retries resume from IndexedDB chunks.
- Simple: if the single upload fails, status becomes `failed`; retry restarts the upload (no resume).
- Errors are also reflected in `hy.errors` for template-level handling.

## 13. Demo progress dialog (step 2)
- A modal/dialog lists all enqueued files (multi-file aware).
- Supports adding entries via file selection; supports marking removals by strike-through (keeps history).
- Shows granular progress per file (bars/ranges) and status badges.
- Updates entries incrementally without full re-render of the list.
