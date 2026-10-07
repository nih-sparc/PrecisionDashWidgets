import { ref, computed, watch, onUnmounted } from "vue";
import {
  fetchViewerAssets,
  buildSignedDataPath,
  refreshCloudFrontCredentials,
  buildFullPath,
  isCredentialStale,
} from "../services/pennsieveViewerAssets.js";

const REFRESH_CHECK_INTERVAL_MS = 60 * 1000; // check every 60s

/**
 * Vue composable for loading viewer assets from Pennsieve via CloudFront.
 *
 * @param {Object} options
 * @param {string} options.api2Url - Pennsieve API v2 base URL
 * @param {string} options.token - Auth token
 * @param {Array<{id: string, label: string, datasetId: string, packageId: string}>} options.datasets
 */
export function useViewerAssets({ api2Url, token, datasets }) {
  const selectedDatasetId = ref(null);
  const loading = ref(false);
  const error = ref(null);

  // Internal state for the current signed path
  const _signedData = ref(null);

  const dataUrl = computed(() => _signedData.value?.fullPath ?? null);

  async function loadDataset(datasetId) {
    const dataset = datasets.find((d) => d.id === datasetId);
    if (!dataset) {
      error.value = `Dataset "${datasetId}" not found`;
      return;
    }

    loading.value = true;
    error.value = null;
    _signedData.value = null;

    try {
      const response = await fetchViewerAssets({
        api2Url,
        datasetId: dataset.datasetId,
        packageId: dataset.packageId,
        token,
      });

      _signedData.value = buildSignedDataPath(response);
    } catch (e) {
      error.value = e.message;
    } finally {
      loading.value = false;
    }
  }

  async function refresh() {
    const signed = _signedData.value;
    if (!signed) return;

    const dataset = datasets.find((d) => d.id === selectedDatasetId.value);
    if (!dataset) return;

    try {
      const cloudfront = await refreshCloudFrontCredentials({
        api2Url,
        datasetId: dataset.datasetId,
        assetId: signed.assetId,
        token,
      });

      _signedData.value = {
        ...signed,
        queryString: `?Policy=${cloudfront.policy}&Signature=${cloudfront.signature}&Key-Pair-Id=${cloudfront.key_pair_id}`,
        fullPath: buildFullPath(signed.basePath, cloudfront),
        fetchedAt: Date.now(),
      };
    } catch (e) {
      console.error("Failed to refresh CloudFront credentials:", e);
      error.value = `Credential refresh failed: ${e.message}`;
    }
  }

  // Watch selectedDatasetId → load
  watch(selectedDatasetId, (id) => {
    if (id) loadDataset(id);
  });

  // Auto-refresh timer
  const timer = setInterval(() => {
    const signed = _signedData.value;
    if (signed && isCredentialStale(signed.fetchedAt)) {
      refresh();
    }
  }, REFRESH_CHECK_INTERVAL_MS);

  onUnmounted(() => clearInterval(timer));

  return {
    selectedDatasetId,
    dataUrl,
    loading,
    error,
    datasets,
    loadDataset,
    refresh,
  };
}
