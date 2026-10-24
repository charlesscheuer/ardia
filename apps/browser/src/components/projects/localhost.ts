const localOrigin = /^(https?):\/\/(?:[^@/?#\s]*@)?(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(?=[/?#]|$)/i;

export function localPortOf(url: string | null | undefined): number | null {
  const match = url ? localOrigin.exec(url.trim()) : null;
  if (!match) return null;
  if (match[3] == null) return match[1]?.toLowerCase() === "https" ? 443 : 80;
  const port = Number(match[3]);
  return port > 0 && port < 65536 ? port : null;
}
