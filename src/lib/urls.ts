/** Links funcionam tanto na raiz quanto no subdiretório do GitHub Pages. */
export function url(path = ''): string {
  if (/^(https?:|mailto:|tel:|#)/i.test(path)) return path;
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}
