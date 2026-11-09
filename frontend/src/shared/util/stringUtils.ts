/** Fills `{name}` placeholders; a function replacement keeps `$` in a value literal. */
export const fillTemplate = (template: string, values: Record<string, string>) =>
  template.replaceAll(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);

export function capitalizeFirstLetter(str: string) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
