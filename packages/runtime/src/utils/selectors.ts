export function parseSelectorTokens(selector: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return tokens;
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        break;
      }
      tokens.push(ident);
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        const raw = selector.slice(cursor, end === -1 ? length : end).trim();
        const num = Number(raw);
        tokens.push(Number.isNaN(num) ? raw : num);
        cursor = end === -1 ? length : end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        cursor += 1;
      }
      cursor += 1;
      continue;
    }

    break;
  }

  return tokens;
}

export function parseSelectorTokensStrict(
  selector: string
): { tokens: Array<string | number>; error: string | null } {
  const tokens: Array<string | number> = [];
  if (!selector) {
    return { tokens, error: "Selector is empty." };
  }
  let cursor = 0;
  const length = selector.length;

  const readIdentifier = (): string | null => {
    const match = selector.slice(cursor).match(/^([A-Za-z_$][\w$]*)/);
    if (!match) {
      return null;
    }
    cursor += match[1].length;
    return match[1];
  };

  const first = readIdentifier();
  if (!first) {
    return { tokens, error: "Selector must start with an identifier." };
  }
  tokens.push(first);

  while (cursor < length) {
    const char = selector[cursor];
    if (char === ".") {
      cursor += 1;
      const ident = readIdentifier();
      if (!ident) {
        return { tokens, error: "Selector dot segment must be an identifier." };
      }
      tokens.push(ident);
      continue;
    }

    if (char === "[") {
      cursor += 1;
      while (selector[cursor] === " ") {
        cursor += 1;
      }
      const quote = selector[cursor];
      if (quote === "'" || quote === "\"") {
        cursor += 1;
        let value = "";
        while (cursor < length) {
          if (selector[cursor] === "\\" && cursor + 1 < length) {
            value += selector[cursor + 1];
            cursor += 2;
            continue;
          }
          if (selector[cursor] === quote) {
            break;
          }
          value += selector[cursor];
          cursor += 1;
        }
        if (cursor >= length) {
          return { tokens, error: "Selector has unterminated string literal." };
        }
        cursor += 1;
        tokens.push(value);
      } else {
        const end = selector.indexOf("]", cursor);
        if (end === -1) {
          return { tokens, error: "Selector has unterminated bracket." };
        }
        const raw = selector.slice(cursor, end).trim();
        if (!raw) {
          return { tokens, error: "Selector has empty bracket segment." };
        }
        const num = Number(raw);
        if (!Number.isNaN(num)) {
          tokens.push(num);
        } else if (isValidIdentifier(raw)) {
          tokens.push(raw);
        } else {
          return { tokens, error: "Selector bracket segment must be a number or identifier." };
        }
        cursor = end;
      }

      while (cursor < length && selector[cursor] !== "]") {
        if (selector[cursor] !== " ") {
          return { tokens, error: "Selector has invalid bracket syntax." };
        }
        cursor += 1;
      }
      if (selector[cursor] !== "]") {
        return { tokens, error: "Selector has unterminated bracket." };
      }
      cursor += 1;
      continue;
    }

    return { tokens, error: "Selector contains invalid character." };
  }

  return { tokens, error: null };
}

function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
