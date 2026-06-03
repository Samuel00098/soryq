/**
 * Extract the real external URL from the preview proxy URL format.
 *
 * Proxy URL (structured):  http://127.0.0.1:<port>/proxy/<scheme>/<authority><path><search>
 * Proxy URL (fallback):    http://127.0.0.1:<port>/proxy?url=<encoded_url>
 *
 * Returns null if the URL isn't a proxy URL or can't be parsed.
 */
export function extractExternalUrlFromProxyUrl(href: string): string | null {
  try {
    const parsed = new URL(href);
    // Match the structured proxy path: /proxy/<scheme>/<authority>/...
    const proxyPathMatch = parsed.pathname.match(/^\/proxy\/(https?)\/([^/]+)(\/.*)?$/);
    if (proxyPathMatch) {
      const scheme = proxyPathMatch[1];
      const authority = proxyPathMatch[2];
      const restPath = proxyPathMatch[3] || '';
      const search = parsed.search || '';
      return `${scheme}://${authority}${restPath}${search}`;
    }
    // Fallback: check for ?url= query parameter
    if (parsed.pathname === '/proxy' && parsed.searchParams.has('url')) {
      return parsed.searchParams.get('url');
    }
    return null;
  } catch {
    return null;
  }
}
