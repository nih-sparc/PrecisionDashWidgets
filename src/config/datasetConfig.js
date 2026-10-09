/**
 * Per-dataset frontend presentation config.
 * Keys match the dataset `id` from the DATASETS array in App.vue.
 */
export const DATASET_CONFIGS = {
  "parquet-passthrough": {
    label: "Human DRG (Parquet)",
    hiddenColumns: ["donor_id", "cell_barcode"],
    defaultColorBy: "Atlas_annotation",
    defaultGenes: {
      gene1: "CDH9",
      gene2: "TAC1",
      geneX: "CDH9",
      sideBySide: "CDH9",
    },
    externalLink: {
      column: "Atlas_annotation",
      urlTemplate:
        "https://nervosensus.netlify.app/?view=cards&atlasannotation={value}",
      label: "View in Nervosensus",
    },
  },
  "seurat-package": {
    label: "Human DRG (Seurat Processed)",
    hiddenColumns: ["donor_id"],
    defaultColorBy: "final_cluster_ids",
    defaultGenes: {
      gene1: "SCN10A",
      gene2: "TRPV1",
      geneX: "SCN10A",
      sideBySide: "SCN10A",
    },
    externalLink: null,
  },
};

const DEFAULT_CONFIG = {
  label: "Unknown Dataset",
  hiddenColumns: [],
  defaultColorBy: null,
  defaultGenes: { gene1: null, gene2: null, geneX: null, sideBySide: null },
  externalLink: null,
};

/** Get the frontend config for a dataset, with sensible defaults. */
export function getDatasetConfig(datasetId) {
  return { ...DEFAULT_CONFIG, ...(DATASET_CONFIGS[datasetId] || {}) };
}

/**
 * Build a Set of all coordinate column names from a manifest's embeddings.
 * Falls back to the standard umap/tsne columns if no manifest.
 */
export function getCoordinateColumns(manifest) {
  const coords = new Set(["cell_id"]);

  if (manifest?.embeddings?.length) {
    for (const emb of manifest.embeddings) {
      if (emb.columns) {
        emb.columns.forEach((c) => coords.add(c));
      }
    }
  } else {
    // Fallback: default umap + tsne columns
    ["umap_1", "umap_2", "tsne_1", "tsne_2"].forEach((c) => coords.add(c));
  }

  return coords;
}

/**
 * Filter a sample row's keys down to user-facing metadata columns.
 * Strips coordinate columns and hiddenColumns.
 */
export function getMetadataColumns(sampleRow, config, manifest = null) {
  const coordCols = getCoordinateColumns(manifest);
  const hidden = new Set(
    (config?.hiddenColumns || []).map((c) => c.toLowerCase())
  );

  return Object.keys(sampleRow).filter((key) => {
    if (coordCols.has(key)) return false;
    if (hidden.has(key.toLowerCase())) return false;
    return true;
  });
}

// Columns with more distinct values than this are treated as continuous / per-cell
// (e.g. nCount_RNA, barcodes) and left out of category dropdowns
export const DEFAULT_MAX_CATEGORIES = 100;

/**
 * Narrow metadata columns to ones usable as categories (x-axis, color-by, grouping).
 * A column qualifies if it has at most `config.maxCategories` distinct values, or is
 * listed in `config.categoricalColumns`. Scans rows once, dropping a column as soon
 * as it exceeds the limit.
 */
export function getCategoricalColumns(rows, columns, config) {
  const max = config?.maxCategories ?? DEFAULT_MAX_CATEGORIES;
  const forced = new Set(
    (config?.categoricalColumns || []).map((c) => c.toLowerCase())
  );

  const candidates = columns.filter((c) => !forced.has(c.toLowerCase()));
  const seen = new Map(candidates.map((c) => [c, new Set()]));
  const tooMany = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const col of seen.keys()) {
      const values = seen.get(col);
      values.add(row[col]);
      if (values.size > max) {
        tooMany.add(col);
        seen.delete(col);
      }
    }
    if (seen.size === 0) break;
  }

  return columns.filter((c) => !tooMany.has(c));
}

/**
 * Generate an external link URL for a given column/value, or null.
 */
export function getExternalLink(config, columnName, value) {
  if (!config?.externalLink) return null;
  const { column, urlTemplate } = config.externalLink;
  if (columnName.toLowerCase() !== column.toLowerCase()) return null;
  return urlTemplate.replace("{value}", encodeURIComponent(value));
}
