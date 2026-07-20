export type BookWebviewMessage =
  | { type: 'openDocument'; index: number }
  | { type: 'addDocument' }
  | { type: 'removeDocument'; index: number }
  | { type: 'moveDocument'; from: number; to: number }
  | { type: 'updateMeta'; key: 'title' | 'author' | 'version'; value: string }
  | { type: 'exportProject'; format: 'html' | 'pdf' }
  | { type: 'refreshBook' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIndex = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

export function isBookWebviewMessage(value: unknown): value is BookWebviewMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'openDocument':
    case 'removeDocument':
      return isIndex(value.index);
    case 'moveDocument':
      return isIndex(value.from) && isIndex(value.to);
    case 'updateMeta':
      return ['title', 'author', 'version'].includes(String(value.key)) && typeof value.value === 'string';
    case 'exportProject':
      return value.format === 'html' || value.format === 'pdf';
    case 'addDocument':
    case 'refreshBook':
      return true;
    default:
      return false;
  }
}

