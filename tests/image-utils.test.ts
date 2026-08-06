import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));

vi.mock('vscode', () => ({}));
vi.mock('node:fs/promises', () => fsMocks);

import { embedImagesAsBase64 } from '../src/utils/imageUtils';
import type { TiptapNode } from '../shared/types';

const imageDocument = (count: number): TiptapNode => ({
  type: 'doc',
  content: Array.from({ length: count }, (_, index) => ({
    type: 'image',
    attrs: { src: `./images/image-${index}.png` },
  })),
});

beforeEach(() => {
  fsMocks.readFile.mockReset().mockResolvedValue(Buffer.from('png'));
  fsMocks.realpath.mockReset().mockImplementation(async (value: string) => value);
  fsMocks.stat.mockReset().mockResolvedValue({ isFile: () => true, size: 3 });
});

describe('image export cancellation', () => {
  it('passes the caller signal to image reads', async () => {
    const controller = new AbortController();

    await embedImagesAsBase64(imageDocument(1), 'C:\\document', controller.signal);

    expect(fsMocks.readFile).toHaveBeenCalledWith(expect.stringContaining('image-0.png'), {
      signal: controller.signal,
    });
  });

  it('does not schedule more assets after cancellation', async () => {
    const controller = new AbortController();
    const firstWaveResolvers: Array<(value: { isFile: () => boolean; size: number }) => void> = [];
    fsMocks.stat.mockImplementation(() => {
      if (fsMocks.stat.mock.calls.length <= 4) {
        return new Promise((resolve) => firstWaveResolvers.push(resolve));
      }
      return Promise.resolve({ isFile: () => true, size: 3 });
    });

    const pending = embedImagesAsBase64(imageDocument(6), 'C:\\document', controller.signal);
    await vi.waitFor(() => expect(fsMocks.stat).toHaveBeenCalledTimes(4));

    controller.abort();
    firstWaveResolvers.forEach((resolve) => resolve({ isFile: () => true, size: 3 }));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fsMocks.stat).toHaveBeenCalledTimes(4);
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });
});
