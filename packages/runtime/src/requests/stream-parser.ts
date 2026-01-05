export function parseJsonLines(buffer: string): { items: unknown[]; rest: string } {
  const items: unknown[] = [];
  let rest = buffer;
  while (true) {
    const newline = rest.indexOf("\n");
    if (newline === -1) {
      break;
    }
    const line = rest.slice(0, newline).trim();
    rest = rest.slice(newline + 1);
    if (!line) {
      continue;
    }
    try {
      items.push(JSON.parse(line));
    } catch (error) {
      rest = `${line}\n${rest}`;
      break;
    }
  }
  return { items, rest };
}
