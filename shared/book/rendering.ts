/** Extracts the replaceable contents from a complete, host-generated book page. */
export function extractBookRootBody(html: string): string {
  const match = html.match(/<div\s+id="book-root"[^>]*>([\s\S]*?)<\/div>\s*<script\b/);
  if (!match) throw new Error('Unable to render the book state.');
  return match[1];
}
