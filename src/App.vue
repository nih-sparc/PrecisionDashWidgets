<script setup lang="ts">
import { ref, reactive, watch, computed, markRaw, provide } from "vue";

import { MultiDashboard } from "../../PennsieveDashboard/src/components/index";
import {
  GeneExpression,
  SideBySide,
  GeneXDistribution,
  ProportionPlot,
} from "./components/index";
import { useViewerAssets } from "./composables/useViewerAssets.js";
import { useDatasetConfig } from "./composables/useDatasetConfig.js";
import { useSharedDataEngine, DATASET_CONFIG_KEY } from "./composables/useSharedDataEngine.js";

const RawGeneExpression = markRaw(GeneExpression);
const RawSideBySide = markRaw(SideBySide);
const RawGeneXDistribution = markRaw(GeneXDistribution);
const RawProportionPlot = markRaw(ProportionPlot);

// --- Pennsieve config (hardcoded for now) ---
const API2_URL = "/api2";
const TOKEN = "YOUR_API_TOKEN_HERE";

const DATASETS = [
  {
    id: "parquet-passthrough",
    label: "Human DRG (Parquet)",
    datasetId: "N:dataset:e406826e-1e0c-42e3-b88a-73bb175924b0",
    packageId: "N:package:576bee78-58de-4b56-8da4-101c6b97ed61",
  },
  {
    id: "seurat-package",
    label: "Human DRG (Seurat Processed)",
    datasetId: "N:dataset:e406826e-1e0c-42e3-b88a-73bb175924b0",
    packageId: "N:package:0a61d57f-38fd-4db8-b8ce-ba42266e0380",
  },
];

// --- Viewer assets composable ---
const {
  selectedDatasetId,
  dataUrl,
  loading,
  error,
  datasets,
} = useViewerAssets({
  api2Url: API2_URL,
  token: TOKEN,
  datasets: DATASETS,
});

// --- Dataset config composable (fetches manifest + merges with frontend config) ---
const {
  activeConfig,
  loading: configLoading,
} = useDatasetConfig({
  dataUrl,
  datasetId: selectedDatasetId,
});

// --- Shared data engine (ONE UMAPGeneViewer for all widgets) ---
const {
  viewer: sharedViewer,
  loading: engineLoading,
  error: engineError,
} = useSharedDataEngine({
  dataUrl,
  config: activeConfig,
});

// Provide config to descendants
provide(DATASET_CONFIG_KEY, activeConfig);

// --- Services (reactive so widgets pick up URL changes) ---
const services = reactive({
  ApiUrl: "https://api.pennsieve.net",
  s3Url: null as string | null,
});

watch(dataUrl, (url) => {
  services.s3Url = url;
});

//name = component key
const availableWidgets = [
  { name: "GeneExpression", component: RawGeneExpression },
  { name: "SideBySide", component: RawSideBySide },
  { name: "GeneXDistribution", component: RawGeneXDistribution },
  { name: "ProportionPlot", component: RawProportionPlot },
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
        h: 11,
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
        h: 11,
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
        h: 11,
        componentKey: "GeneXDistribution",
        componentName: "Gene Expresion Distribution",
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
        h: 11,
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

  return [
    geneCoexpressionDash,
    geneCellComparisonDash,
    GeneXDistributionDash,
    proportionPlotDash,
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
