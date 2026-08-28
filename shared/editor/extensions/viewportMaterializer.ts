export interface ViewportMaterializer {
  readonly materialized: boolean;
  ensure(): void;
  destroy(): void;
}

export interface ViewportMaterializerOptions {
  target: Element;
  materialize: () => void;
  observer?: typeof IntersectionObserver;
  rootMargin?: string;
}

export interface MaterializationTriggers {
  destroy(): void;
}

export function attachMaterializationTriggers(
  focusTarget: EventTarget,
  printTarget: EventTarget | undefined,
  ensure: () => void,
): MaterializationTriggers {
  focusTarget.addEventListener('focusin', ensure);
  printTarget?.addEventListener('beforeprint', ensure);
  return {
    destroy(): void {
      focusTarget.removeEventListener('focusin', ensure);
      printTarget?.removeEventListener('beforeprint', ensure);
    },
  };
}

/** Materialize once near the viewport; unsupported hosts fail safe to eager rendering. */
export function createViewportMaterializer({
  target,
  materialize,
  observer = globalThis.IntersectionObserver,
  rootMargin = '800px 0px',
}: ViewportMaterializerOptions): ViewportMaterializer {
  let materialized = false;
  let intersectionObserver: IntersectionObserver | undefined;
  const ensure = (): void => {
    if (materialized) return;
    materialized = true;
    intersectionObserver?.disconnect();
    intersectionObserver = undefined;
    materialize();
  };

  if (typeof observer === 'function') {
    intersectionObserver = new observer((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) ensure();
    }, { rootMargin, threshold: 0 });
    intersectionObserver.observe(target);
  } else {
    ensure();
  }

  return {
    get materialized() {
      return materialized;
    },
    ensure,
    destroy(): void {
      intersectionObserver?.disconnect();
      intersectionObserver = undefined;
    },
  };
}
