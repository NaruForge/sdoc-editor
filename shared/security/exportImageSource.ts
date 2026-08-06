import { MAX_ASSET_BYTES } from '../resourceLimits';

const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml|bmp|x-icon));base64,([A-Za-z0-9+/=\s]+)$/i;

export function normalizeEmbeddedImageDataUrl(value: string): string | undefined {
  const match = IMAGE_DATA_URL.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 + 4) return undefined;
  const payload = match[2].replace(/\s/g, '');
  if (payload.length % 4 !== 0) return undefined;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  if ((payload.length / 4) * 3 - padding > MAX_ASSET_BYTES) return undefined;
  return `data:${match[1].toLowerCase()};base64,${payload}`;
}

export function normalizeHttpImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}
