import type { HyError } from "@hytde/runtime";

export type PrefetchEntry = {
  path: string;
  method: string;
  status: number | null;
  headers: Record<string, string>;
  payload: unknown;
  store: string | null;
  unwrap: string | null;
  ok: boolean;
  error?: string;
};

export type SsrState = {
  mode: "ssr";
  initialState: Record<string, unknown>;
  prefetched: PrefetchEntry[];
  errors: HyError[];
};

export type SlotDescriptor = {
  id: string;
  kind: "inner" | "outer";
  html: string;
};

export type NodeMeta = {
  tag: string;
  attrs: Record<string, string>;
};

export type SlotifiedTemplate = {
  version: 1;
  templateId: string;
  static: string[];
  slots: SlotDescriptor[];
  ir: unknown;
  nodeMeta: Record<string, NodeMeta>;
};

export type SsrConfig = {
  templateRoot?: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  getAuthHeaders?: (request: Request) => Promise<Record<string, string>> | Record<string, string>;
  debug?: boolean;
};
