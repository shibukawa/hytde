export function parseSearchParams(search: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function parseHashParams(hash: string): Record<string, string> {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function parseParams(search: string, hash: string): Record<string, string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const result: Record<string, string> = {};

  params.forEach((value, key) => {
    result[key] = value;
  });
  hashParams.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}
