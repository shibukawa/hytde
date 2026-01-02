# Async File Uploading (S3 Multipart / tus)

This spec defines HyTDE async file uploading for `<form>` with `hy-async-upload`.
The feature targets resumable chunked uploads with JSON form submission.

## 1. Goals
- Support async uploads for file inputs while keeping the HTML form functional.
- Allow resumable background uploads with explicit finalize semantics.
- Provide UI state for in-flight uploads (`hy.uploading`).

## 2. Non-goals
- Auto-merging files on the client (server remains the authority).
- Implicit server-side scopes or template scripting.

## 3. Attributes
### 3.1 `hy-async-upload`
Applied to a `<form>`.
- `hy-async-upload="s3"` enables S3 multipart flow (server-mediated).
- `hy-async-upload="tus"` enables tus.io protocol flow.

### 3.2 `hy-uploader-url`
Optional base URL for uploader endpoints.
- Used for S3 init/complete and tus create/finalize.
- Required when `hy-async-upload="s3"`.
- Optional when `hy-async-upload="tus"`; if omitted, the form `action` is used.

### 3.3 `hy-file-chunksize`
Chunk size in MiB units (`1024 * 1024` bytes).
- Default: `10` (10 MiB).
- Minimum: `5` (5 MiB, aligned with S3 multipart minimum).

## 4. Runtime lifecycle
1. On form initialization, generate a UUID for the upload session (`uploadUuid`).
2. When a file input changes or a file is dropped onto the form:
   - Split each file into chunks (size from `hy-file-chunksize`).
   - Persist chunks into indexedDB, keyed by `uploadUuid`, file input name, and chunk index.
   - Start uploading chunks immediately in the background.
3. Uploads continue independently of the form submission event.

## 5. Submission gating + persistence
- When the user submits the form:
  - If any async upload is incomplete, delay the submission.
  - Persist the pending submission metadata in localStorage with `uploadUuid` so it can resume after reload.
- When all chunks are uploaded and the pending submission is ready:
  - Run finalize for each file to obtain a stable file ID.
  - Submit the original form payload as JSON, replacing file inputs with the finalized file IDs.

## 6. Finalize timing
- Finalize is executed immediately before the actual form submission.
- Rationale: servers can garbage-collect unfinalized chunks after a time window (e.g. 1 day).

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
- `hy.uploading` does not expose `uploaderUrl`.

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
      "parts": [
        { "partNumber": 1, "url": "https://..." }
      ]
    }
  ]
}
```

Notes:
- `parts` is a list of per-chunk upload URLs or tokens provided by the server.

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
      "parts": [
        { "partNumber": 1, "etag": "etag" }
      ]
    }
  ]
}
```

Response:
```json
{
  "files": [
    { "inputName": "file", "fileId": "file_123" }
  ]
}
```

## 9. tus flow (tus.io)
This follows the tus.io protocol for creation and chunked PATCH uploads.
Paths are dictated by the tus server; HyTDE does not modify them.

### 9.1 Create
`POST {uploaderBase}` to create an upload, returning a `Location` header.

### 9.2 Upload chunks
`PATCH {Location}` with tus headers for chunked upload.

### 9.3 Finalize
`POST {uploaderBase}/finalize`

Request:
```json
{
  "uploadUuid": "uuid",
  "uploads": [
    { "inputName": "file", "location": "https://tus.server/files/abc" }
  ]
}
```

Response:
```json
{
  "files": [
    { "inputName": "file", "fileId": "file_123" }
  ]
}
```

## 10. Form submission payload
The final submit replaces file inputs with file IDs.

Example JSON submit:
```json
{
  "title": "Monthly Report",
  "file": { "fileId": "file_123" }
}
```

## 11. Error handling
- If any chunk upload fails, the file status becomes `failed` and the form submission remains gated.
- Users can retry uploads; the client should resume from indexedDB chunks.
- Errors are also reflected in `hy.errors` for template-level handling.
