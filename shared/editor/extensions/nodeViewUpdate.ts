import { recordEditorPerformanceProbe } from '../performanceInstrumentation';

/** Shallow attrs equality for NodeViews whose persisted attrs are scalar values. */
export function areNodeViewAttributesEqual(
  current: Readonly<Record<string, unknown>>,
  updated: Readonly<Record<string, unknown>>,
): boolean {
  recordEditorPerformanceProbe('node-view-update-props', 1);
  if (current === updated) return true;
  const currentKeys = Object.keys(current);
  const updatedKeys = Object.keys(updated);
  if (currentKeys.length !== updatedKeys.length) return false;
  return currentKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(updated, key)
    && Object.is(current[key], updated[key]));
}
