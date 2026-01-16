import type { ParsedRequestTarget } from "../types.js";

export function cleanupRequestTargets(targets: ParsedRequestTarget[]): void {
  for (const target of targets) {
    cleanupRequestTarget(target);
  }
}

export function cleanupRequestTarget(target: ParsedRequestTarget): void {
  const element = target.element;
  element.removeAttribute("hy-get");
  element.removeAttribute("hy-post");
  element.removeAttribute("hy-put");
  element.removeAttribute("hy-patch");
  element.removeAttribute("hy-delete");
  element.removeAttribute("hy-get-stream");
  element.removeAttribute("hy-sse");
  element.removeAttribute("hy-get-polling");
  element.removeAttribute("hy-store");
  element.removeAttribute("hy-unwrap");
  element.removeAttribute("hy-stream-initial");
  element.removeAttribute("hy-stream-timeout");
  element.removeAttribute("hy-stream-key");
  element.removeAttribute("stream-initial");
  element.removeAttribute("stream-timeout");
  element.removeAttribute("stream-key");
  element.removeAttribute("interval");
}
