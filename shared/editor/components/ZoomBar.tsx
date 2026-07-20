import React from 'react';

interface ZoomBarProps {
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

const MIN_ZOOM = 60;
const MAX_ZOOM = 200;
const STEP = 5;

export const ZoomBar: React.FC<ZoomBarProps> = ({ zoom, onZoomChange }) => {
  const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

  return (
    <div className="editor-zoom-bar">
      <button
        className="zoom-btn"
        onClick={() => onZoomChange(clamp(zoom - STEP))}
        aria-label="축소"
        title="축소 (−5%)"
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
        aria-label="배율 조절"
      />
      <button
        className="zoom-btn"
        onClick={() => onZoomChange(clamp(zoom + STEP))}
        aria-label="확대"
        title="확대 (+5%)"
      >
        +
      </button>
      <button
        className="zoom-label"
        onClick={() => onZoomChange(100)}
        title="100%로 초기화"
        aria-label="배율 초기화"
      >
        {zoom}%
      </button>
    </div>
  );
};
