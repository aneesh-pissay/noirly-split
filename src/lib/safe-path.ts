/**
 * `value` if it is a path on this site, otherwise `fallback`.
 *
 * Used for "where to go after sign-in" values that arrive in the URL. A plain
 * `startsWith("/")` check is not enough: browsers drop tabs and newlines and
 * read `\` as `/`, so "/<tab>/evil.example" looks local but leaves the site.
 * Resolving it the way a browser would, and requiring the origin to stay put,
 * closes every such trick.
 */
export function safeLocalPath(value: string | null | undefined, fallback: string): string {
  if (!value || !value.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  const base = "https://noirly.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
