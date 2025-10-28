<script setup lang="ts">
import { ref } from "vue";

import { MultiDashboard } from "../../PennsieveDashboard/src/components/index";
import { GeneExpression, SideBySide } from "./components/index";

const s3Url =
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet";

const availableWidgets = [
  { name: "GeneExpression", component: GeneExpression },
  { name: "SideBySide", component: SideBySide },
];
const services = {
  ApiUrl: "https://api.pennsieve.net",
  s3Url,
};
// Define layouts for each dashboard
const geneCoexpressionDash = {
  defaultLayout: [
    {
      id: "GeneEx-1",
      x: 0,
      y: 0,
      w: 12,
      h: 10,
      componentKey: "GeneExpression",
      componentName: "Gene Expression",
      component: GeneExpression,
    },
  ],
  availableWidgets,
  services,
  name: "Gene CoExpression",
};

const geneCellComparisonDash = {
  defaultLayout: [
    {
      id: "SideBySide-1",
      x: 0,
      y: 0,
      w: 12,
      h: 10,
      componentKey: "SideBySide",
      componentName: "Side By Side Comparison",
      component: SideBySide,
    },
  ],
  availableWidgets,
  services,
  name: "Side By Side",
};

// Reactive dashboard options
const dashboardOptions = ref([geneCoexpressionDash, geneCellComparisonDash]);
</script>

<template>
  <!-- Dashboard Content -->
  <div style="flex: 1">
    <MultiDashboard
      class="dashboard-app"
      :dashboardOptions="dashboardOptions"
      :default="geneCoexpressionDash"
    ></MultiDashboard>
  </div>
</template>

<style scoped></style>
