const MAX_LINK_URL_LENGTH = 2_048;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const URI_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export type SafeLinkUrlResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason: 'empty' | 'too-long' | 'control-character' | 'unsafe-scheme' | 'non-portable-path' | 'invalid-url';
    };

/** Normalize and validate a portable link target shared by editor and operation boundaries. */
export function normalizeSafeLinkUrl(value: string): SafeLinkUrlResult {
  const url = value.trim().normalize('NFC');
  if (!url) return { ok: false, reason: 'empty' };
  if (url.length > MAX_LINK_URL_LENGTH) return { ok: false, reason: 'too-long' };
  if (CONTROL_CHARACTERS.test(url)) return { ok: false, reason: 'control-character' };
  if (url.startsWith('#')) {
    return url.length > 1 ? { ok: true, url } : { ok: false, reason: 'invalid-url' };
  }
  if (url.startsWith('//')) return { ok: false, reason: 'unsafe-scheme' };
  if (/^[a-z]:[\\/]/i.test(url) || url.startsWith('/') || url.startsWith('\\\\')) {
    return { ok: false, reason: 'non-portable-path' };
  }

  const scheme = URI_SCHEME.exec(url)?.[1]?.toLowerCase();
  if (!scheme) return { ok: true, url };
  if (!SAFE_SCHEMES.has(scheme)) return { ok: false, reason: 'unsafe-scheme' };
  if (scheme === 'http' || scheme === 'https') {
    try {
      const parsed = new URL(url);
      if (!parsed.hostname) return { ok: false, reason: 'invalid-url' };
    } catch {
      return { ok: false, reason: 'invalid-url' };
    }
  } else if (url.length === scheme.length + 1) {
    return { ok: false, reason: 'invalid-url' };
  }
  return { ok: true, url };
}

export const isSafeLinkUrl = (value: string): boolean => normalizeSafeLinkUrl(value).ok;
