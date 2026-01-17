import type { TemplateToken } from "./index.js";

export function parseTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let buffer = "";
  let cursor = 0;

  const pushBuffer = (): void => {
    if (buffer.length > 0) {
      tokens.push({ type: "text", value: buffer });
      buffer = "";
    }
  };

  while (cursor < template.length) {
    const char = template[cursor];
    const next = template[cursor + 1];

    if (char === "{" && next === "{") {
      buffer += "{";
      cursor += 2;
      continue;
    }

    if (char === "}" && next === "}") {
      buffer += "}";
      cursor += 2;
      continue;
    }

    if (char === "{") {
      const end = template.indexOf("}", cursor + 1);
      if (end === -1) {
        buffer += template.slice(cursor);
        break;
      }
      pushBuffer();
      const token = template.slice(cursor + 1, end).trim();
      tokens.push({ type: "token", value: token });
      cursor = end + 1;
      continue;
    }

    buffer += char;
    cursor += 1;
  }

  pushBuffer();
  return tokens;
}
