/**
 * Escape regex metacharacters and regex-literal delimiters from a string.
 */
export function escapeRegExp(value: string): string {
  return value
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\//g, "\\/");
}
