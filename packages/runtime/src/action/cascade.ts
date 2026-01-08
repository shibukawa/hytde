import { createHyError, pushError } from "../errors/ui";
import { emitLog } from "../utils/logging";
import type { CascadeDisabledState, CascadeState } from "../state";
import type { ParsedDocument, ParsedRequestTarget } from "../types";
import type { RuntimeState } from "../state";

export function buildCascadeState(state: RuntimeState | null, parsed: ParsedDocument): CascadeState {
  const storeToSelects = new Map<string, Set<HTMLSelectElement>>();
  const selectToStores = new Map<HTMLSelectElement, Set<string>>();
  const selectIds = new WeakMap<HTMLSelectElement, string>();
  const cycleSelects = new WeakSet<HTMLSelectElement>();
  const cycleLogs = new Set<string>();
  const disabledState = new WeakMap<HTMLSelectElement, CascadeDisabledState>();
  const actionSkip = new WeakSet<HTMLSelectElement>();

  for (const target of parsed.requestTargets) {
    if (target.trigger !== "action") {
      continue;
    }
    if (!(target.element instanceof HTMLSelectElement)) {
      continue;
    }
    const select = target.element;
    selectIds.set(select, select.id || select.name || "select");

    if (!target.store) {
      continue;
    }
    const store = target.store;
    if (!storeToSelects.has(store)) {
      storeToSelects.set(store, new Set());
    }
    storeToSelects.get(store)?.add(select);
    if (!selectToStores.has(select)) {
      selectToStores.set(select, new Set());
    }
    selectToStores.get(select)?.add(store);
  }

  const edges = new Map<HTMLSelectElement, Set<HTMLSelectElement>>();
  for (const [select, stores] of selectToStores.entries()) {
    for (const store of stores) {
      const downstream = storeToSelects.get(store);
      if (!downstream) {
        continue;
      }
      for (const next of downstream) {
        const existing = edges.get(select);
        if (existing) {
          existing.add(next);
        } else {
          edges.set(select, new Set([next]));
        }
      }
    }
  }

  const cycles = detectCascadeCycles(edges, selectIds, cycleSelects);
  if (state && cycles.length > 0) {
    emitCascadeCycleDiagnostics(state, cycles, cycleLogs);
  }

  return {
    storeToSelects,
    selectToStores,
    selectIds,
    cycleSelects,
    cycleLogs,
    disabledState,
    actionSkip
  };
}

function detectCascadeCycles(
  edges: Map<HTMLSelectElement, Set<HTMLSelectElement>>,
  selectIds: WeakMap<HTMLSelectElement, string>,
  cycleSelects: WeakSet<HTMLSelectElement>
): string[] {
  const visiting = new Set<HTMLSelectElement>();
  const visited = new Set<HTMLSelectElement>();
  const path: HTMLSelectElement[] = [];
  const cycles: string[] = [];

  const labelFor = (select: HTMLSelectElement): string => {
    return selectIds.get(select) ?? "select";
  };

  const recordCycle = (startIndex: number): void => {
    const slice = path.slice(startIndex);
    for (const node of slice) {
      cycleSelects.add(node);
    }
    if (slice.length === 0) {
      return;
    }
    const names = slice.map(labelFor);
    names.push(labelFor(slice[0]));
    cycles.push(names.join(" -> "));
  };

  const dfs = (select: HTMLSelectElement): void => {
    if (visiting.has(select)) {
      const startIndex = path.indexOf(select);
      if (startIndex >= 0) {
        recordCycle(startIndex);
      }
      return;
    }
    if (visited.has(select)) {
      return;
    }
    visiting.add(select);
    path.push(select);
    for (const next of edges.get(select) ?? []) {
      dfs(next);
    }
    path.pop();
    visiting.delete(select);
    visited.add(select);
  };

  for (const select of edges.keys()) {
    dfs(select);
  }

  return cycles;
}

function emitCascadeCycleDiagnostics(state: RuntimeState, cycles: string[], cycleLogs: Set<string>): void {
  for (const cycle of cycles) {
    if (cycleLogs.has(cycle)) {
      continue;
    }
    cycleLogs.add(cycle);
    emitLog(state, {
      type: "error",
      message: "cascade:cycle",
      detail: { cycle },
      timestamp: Date.now()
    });
    pushError(state, createHyError("data", "Cascade dependency cycle detected", { cycle }));
  }
}

export function markCascadeRequestPending(target: ParsedRequestTarget, state: RuntimeState): void {
  if (!target.store) {
    return;
  }
  const selects = state.cascade.storeToSelects.get(target.store);
  if (!selects) {
    return;
  }
  for (const select of selects) {
    disableCascadeSelect(select, state);
  }
}

export function disableCascadeSelect(select: HTMLSelectElement, state: RuntimeState): void {
  const existing = state.cascade.disabledState.get(select);
  if (existing) {
    return;
  }
  state.cascade.disabledState.set(select, {
    prevDisabled: select.disabled,
    prevAriaBusy: select.getAttribute("aria-busy")
  });
  select.disabled = true;
  select.setAttribute("aria-busy", "true");
}

export function enableCascadeSelect(select: HTMLSelectElement, state: RuntimeState): void {
  const existing = state.cascade.disabledState.get(select);
  if (!existing) {
    return;
  }
  state.cascade.disabledState.delete(select);
  select.disabled = existing.prevDisabled;
  if (existing.prevAriaBusy == null) {
    select.removeAttribute("aria-busy");
  } else {
    select.setAttribute("aria-busy", existing.prevAriaBusy);
  }
}

export function resetCascadeSelect(select: HTMLSelectElement, state: RuntimeState): boolean {
  let reset = false;
  const placeholder = Array.from(select.options).find((option) => option.value === "" || option.value == null) ?? null;
  if (placeholder) {
    select.value = placeholder.value ?? "";
    reset = true;
  } else if (select.options.length > 0) {
    select.selectedIndex = 0;
    reset = true;
  }
  if (reset) {
    state.cascade.actionSkip.add(select);
  }
  return reset;
}

export function handleCascadeStoreUpdate(store: string, state: RuntimeState): string[] {
  const selects = state.cascade.storeToSelects.get(store);
  if (!selects) {
    return [];
  }
  const updated: string[] = [];
  for (const select of selects) {
    enableCascadeSelect(select, state);
    const reset = resetCascadeSelect(select, state);
    if (reset) {
      updated.push(select.name || select.id || "");
    }
  }
  return updated;
}
