const DEFAULT_MAX_AGE_MS = 45 * 60 * 1000; // 45 minutes
const ASSETS_HOST = "https://assets.pennsieve.io";
const ASSETS_PROXY = "/assets-proxy";

/**
 * Fetch viewer assets for a package from the Pennsieve API.
 * Returns the first ready parquet asset along with CloudFront credentials.
 */
export async function fetchViewerAssets({ api2Url, datasetId, packageId, token }) {
  const url = `${api2Url}/packages/assets?dataset_id=${datasetId}&package_id=${packageId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch viewer assets: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const assets = (data.assets || []).filter(
    (a) => a.asset_type === "parquet" && a.status === "ready"
  );

  if (assets.length === 0) {
    throw new Error("No ready parquet viewer assets found for this package");
  }

  return { assets, cloudfront: data.cloudfront };
}

/**
 * Build a signed data path from a viewer asset response.
 * Strips trailing slash from asset_url and appends CloudFront query params.
 */
export function buildSignedDataPath(response) {
  const asset = response.assets[0];
  const cf = response.cloudfront;

  const basePath = asset.asset_url.replace(ASSETS_HOST, ASSETS_PROXY).replace(/\/+$/, "");
  const queryString = `?Policy=${cf.policy}&Signature=${cf.signature}&Key-Pair-Id=${cf.key_pair_id}`;
  const fullPath = `${basePath}${queryString}`;

  return {
    basePath,
    queryString,
    fullPath,
    assetId: asset.id,
    fetchedAt: Date.now(),
  };
}

/**
 * Refresh CloudFront credentials for an existing asset.
 */
export async function refreshCloudFrontCredentials({ api2Url, datasetId, assetId, token }) {
  const url = `${api2Url}/packages/assets/${assetId}?dataset_id=${datasetId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh credentials: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.cloudfront;
}

/**
 * Build a full signed URL from a base path and CloudFront credentials.
 */
export function buildFullPath(basePath, cloudfront) {
  return `${basePath}?Policy=${cloudfront.policy}&Signature=${cloudfront.signature}&Key-Pair-Id=${cloudfront.key_pair_id}`;
}

/**
 * Check if CloudFront credentials are stale and need refreshing.
 */
export function isCredentialStale(fetchedAt, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  return Date.now() - fetchedAt > maxAgeMs;
}
