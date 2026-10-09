import { ref, shallowRef, markRaw, provide, inject, watch, isRef, toRef } from "vue";
import { UMAPGeneViewer } from "../libs/dataManager.js";

const DATA_ENGINE_KEY = Symbol("shared-data-engine");
export const DATASET_CONFIG_KEY = Symbol("dataset-config");

/**
 * Provider: creates ONE UMAPGeneViewer per dataset selection.
 * Call this in App.vue (or the top-level provider component).
 *
 * @param {{ dataUrl: Ref<string|null>, config: Ref<object> }} options
 */
export function useSharedDataEngine({ dataUrl, config }) {
  const dataUrlRef = isRef(dataUrl) ? dataUrl : toRef(dataUrl);
  const configRef = isRef(config) ? config : toRef(config);

  const viewer = shallowRef(null);
  const loading = ref(false);
  const error = ref(null);

  async function createViewer(url) {
    if (!url) {
      viewer.value = null;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      const engineConfig = {};

      // Pass embeddings from manifest/config to the data engine
      const cfg = configRef.value;
      if (cfg?.embeddings) {
        engineConfig.embeddings = cfg.embeddings;
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
 * Consumer: inject the dataset config from an ancestor.
 */
export function useDatasetActiveConfig() {
  return inject(DATASET_CONFIG_KEY, ref(null));
}
