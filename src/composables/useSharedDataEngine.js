import { ref, shallowRef, markRaw, provide, inject, watch, isRef, toRef, unref } from "vue";
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
 * @param {{ dataUrl: Ref<string|null>, config: Ref<object>, getCloudfront?: () => object|null }} options
 */
export function useSharedDataEngine({ dataUrl, config, getCloudfront }) {
  const dataUrlRef = isRef(dataUrl) ? dataUrl : toRef(dataUrl);
  const configRef = isRef(config) ? config : toRef(config);

  const viewer = shallowRef(null);
  const loading = ref(false);
  const error = ref(null);

  // Boot DuckDB while the dataset URL is still being fetched
  preloadDuckDB();

  async function createViewer(url) {
    if (!url) {
      viewer.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const engineConfig = { getCloudfront };

      // Pass embeddings from manifest/config to the data engine
      const cfg = configRef.value;
      if (cfg?.embeddings) {
        engineConfig.embeddings = cfg.embeddings;
        engineConfig.default_embedding = cfg.default_embedding;
      }
      if (cfg?.chromatin) {
        engineConfig.chromatin = cfg.chromatin;
      }

      const v = new UMAPGeneViewer(url, engineConfig);
      await v.initialize();
      viewer.value = markRaw(v);
    } catch (err) {
      console.error("Failed to create shared data engine:", err);
      error.value = err.message;
      viewer.value = null;
    } finally {
      loading.value = false;
    }
  }

  // Recreate viewer when dataUrl changes
  watch(dataUrlRef, (url) => createViewer(url), { immediate: true });

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
