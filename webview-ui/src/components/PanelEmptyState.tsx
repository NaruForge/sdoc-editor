import React from 'react';

interface PanelEmptyStateProps {
  title: string;
  message: string;
  hint?: string;
  icon?: React.ReactNode;
}

/** Shared empty-state block for side panels (TOC / LOF / LOT / File). */
export const PanelEmptyState: React.FC<PanelEmptyStateProps> = ({ title, message, hint, icon }) => (
  <div className="panel-empty">
    {icon && <div className="panel-empty-icon">{icon}</div>}
    <div className="panel-empty-title">{title}</div>
    <div className="panel-empty-message">{message}</div>
    {hint && <div className="panel-empty-hint">{hint}</div>}
  </div>
);
