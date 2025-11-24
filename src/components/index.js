import { defineAsyncComponent } from "vue";

export { default as DataExplorer } from "./DataExplorer/DataExplorer.vue";
export { default as UMAP } from "./Umap/Umap.vue";
export { default as ProportionPlot } from "./ProportionPlot/Proportion.vue";
export { default as GeneExpression } from "./GeneExpressionViewer/GeneExpressionViewer.vue";
export { default as SideBySide } from "./SideBySide/SideBySide.vue";
export { default as GeneXDistribution } from "./GeneDistribution/GeneXDistribution.vue";
//lazy load
export const AiPlotly = defineAsyncComponent(() =>
  import("./AiPlotly/AiPlotly.vue")
);
import "pennsieve-visualization/style.css";
