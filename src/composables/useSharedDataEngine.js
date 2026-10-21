import {
  ref,
  shallowRef,
  markRaw,
  provide,
  inject,
  watch,
  isRef,
  toRef,
  toValue,
  unref,
  onScopeDispose,
  onMounted,
  onBeforeUnmount,
} from "vue";
import { UMAPGeneViewer, preloadDuckDB } from "../libs/dataManager.js";
import { DASHBOARD_GLOBAL_VARS_KEY } from "../useGlobalVars";

const DATA_ENGINE_KEY = Symbol("shared-data-engine");
export const DATASET_CONFIG_KEY = Symbol("dataset-config");

/**
 * Provider: creates ONE UMAPGeneViewer per dataset selection.
 * Call this in App.vue (or the top-level provider component).
 *
 * `dataUrl` is the unsigned base path; signing comes from `getCloudfront`, read on
 * every fetch, so renewed credentials never rebuild the engine.
 *
 * Pass `configLoading` (e.g. useDatasetConfig's `loading`) so the engine waits for
 * the dataset's manifest and takes its embeddings from `config` instead of
 * fetching manifest.json a second time.
 *
 * @param {{ dataUrl: Ref<string|null>, config: Ref<object>, configLoading?: Ref<boolean>, getCloudfront?: () => object|null }} options
 */
export function useSharedDataEngine({ dataUrl, config, configLoading, getCloudfront }) {
  const dataUrlRef = isRef(dataUrl) ? dataUrl : toRef(dataUrl);
  const configRef = isRef(config) ? config : toRef(config);

  const viewer = shallowRef(null);
  const loading = ref(false);
  const error = ref(null);

  // Boot DuckDB while the dataset URL is still being fetched
  preloadDuckDB();

  // Bumped whenever the dataset changes, so a viewer that finishes loading for a
  // dataset that's no longer selected is thrown away instead of shown
  let request = 0;
  let currentUrl; // dataset the current (or loading) viewer is for

  function dropViewer() {
    request++;
    currentUrl = undefined;
    viewer.value?.dispose();
    viewer.value = null;
  }

  function engineConfig() {
    const cfg = configRef.value;
    return {
      getCloudfront,
      // Embeddings and chromatin settings from the manifest, when there is one
      ...(cfg?.embeddings && { embeddings: cfg.embeddings, default_embedding: cfg.default_embedding }),
      ...(cfg?.chromatin && { chromatin: cfg.chromatin }),
    };
  }

  async function createViewer(url) {
    dropViewer();
    currentUrl = url;
    const id = request;
    error.value = null;
    if (!url) {
      loading.value = false;
      return;
    }

    loading.value = true;
    const v = new UMAPGeneViewer(url, engineConfig());
    try {
      await v.initialize();
      if (id !== request) return v.dispose();
      viewer.value = markRaw(v);
    } catch (err) {
      v.dispose();
      if (id !== request) return;
      console.error("Failed to create shared data engine:", err);
      error.value = err.message;
    } finally {
      if (id === request) loading.value = false;
    }
  }

  // Recreate the viewer when the dataset changes. The old one is dropped right away;
  // the new one is built once the dataset's config (manifest) has loaded.
  watch(
    () => [dataUrlRef.value, unref(configLoading) ?? false],
    ([url, waitingForConfig]) => {
      if (url === currentUrl) return;
      if (waitingForConfig) {
        dropViewer();
        loading.value = !!url;
        return;
      }
      createViewer(url);
    },
    { immediate: true }
  );

  onScopeDispose(dropViewer);

  // Provide to descendants
  provide(DATA_ENGINE_KEY, { viewer, loading, error });

  return { viewer, loading, error };
}

/**
 * Getter for the CloudFront credentials the host app passes as `services.cloudfront`.
 * The host passes a ref it keeps renewed (e.g. from useViewerAssets in @pennsieve-viz/core);
 * a plain object would be copied once by the dashboard and go stale. Call during setup.
 */
export function useServicesCloudfront() {
  const globalVars = inject(DASHBOARD_GLOBAL_VARS_KEY, null);
  return () => unref(unref(globalVars?.services)?.cloudfront) ?? null;
}

/**
 * Consumer: inject the dataset config from an ancestor.
 */
export function useDatasetActiveConfig() {
  return inject(DATASET_CONFIG_KEY, ref(null));
}

// Engines for widgets rendered without a provider (a host app that places widgets directly,
// like sparc-app-2): one per data URL, shared by every widget using it, disposed when the
// last of them unmounts. Kept-alive widgets stay mounted, so their engine stays loaded.
const widgetEngines = new Map(); // url → { viewer: Promise<UMAPGeneViewer>, users }

function acquireWidgetEngine(url, config) {
  let entry = widgetEngines.get(url);
  if (!entry) {
    const v = new UMAPGeneViewer(url, config);
    const created = { viewer: v.initialize().then(() => markRaw(v)), users: 0 };
    // A failed load isn't kept, so the next widget tries again
    created.viewer.catch(() => {
      if (widgetEngines.get(url) === created) widgetEngines.delete(url);
    });
    widgetEngines.set(url, created);
    entry = created;
  }
  entry.users++;
  const acquired = entry;
  let released = false;
  return {
    viewer: acquired.viewer,
    release() {
      if (released) return;
      released = true;
      if (--acquired.users > 0) return;
      if (widgetEngines.get(url) === acquired) widgetEngines.delete(url);
      acquired.viewer.then((v) => v.dispose(), () => {});
    },
  };
}

/**
 * The data engine for a widget. Under a provider (useSharedDataEngine, e.g. the demo
 * App.vue) it uses the provider's engine; otherwise it shares one engine per data URL with
 * every other widget on the page. Call during setup. `onReady(viewer)` runs once, after the
 * widget has mounted; `onError(message)` runs if the data can't be loaded.
 *
 * @param {{
 *   dataPath: string | Ref<string|null> | (() => string|null),
 *   config?: object | Ref<object|null> | (() => object|null),
 *   onReady: (viewer: UMAPGeneViewer) => unknown,
 *   onError?: (message: string) => void,
 * }} options
 */
export function useWidgetDataEngine({ dataPath, config, onReady, onError }) {
  const provided = inject(DATA_ENGINE_KEY, null);
  const getCloudfront = useServicesCloudfront();
  const mounted = ref(false);
  let active = true;
  let started = false;
  let release = null;

  function start(viewer) {
    if (!active || started || !viewer) return;
    started = true;
    onReady(viewer);
  }
  function fail(err) {
    if (!active || started) return;
    const message = typeof err === "string" ? err : err?.message ?? String(err);
    console.error("[DataEngine] Widget data failed to load:", message);
    onError?.(message);
  }

  onMounted(() => (mounted.value = true));
  onBeforeUnmount(() => {
    active = false;
    release?.();
  });

  if (provided) {
    watch([provided.viewer, mounted], ([viewer, isMounted]) => isMounted && start(viewer));
    watch(provided.error, (err) => err && fail(err));
  } else {
    watch([() => toValue(dataPath), mounted], ([url, isMounted]) => {
      if (!isMounted || !url || release) return;
      const engine = acquireWidgetEngine(url, { ...(toValue(config) || {}), getCloudfront });
      release = engine.release;
      engine.viewer.then(start, fail);
    }, { immediate: true });
  }
}
