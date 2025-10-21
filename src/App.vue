<script setup lang="ts">
import { ref } from "vue";
import { PennsieveDashboard } from "../../PennsieveDashboard/src/components/index";
import { GeneExpression } from "./components/index";
import SideBySide from "./libs/SideBySide/SideBySide.vue";
const s3Url =
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/precision_human_drg_data.parquet";

const availableWidgets = [
  { name: "GeneExpression", component: GeneExpression },
  // { name: 'Umap', component: UMAP },
  // { name: 'Data Explorer', component: DataExplorer },
  // {name:'Proportion Plot', component:ProportionPlot}
];
const defaultLayout = [
  {
    id: "GeneEx-1",
    x: 0,
    y: 0,
    w: 12,
    h: 13,
    componentKey: "GeneExpression",
    componentName: "Gene Expression",
    component: GeneExpression,
  },
  // {
  //   id: 'Umap-1',
  //   x: 0, y: 0, w: 7, h: 10,
  //   componentKey: 'UMAP',
  //   componentName: 'UMAP',
  //   component: UMAP,
  // },
  // {
  //   id: 'DataExplorer-2',
  //   x: 7, y: 0, w: 5, h: 10,
  //   componentKey: 'DataExplorer',
  //   componentName: 'Data Explorer',
  //   component: DataExplorer,
  // },
  // {
  //   id: 'ProportionPlot-3',
  //   x: 0, y: 10, w: 12, h: 8,
  //   componentKey: 'ProportionPlot',
  //   componentName: 'Proportion Plot',
  //   component: ProportionPlot,
  // }
];
const services = {
  ApiUrl: "https://api.pennsieve.net",
  s3Url,
};
const dashboardOptions = ref({
  availableWidgets,
  defaultLayout,
  services,
});
</script>

<template>
  <!-- <PennsieveDashboard
    class="dashboard-app"
    :options="dashboardOptions"
  ></PennsieveDashboard> -->
  <SideBySide
    data-path="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
  ></SideBySide>
</template>

<style scoped>
/* set style vars from outside the dashboard > customize to match your application */
.dashboard-app {
  --el-color-primary: #243d8e;
  --el-color-primary-light-3: #fbfdff;
  --el-color-primary-dark-2: #546085;
  --color: #243d8e;
  --el-dialog-width: 90%;
  --dash-secondary: #243d8e;
}
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
