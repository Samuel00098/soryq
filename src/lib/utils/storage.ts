export function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadBoolean(key: string, fallback = false): boolean {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === 'true';
}
