import { ref, onActivated, onDeactivated } from "vue";

/**
 * Keeps widgets cached by <KeepAlive> from re-rendering while hidden.
 *
 * - `runWhenActive(fn)` runs fn now, or once on reactivation if the widget is cached.
 *   Pass zero-arg functions; repeated calls while hidden collapse into one.
 * - `observeResize(el, fn)` is a ResizeObserver that ignores the 0x0 size of a
 *   detached (cached) widget and the same-size resize when it is shown again.
 *
 * Outside KeepAlive the hooks never fire, so everything runs as before.
 */
export function useKeepAliveGate() {
  const isActive = ref(true);
  const pending = new Set();

  onDeactivated(() => {
    isActive.value = false;
  });

  onActivated(() => {
    isActive.value = true;
    const fns = [...pending];
    pending.clear();
    fns.forEach((fn) => fn());
  });

  function runWhenActive(fn) {
    if (isActive.value) return fn();
    pending.add(fn);
  }

  function observeResize(el, fn) {
    let lastWidth = null;
    let lastHeight = null;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!isActive.value || width === 0 || height === 0) return;
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      fn();
    });
    observer.observe(el);
    return observer;
  }

  return { isActive, runWhenActive, observeResize };
}
