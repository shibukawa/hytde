import type { ParsedRequestTarget } from "../types.js";
import type { RuntimeState } from "../state.js";
import { emitLog } from "../utils/logging.js";
import { handleRequest } from "../requests/runtime.js";

export function setupFormHandlers(state: RuntimeState): void {
  const formTargets = new Map<HTMLFormElement, ParsedRequestTarget>();
  const submitterTargets = new Map<Element, ParsedRequestTarget>();
  const submitterForms = new Set<HTMLFormElement>();

  for (const target of state.parsed.requestTargets) {
    if (target.trigger !== "submit" || !target.form) {
      continue;
    }
    if (target.isForm) {
      formTargets.set(target.form, target);
    } else {
      submitterTargets.set(target.element, target);
      submitterForms.add(target.form);
    }
  }

  state.formTargets = formTargets;
  state.submitterTargets = submitterTargets;

  const forms = new Set<HTMLFormElement>([...formTargets.keys(), ...submitterForms]);
  for (const form of forms) {
    if (state.formListeners.has(form)) {
      continue;
    }
    state.formListeners.add(form);
    form.addEventListener("submit", (event) => {
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (state.inFlightForms.has(form)) {
        emitLog(state, {
          type: "info",
          message: "submit:skip",
          detail: { reason: "in-flight", formId: form.id || undefined },
          timestamp: Date.now()
        });
        return;
      }
      const submitter = (event as SubmitEvent).submitter ?? null;
      const submitTarget = submitter ? submitterTargets.get(submitter) : null;
      const resolved = submitTarget ?? formTargets.get(form) ?? null;
      if (!resolved) {
        return;
      }
      event.preventDefault();
      void handleRequest(resolved, state);
    });
  }
}
