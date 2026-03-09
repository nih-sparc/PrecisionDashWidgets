export { default as DataExplorer } from "./DataExplorer/DataExplorer.vue";
export { default as UMAP } from "./Umap/Umap.vue";
export { default as ProportionPlot } from "./ProportionPlot/Proportion.vue";
export { default as GeneExpression } from "./GeneExpressionViewer/GeneExpressionViewer.vue";
export { default as SideBySide } from "./SideBySide/SideBySide.vue";
export { default as GeneXDistribution } from "./GeneDistribution/GeneXDistribution.vue";
export { default as ViolinPlot } from "./GeneDistribution/GeneXDistribution.vue";
export { usePrecisionStore } from "../stores/precisionVars";
export {
  useDashboardGlobalVars,
  DASHBOARD_GLOBAL_VARS_KEY,
} from "../useGlobalVars";
import "@pennsieve-viz/core/style.css";
