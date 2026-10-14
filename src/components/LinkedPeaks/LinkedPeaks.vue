<template>
  <slot></slot>
  <div class="linked-peaks-wrap">
    <LinkedPeaksTable
      :gene="PrecisionVars.selectedChromatinGene ?? undefined"
      :focused-peak="PrecisionVars.chromatinFocus"
      @update:Vars="handleVarsUpdate"
      @select-peak="PrecisionVars.setChromatinFocus"
      :data-path="resolvedDataPath"
      :config="props.config"
    ></LinkedPeaksTable>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import LinkedPeaksTable from "../../libs/LinkedPeaksTable/LinkedPeaksTable.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";

defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  dataPath?: string;
  initialGene?: string;
  config?: Record<string, any>;
}>();
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () => props.dataPath ?? (globalVars ? unref(globalVars.services)?.s3Url : null) ?? null
);

onMounted(() => {
  if (props.initialGene && PrecisionVars.selectedChromatinGene === null) {
    PrecisionVars.setSelectedChromatinGene(props.initialGene);
  }
});

// Shares the gene with the Chromatin Accessibility view, so a row click there shows the peak
function handleVarsUpdate(key: string, value: string | null) {
  if (key === "selectedGene") {
    PrecisionVars.setSelection("selectedChromatinGene", value);
  } else {
    PrecisionVars.setSelection(key, value);
  }
}
</script>
<style scoped lang="scss">
.linked-peaks-wrap {
  height: 100%;
  width: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
