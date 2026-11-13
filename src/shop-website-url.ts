/** Lexical saved-origin contract only; the host supplies tenant/source authority. */
export function isShopWebsiteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.search && !url.hash && url.pathname === '/' &&
      (value === url.origin || value === `${url.origin}/`);
  } catch { return false; }
}
