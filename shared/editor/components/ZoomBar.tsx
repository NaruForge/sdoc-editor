import React from 'react';
import { useEditorI18n } from '../i18n';

interface ZoomBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

const MIN_ZOOM = 60;
const MAX_ZOOM = 200;
const STEP = 5;

export const ZoomBar: React.FC<ZoomBarProps> = ({ zoom, onZoomChange }) => {
  const { t } = useEditorI18n();
  const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

  return (
    <div className={`editor-zoom-bar${zoom !== 100 ? ' is-non-default' : ''}`}>
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
    </div>
  );
};
