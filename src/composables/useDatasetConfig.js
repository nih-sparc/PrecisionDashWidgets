import { ref, computed, watch, toRef, isRef } from "vue";
import { buildSignedUrl } from "@pennsieve-viz/core";
import { getDatasetConfig } from "../config/datasetConfig.js";

/**
 * Fetches manifest.json from the data URL and merges it with
 * the frontend dataset config to produce a reactive activeConfig.
 *
 * `dataUrl` is the unsigned base path; the manifest request is signed with
 * `getCloudfront()` when given.
 *
 * @param {{ dataUrl: Ref<string|null>, datasetId: Ref<string|null>, getCloudfront?: () => object|null }} options
 */
export function useDatasetConfig({ dataUrl, datasetId, getCloudfront }) {
  const dataUrlRef = isRef(dataUrl) ? dataUrl : toRef(dataUrl);
  const datasetIdRef = isRef(datasetId) ? datasetId : toRef(datasetId);

  const manifest = ref(null);
  const loading = ref(false);
  const error = ref(null);

  const frontendConfig = computed(() => getDatasetConfig(datasetIdRef.value));

  const activeConfig = computed(() => {
    const fc = frontendConfig.value;
    const m = manifest.value;

    return {
      // Frontend config fields
      hiddenColumns: fc.hiddenColumns,
      defaultColorBy: fc.defaultColorBy,
      defaultGenes: fc.defaultGenes,
      externalLink: fc.externalLink,
      label: fc.label,

      // Manifest fields (if available)
      embeddings: m?.embeddings || null,
      cellTypeColumn: m?.cell_type_column || "cell_type",
      assays: m?.assays || null,

      // Convenience: merged embedding list for the data engine
      ...(m || {}),
      ...fc,
    };
  });

  // Bumped per dataset change, so a slow manifest for a previous dataset is ignored
  let request = 0;

  async function fetchManifest(url) {
    const id = ++request;
    manifest.value = null;
    if (!url) {
      loading.value = false;
      return;
    }

    loading.value = true;
    error.value = null;

    try {
      // Build manifest URL using the same signed-path pattern
      const qIndex = url.indexOf("?");
      let manifestUrl;
      if (qIndex === -1) {
        manifestUrl = `${url}/manifest.json`;
      } else {
        const base = url.substring(0, qIndex);
        const qs = url.substring(qIndex);
        manifestUrl = `${base}/manifest.json${qs}`;
      }

      const response = await fetch(buildSignedUrl(manifestUrl, getCloudfront?.()));
      if (id !== request) return;
      if (!response.ok) {
        console.log("manifest.json not available, using frontend config only");
        return;
      }

      const json = await response.json();
      if (id === request) manifest.value = json;
    } catch (err) {
      if (id === request) {
        console.log("manifest.json fetch failed, using frontend config only:", err.message);
      }
    } finally {
      if (id === request) loading.value = false;
    }
  }

  // Re-fetch manifest when dataUrl changes
  watch(dataUrlRef, fetchManifest, { immediate: true });

  return {
    manifest,
    frontendConfig,
    activeConfig,
    loading,
    error,
  };
}
