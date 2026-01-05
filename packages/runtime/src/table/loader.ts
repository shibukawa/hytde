export async function ensureExtableCore(scope: typeof globalThis): Promise<void> {
  const holder = scope as typeof globalThis & { ExtableCore?: unknown };
  if (typeof holder.ExtableCore === "function") {
    return;
  }
  await import("./extable-core");
}
