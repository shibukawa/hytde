import type { ParsedExpression } from "./index.js";

export function parseExpression(expression: string): ParsedExpression | null {
  const parts = expression.split("|>").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const [selector, ...transforms] = parts;
  return { selector, transforms };
}
