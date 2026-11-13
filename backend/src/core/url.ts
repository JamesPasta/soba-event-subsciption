export const withoutTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
};

/** Join a base URL and a path segment with exactly one slash, tolerating stray slashes on either side. */
export function joinUrl(base: string, segment: string): string {
  return `${withoutTrailingSlashes(base)}/${segment.replace(/^\/+/, '')}`;
}

export function withoutQuery(url: string): string {
  const index = url.indexOf('?');
  return index < 0 ? url : url.slice(0, index);
}
