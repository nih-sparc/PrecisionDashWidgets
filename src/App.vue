<script setup lang="ts">
import { ref, computed, markRaw, provide } from "vue";

import { MultiDashboard } from "../../PennsieveDashboard/src/components/index";
import {
  GeneExpression,
  SideBySide,
  GeneXDistribution,
  ProportionPlot,
  ChromatinAccessibility,
  LinkedPeaks,
} from "./components/index";
import { useViewerAssets } from "@pennsieve-viz/core";
import { useDatasetConfig } from "./composables/useDatasetConfig.js";
import { useSharedDataEngine, DATASET_CONFIG_KEY } from "./composables/useSharedDataEngine.js";

const RawGeneExpression = markRaw(GeneExpression);
const RawSideBySide = markRaw(SideBySide);
const RawGeneXDistribution = markRaw(GeneXDistribution);
const RawProportionPlot = markRaw(ProportionPlot);
const RawChromatinAccessibility = markRaw(ChromatinAccessibility);
const RawLinkedPeaks = markRaw(LinkedPeaks);

// --- Pennsieve config ---
// Published datasets only: assets come from the public discover endpoint, no token.
// Defaults to the dev environment; set VITE_API2_URL=https://api2.pennsieve.io for prod data.
const API2_URL = import.meta.env.VITE_API2_URL || "https://api2.pennsieve.net";

const DATASETS = [
  {
    id: "human-drg-atlas",
    label: "Human DRG Atlas",
    packageId: "N:package:576bee78-58de-4b56-8da4-101c6b97ed61",
  },
  {
    id: "human-drg-multiome",
    label: "Human DRG Multiome ATAC + RNA-seq",
    // Published + processed on dev (seurat-processor, multiome with chromatin + links)
    packageId: "N:package:3376584f-3c00-4945-8c04-05cb5996448a",
  },
];

// --- Viewer assets (shared composable from @pennsieve-viz/core; keeps CloudFront creds renewed) ---
const datasets = DATASETS;
const selectedDatasetId = ref<string | null>(null);
const selectedPackageId = computed(
  () => datasets.find((d) => d.id === selectedDatasetId.value)?.packageId ?? null
);

const { assets, cloudfront, loading, error } = useViewerAssets({
  api2Url: API2_URL,
  packageId: selectedPackageId,
  assetTypes: ["parquet"],
});

// Unsigned base path; requests are signed from `cloudfront` at fetch time, so a
// credential renewal doesn't rebuild the engine or refetch the manifest
const dataUrl = computed(() => assets.value[0]?.asset_url.replace(/\/+$/, "") ?? null);
const getCloudfront = () => cloudfront.value;

// --- Dataset config composable (fetches manifest + merges with frontend config) ---
const {
  activeConfig,
  loading: configLoading,
} = useDatasetConfig({
  dataUrl,
  datasetId: selectedDatasetId,
  getCloudfront,
});

// --- Shared data engine (ONE UMAPGeneViewer for all widgets) ---
const {
  viewer: sharedViewer,
  loading: engineLoading,
  error: engineError,
} = useSharedDataEngine({
  dataUrl,
  config: activeConfig,
  configLoading,
  getCloudfront,
});

// Provide config to descendants
provide(DATASET_CONFIG_KEY, activeConfig);

// --- Services ---
// Refs, not values: the dashboard copies `services` once, and a ref is the only
// way renewed credentials reach widgets that build their own data engine
const services = {
  ApiUrl: "https://api.pennsieve.net",
  s3Url: dataUrl,
  cloudfront,
};

//name = component key
const availableWidgets = [
  { name: "GeneExpression", component: RawGeneExpression },
  { name: "SideBySide", component: RawSideBySide },
  { name: "GeneXDistribution", component: RawGeneXDistribution },
  { name: "ProportionPlot", component: RawProportionPlot },
  { name: "ChromatinAccessibility", component: RawChromatinAccessibility },
  { name: "LinkedPeaks", component: RawLinkedPeaks },
];

// Dashboard options are now computed to react to config changes
const dashboardOptions = computed(() => {
  const cfg = activeConfig.value;
  const genes = cfg?.defaultGenes || {};

  const geneCoexpressionDash = {
    defaultLayout: [
      {
        id: "GeneEx-1",
        x: 0,
        y: 0,
        w: 12,
        h: 15,
        componentKey: "GeneExpression",
        componentName: "Gene Expression",
        component: RawGeneExpression,
        Props: {
          initialGene1: genes.gene1 || "CDH9",
          initialGene2: genes.gene2 || "TAC1",
          config: cfg,
        },
      },
    ],
    availableWidgets,
    services,
    name: "Gene CoExpression",
    hideEditGrid: true,
    hideHeader: true,
  };

  const geneCellComparisonDash = {
    defaultLayout: [
      {
        id: "SideBySide-1",
        x: 0,
        y: 0,
        w: 12,
        h: 15,
        componentKey: "SideBySide",
        componentName: "Side By Side Comparison",
        component: RawSideBySide,
        Props: {
          initialGene: genes.sideBySide || "CDH9",
          config: cfg,
        },
      },
    ],
    availableWidgets,
    services,
    name: "Side By Side",
    hideEditGrid: true,
    hideHeader: true,
  };

  const GeneXDistributionDash = {
    defaultLayout: [
      {
        id: "GeneXDistribution-1",
        x: 0,
        y: 0,
        w: 12,
        h: 15,
        componentKey: "GeneXDistribution",
        componentName: "Gene Expression Distribution",
        component: RawGeneXDistribution,
        Props: {
          initialGene: genes.geneX || "CDH9",
          config: cfg,
        },
      },
    ],
    availableWidgets,
    services,
    name: "Gene Distribution",
    hideEditGrid: true,
    hideHeader: true,
  };

  const proportionPlotDash = {
    defaultLayout: [
      {
        id: "ProportionPlot-1",
        x: 0,
        y: 0,
        w: 12,
        h: 15,
        componentKey: "ProportionPlot",
        componentName: "Proportion Plot",
        component: RawProportionPlot,
        Props: {
          config: cfg,
        },
      },
    ],
    availableWidgets,
    services,
    name: "Proportion Plot",
    hideEditGrid: true,
    hideHeader: true,
  };

  const chromatinDash = {
    defaultLayout: [
      {
        // Full width: wider tracks and arcs; the links table goes underneath
        id: "ChromatinAccessibility-1",
        x: 0,
        y: 0,
        w: 12,
        h: 11,
        componentKey: "ChromatinAccessibility",
        componentName: "Chromatin Accessibility",
        component: RawChromatinAccessibility,
        Props: {
          initialGene: genes.chromatin || "SCN10A",
          config: cfg,
        },
      },
      {
        id: "LinkedPeaks-1",
        x: 0,
        y: 11,
        w: 12,
        h: 8,
        componentKey: "LinkedPeaks",
        componentName: "Linked Peaks",
        component: RawLinkedPeaks,
        Props: {
          initialGene: genes.chromatin || "SCN10A",
          config: cfg,
        },
      },
    ],
    availableWidgets,
    services,
    name: "Chromatin Accessibility",
    hideEditGrid: true,
    hideHeader: true,
  };

  return [
    geneCoexpressionDash,
    geneCellComparisonDash,
    GeneXDistributionDash,
    proportionPlotDash,
    chromatinDash,
  ];
});

// For the :default prop, use the first dashboard
const defaultDash = computed(() => dashboardOptions.value[0]);
</script>

<template>
  <!-- Dataset Selector -->
  <div class="dataset-selector">
    <label for="dataset-select">Dataset: </label>
    <select id="dataset-select" v-model="selectedDatasetId" :disabled="loading">
      <option :value="null" disabled>Select a dataset…</option>
      <option v-for="ds in datasets" :key="ds.id" :value="ds.id">
        {{ ds.label }}
      </option>
    </select>
    <span v-if="loading || engineLoading" class="status-indicator">Loading…</span>
    <span v-if="error || engineError" class="status-indicator error">{{ error || engineError }}</span>
  </div>

  <!-- Dashboard Content -->
  <MultiDashboard
    v-if="dataUrl && sharedViewer"
    :key="selectedDatasetId"
    class="dashboard-app"
    :dashboardOptions="dashboardOptions"
    :default="defaultDash"
    headerTitle="Precision Gene Analysis"
    headerDescription="Select a dashboard view to explore different aspects of gene analysis. Choose between co-expression analysis or side-by-side cell/gene comparison."
  ></MultiDashboard>
</template>

<style scoped>
.dataset-selector {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: sans-serif;
  font-size: 14px;
}

.dataset-selector select {
  padding: 4px 8px;
  font-size: 14px;
}

.status-indicator {
  font-size: 13px;
  color: #666;
}

.status-indicator.error {
  color: #c00;
}

.dashboard-app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
