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
 * Build a caption label string: "prefix numbering caption"
 * - If prefix is non-empty, format is: "prefix<numbering> <caption>"
 *   (prefix already includes trailing space/punctuation as the user desires)
 * - If prefix is empty, format is: "<numbering> <caption>"
 * - If caption is empty, omit the trailing caption part
 */
export function formatCaptionLabel(prefix: string, numbering: string, caption?: string): string {
  const num = prefix ? `${prefix}${numbering}` : numbering;
  return caption ? `${num} ${caption}` : num;
}
