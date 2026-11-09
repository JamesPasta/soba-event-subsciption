/** Hand a file to the browser to save under the given name. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking in the same task can cancel the download before it starts (Safari).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
