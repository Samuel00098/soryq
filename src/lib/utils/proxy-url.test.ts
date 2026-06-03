import { describe, it, expect } from 'vitest';
import { extractExternalUrlFromProxyUrl } from './proxy-url';

describe('extractExternalUrlFromProxyUrl', () => {
  it('extracts from structured proxy URL with https scheme', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy/https/example.com/page?q=hello'
      )
    ).toBe('https://example.com/page?q=hello');
  });

  it('extracts from structured proxy URL with http scheme', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy/http/example.com/'
      )
    ).toBe('http://example.com/');
  });

  it('extracts from structured proxy URL with no path', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy/https/google.com'
      )
    ).toBe('https://google.com');
  });

  it('extracts deep path', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy/https/stackoverflow.com/questions/123?tab=active'
      )
    ).toBe('https://stackoverflow.com/questions/123?tab=active');
  });

  it('extracts from fallback query-param proxy URL', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy?url=https%3A%2F%2Fexample.com%2Fpath'
      )
    ).toBe('https://example.com/path');
  });

  it('returns null for proxy URL with no url param', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy'
      )
    ).toBeNull();
  });

  it('returns null for non-proxy URL', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/something-else'
      )
    ).toBeNull();
  });

  it('returns null for local dev direct URL', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:5173/about'
      )
    ).toBeNull();
  });

  it('returns null for invalid href', () => {
    expect(extractExternalUrlFromProxyUrl('')).toBeNull();
    expect(extractExternalUrlFromProxyUrl('not-a-url')).toBeNull();
  });

  it('handles href with no search params', () => {
    expect(
      extractExternalUrlFromProxyUrl(
        'http://127.0.0.1:37845/proxy/https/example.com/about'
      )
    ).toBe('https://example.com/about');
  });
});
