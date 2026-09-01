const SCALE_PROBE_SIZE = 1024;
const SCALE_EPSILON = 0.0001;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Mermaid measures HTML labels in viewport pixels and writes those values back
 * into SVG user units. Keep its temporary render tree outside application
 * content and counter any remaining document-level scale so both coordinate
 * systems stay 1:1 while the graph layout is calculated.
 */
export function createMermaidRenderSurface(ownerDocument: Document): HTMLDivElement {
  const surface = ownerDocument.createElement('div');
  surface.setAttribute('aria-hidden', 'true');
  surface.style.cssText = [
    'all: initial',
    'display: block',
    'position: fixed',
    'left: 0',
    'top: 0',
    `width: ${Math.max(ownerDocument.documentElement.clientWidth, 1)}px`,
    'height: 0',
    'overflow: visible',
    'visibility: hidden',
    'pointer-events: none',
    'transform-origin: 0 0',
    'z-index: -2147483648',
  ].join(';');
  ownerDocument.body.appendChild(surface);

  const probe = ownerDocument.createElement('div');
  probe.style.cssText = [
    'display: block',
    `width: ${SCALE_PROBE_SIZE}px`,
    `height: ${SCALE_PROBE_SIZE}px`,
  ].join(';');
  surface.appendChild(probe);
  const bounds = probe.getBoundingClientRect();
  probe.remove();

  const scaleX = bounds.width / SCALE_PROBE_SIZE;
  const scaleY = bounds.height / SCALE_PROBE_SIZE;
  if (finitePositive(scaleX) && finitePositive(scaleY)
    && (Math.abs(scaleX - 1) > SCALE_EPSILON || Math.abs(scaleY - 1) > SCALE_EPSILON)) {
    surface.style.transform = `scale(${1 / scaleX}, ${1 / scaleY})`;
  }

  return surface;
}
