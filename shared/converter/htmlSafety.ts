/** Prevents user CSS from terminating an HTML raw-text style element. */
export const escapeStyleElementText = (value: string): string =>
  value.replace(/<\/style/gi, '<\\/style');
