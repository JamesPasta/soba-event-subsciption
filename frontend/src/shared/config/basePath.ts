/**
 * Path the app is served under, e.g. `/designer`, or '' at the root. next.config.ts sets it from
 * BASE_PATH. Next adds it to router navigation and `_next` assets only; URLs built by hand need it
 * from here.
 */
export function getBasePath(): string {
  // Literal access: Next only inlines NEXT_PUBLIC_ values it can see statically.
  return process.env.NEXT_PUBLIC_BASE_PATH ?? '';
}

export function withBasePath(path: string): string {
  return `${getBasePath()}${path}`;
}
