export function stripQueryHash(path: string): string {
  const hashIndex = path.indexOf("#");
  const queryIndex = path.indexOf("?");
  const end = Math.min(
    hashIndex === -1 ? path.length : hashIndex,
    queryIndex === -1 ? path.length : queryIndex
  );
  return path.slice(0, end);
}

export function normalizePathPattern(path: string): string {
  if (path === "*") {
    return "*";
  }
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function isRelativePath(path: string): boolean {
  return !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path);
}
