import { ref, shallowRef, markRaw, provide, inject, watch, isRef, toRef, unref, onScopeDispose } from "vue";
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
 * Consumer: inject the shared UMAPGeneViewer from an ancestor.
 * Call this in lib components instead of `new UMAPGeneViewer()`.
 */
export function useDataEngine() {
  const engine = inject(DATA_ENGINE_KEY, null);
  if (!engine) {
    console.warn(
      "useDataEngine() called without a provider. " +
      "Make sure useSharedDataEngine() is called in an ancestor component."
    );
    return { viewer: ref(null), loading: ref(false), error: ref("No data engine provider") };
  }
  return engine;
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
