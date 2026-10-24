/** Keep workers and downloads valid at a GitHub Pages project URL. */
export function assetUrl(path: string) {
  const base = import.meta.env?.BASE_URL || '/';
  return `${base}${path.replace(/^\/+/, '')}`;
}
