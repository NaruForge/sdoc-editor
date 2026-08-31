import { describe, expect, it } from 'vitest';
import {
  normalizeDiagramSvgSize,
  resolveDiagramMediaSize,
} from '../shared/editor/diagram/mediaSizing';

describe('diagram media sizing', () => {
  it('replaces a percentage SVG canvas with its intrinsic viewBox dimensions', () => {
    const result = normalizeDiagramSvgSize(
      '<svg width="100%" style="max-width: 220.25px;" viewBox="-8 -8 220.25 480.1"><g/></svg>',
    );

    expect(result).toEqual({
      markup: '<svg width="221" style="max-width: 220.25px;" viewBox="-8 -8 220.25 480.1" height="481"><g/></svg>',
      width: 221,
      height: 481,
    });
  });

  it('uses numeric SVG dimensions when no viewBox is present', () => {
    const result = normalizeDiagramSvgSize(
      "<svg height='180px' width='320'><rect width='320' height='180'/></svg>",
    );

    expect(result).toEqual({
      markup: "<svg height='180' width='320'><rect width='320' height='180'/></svg>",
      width: 320,
      height: 180,
    });
  });

  it('leaves markup unchanged when it has no complete positive intrinsic size', () => {
    expect(normalizeDiagramSvgSize('<svg width="100%"><g/></svg>')).toEqual({
      markup: '<svg width="100%"><g/></svg>',
    });
    expect(normalizeDiagramSvgSize('<div>not svg</div>')).toEqual({
      markup: '<div>not svg</div>',
    });
  });

  it('accepts only complete finite positive media dimensions', () => {
    expect(resolveDiagramMediaSize(320.2, 180.1)).toEqual({ width: 321, height: 181 });
    expect(resolveDiagramMediaSize(320, undefined)).toBeUndefined();
    expect(resolveDiagramMediaSize(0, 180)).toBeUndefined();
    expect(resolveDiagramMediaSize(Number.POSITIVE_INFINITY, 180)).toBeUndefined();
  });
});
