export { toRoman } from '../settingsResolver';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format an ISO date string (e.g. "2026-04-13T01:16:20.722Z") to "YYYY-MM-DD".
 * Returns the original string if parsing fails.
 */
export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Build a caption label string: "prefix numbering separator caption"
 * - If prefix is non-empty: "prefix<numbering><separator><caption>"
 *   (prefix already includes trailing space/punctuation as the user desires)
 * - If prefix is empty: "<numbering><separator><caption>"
 * - separator defaults to ' ' (single space) if not specified
 * - If caption is empty, omit the trailing separator+caption part
 *
 * Examples:
 *   formatCaptionLabel('Fig. ', '1', 'Photo', '. ')  → "Fig. 1. Photo"
 *   formatCaptionLabel('Figure ', '1', 'Photo', ': ') → "Figure 1: Photo"
 *   formatCaptionLabel('', '1', 'Photo')               → "1 Photo"
 */
export function formatCaptionLabel(prefix: string, numbering: string, caption?: string, separator = ' '): string {
  const num = prefix ? `${prefix}${numbering}` : numbering;
  return caption ? `${num}${separator}${caption}` : num;
}
