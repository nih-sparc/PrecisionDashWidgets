<script setup lang="ts">
import { ref, markRaw } from "vue";

import { MultiDashboard } from "../../PennsieveDashboard/src/components/index";
import {
  GeneExpression,
  SideBySide,
  GeneXDistribution,
} from "./components/index";

const RawGeneExpression = markRaw(GeneExpression);
const RawSideBySide = markRaw(SideBySide);
const RawGeneXDistribution = markRaw(GeneXDistribution);
//import ViolinPlot from "./libs/ViolinPlot/ViolinPlot.vue";

//name = component key
const availableWidgets = [
  { name: "GeneExpression", component: RawGeneExpression },
  { name: "SideBySide", component: RawSideBySide },
  { name: "GeneXDistribution", component: RawGeneXDistribution },
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
      h: 11,
      componentKey: "GeneExpression",
      componentName: "Gene Expression",
      component: RawGeneExpression,
      Props: { initialGene1: "CDH9", initialGene2: "TAC1" },
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
      Props: { initialGene: "CDH9" }
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
      Props: { initialGene: "CDH9" }
    },
  ],
  availableWidgets,
  services,
  name: "Gene Distribution",
  hideEditGrid: true,
  hideHeader: true,
};
// Reactive dashboard options
const dashboardOptions = ref([
  geneCoexpressionDash,
  geneCellComparisonDash,
  GeneXDistributionDash,
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
    headerTitle="Precision Gene Analysis"
    headerDescription="Select a dashboard view to explore different aspects of gene analysis. Choose between co-expression analysis or side-by-side cell/gene comparison."
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
