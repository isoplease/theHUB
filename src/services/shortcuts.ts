export const MAX_SHORTCUT_URL_LENGTH = 2_048;

export interface NormalizedShortcutUrl {
  readonly url: string;
  readonly name: string;
}

export function normalizeShortcutUrl(value: string): NormalizedShortcutUrl | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SHORTCUT_URL_LENGTH) return null;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return {
      url: parsed.toString(),
      name: parsed.hostname.replace(/^www\./i, '') || parsed.hostname,
    };
  } catch {
    return null;
  }
}
