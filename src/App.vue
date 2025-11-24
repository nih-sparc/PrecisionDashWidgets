<script setup lang="ts">
import { ref } from "vue";

import { MultiDashboard } from "../../PennsieveDashboard/src/components/index";
import {
  GeneExpression,
  SideBySide,
  GeneXDistribution,
  AiPlotly,
} from "./components/index";
//import ViolinPlot from "./libs/ViolinPlot/ViolinPlot.vue";

//name = component key
const availableWidgets = [
  { name: "GeneExpression", component: GeneExpression },
  { name: "SideBySide", component: SideBySide },
  { name: "GeneXDistribution", component: GeneXDistribution },
  { name: "AiPlotly", component: AiPlotly },
];
const services = {
  ApiUrl: "https://api.pennsieve.net",
};
// Define layouts for each dashboard
const geneCoexpressionDash = {
  defaultLayout: [
    {
      id: "GeneEx-1",
      x: 0,
      y: 0,
      w: 12,
      h: 9,
      componentKey: "GeneExpression",
      componentName: "Gene Expression",
      component: GeneExpression,
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
      h: 9,
      componentKey: "SideBySide",
      componentName: "Side By Side Comparison",
      component: SideBySide,
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
      h: 9,
      componentKey: "GeneXDistribution",
      componentName: "Gene Expresion Distribution",
      component: GeneXDistribution,
    },
  ],
  availableWidgets,
  services,
  name: "Gene Distribution",
  hideEditGrid: true,
  hideHeader: true,
};
const AiDash = {
  defaultLayout: [
    {
      id: "AiPlotly-1",
      x: 0,
      y: 0,
      w: 12,
      h: 9,
      componentKey: "AiPlotly",
      componentName: "AI Generated Plotly",
      component: AiPlotly,
    },
  ],
  availableWidgets,
  services,
  name: "AI Plot",
  hideEditGrid: true,
  hideHeader: true,
};
// Reactive dashboard options
const dashboardOptions = ref([
  geneCoexpressionDash,
  geneCellComparisonDash,
  GeneXDistributionDash,
  AiDash,
]);
</script>

<template>
  <!-- Dashboard Content -->

  <!-- <ViolinPlot
      style="height: 500px"
      data-path="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
    ></ViolinPlot> -->
  <MultiDashboard
    class="dashboard-app"
    :dashboardOptions="dashboardOptions"
    :default="geneCoexpressionDash"
  ></MultiDashboard>
</template>

<style scoped>
.dashboard-app {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
