import React from 'react';
import { useEditorI18n } from '../i18n';
import {
  DEFAULT_READING_WIDTH,
  READING_WIDTH_IDS,
  type ReadingWidthId,
} from '../readingWidth';

interface ZoomBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
  readingWidth: ReadingWidthId;
  onReadingWidthChange: (width: ReadingWidthId) => void;
}

const MIN_ZOOM = 60;
const MAX_ZOOM = 200;
const STEP = 5;

const READING_WIDTH_LABEL_KEYS = {
  narrow: 'zoom.readingWidth.narrow',
  comfortable: 'zoom.readingWidth.comfortable',
  wide: 'zoom.readingWidth.wide',
  full: 'zoom.readingWidth.full',
} as const;

export const ZoomBar: React.FC<ZoomBarProps> = ({
  zoom,
  onZoomChange,
  readingWidth,
  onReadingWidthChange,
}) => {
  const { t } = useEditorI18n();
  const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
  const isNonDefault = zoom !== 100 || readingWidth !== DEFAULT_READING_WIDTH;

  return (
    <div className={`editor-zoom-bar${isNonDefault ? ' is-non-default' : ''}`}>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => onZoomChange(clamp(zoom - STEP))}
        aria-label={t('zoom.out')}
        title={t('zoom.outTitle')}
      >
        −
      </button>
      <input
        type="range"
        className="zoom-slider"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={STEP}
        value={zoom}
        onChange={(e) => onZoomChange(parseInt(e.target.value, 10))}
        aria-label={t('zoom.adjust')}
        aria-valuetext={`${zoom}%`}
      />
      <button
        type="button"
        className="zoom-btn"
        onClick={() => onZoomChange(clamp(zoom + STEP))}
        aria-label={t('zoom.in')}
        title={t('zoom.inTitle')}
      >
        +
      </button>
      <button
        type="button"
        className="zoom-label"
        onClick={() => onZoomChange(100)}
        title={t('zoom.resetTitle')}
        aria-label={t('zoom.reset')}
      >
        {zoom}%
      </button>
      <select
        className="zoom-reading-width"
        value={readingWidth}
        onChange={(event) => onReadingWidthChange(event.target.value as ReadingWidthId)}
        aria-label={t('zoom.readingWidth')}
        title={t('zoom.readingWidthTitle')}
      >
        {READING_WIDTH_IDS.map((id) => (
          <option key={id} value={id}>
            {t(READING_WIDTH_LABEL_KEYS[id])}
          </option>
        ))}
      </select>
    </div>
  );
};
