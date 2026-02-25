<template>
  <slot></slot>
  <div class="gene-x-expression-wrap">
    <ViolinPlot
      :gene="PrecisionVars.selectedGeneX ?? undefined"
      :metadataColumn="PrecisionVars.selectedMetadataColumn ?? undefined"
      @update:Vars="handleVarsUpdate"
      data-path="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
    ></ViolinPlot>
  </div>
</template>
<script setup lang="ts">
import { ref, unref, computed, watchEffect, onMounted } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import ViolinPlot from "../../libs/ViolinPlot/ViolinPlot.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";
defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  initialGene?: string;
  initialMetadataColumn?: string;
}>();
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const urlSrc = computed(() => unref(globalVars!.s3Url));

onMounted(() => {
  if (props.initialGene && PrecisionVars.selectedGeneX === null) {
    PrecisionVars.setSelectedGeneX(props.initialGene);
  }
  if (props.initialMetadataColumn && PrecisionVars.selectedMetadataColumn === null) {
    PrecisionVars.setSelectedMetadataColumn(props.initialMetadataColumn);
  }
});

// Map ViolinPlot's emitted keys to the correct store keys for GeneXDistribution
function handleVarsUpdate(key: string, value: string | null) {
  // Map selectedGene to selectedGeneX for this dashboard
  if (key === "selectedGene") {
    PrecisionVars.setSelection("selectedGeneX", value);
  } else {
    // Pass through other keys (like selectedMetadataColumn)
    PrecisionVars.setSelection(key, value);
  }
}
</script>
<style scoped lang="scss">
.gene-x-expression-wrap {
  height: 100%;
  width: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
