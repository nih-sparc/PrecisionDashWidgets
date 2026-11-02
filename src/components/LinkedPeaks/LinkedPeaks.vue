<template>
  <!-- childIcons: header icons the dashboard shows next to the title -->
  <slot :childIcons="childIcons"></slot>
  <div class="pdw-theme linked-peaks-wrap">
    <LinkedPeaksTable
      :gene="PrecisionVars.selectedChromatinGene ?? undefined"
      :focused-peak="PrecisionVars.chromatinFocus"
      @update:Vars="handleVarsUpdate"
      @select-peak="PrecisionVars.setChromatinFocus"
      @zoom-peak="PrecisionVars.setChromatinZoom"
      :link-filters="PrecisionVars.linkFilters"
      @update:link-filters="PrecisionVars.setLinkFilters"
      :data-path="resolvedDataPath"
      :config="props.config"
    ></LinkedPeaksTable>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted, shallowRef } from "vue";
import { InfoFilled } from "@element-plus/icons-vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import LinkedPeaksTable from "../../libs/LinkedPeaksTable/LinkedPeaksTable.vue";
import { PEAK_DEFINITION } from "../../libs/LinkedPeaksTable/linkedPeaks.js";
import { useDashboardGlobalVars } from "../../useGlobalVars";

defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  dataPath?: string;
  initialGene?: string;
  config?: Record<string, any>;
}>();
// Info icon in the widget title bar: what "peak" means
const childIcons = shallowRef([{ comp: InfoFilled, tooltip: `Peak: ${PEAK_DEFINITION}` }]);
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
  padding: 0;
  background: var(--pdw-surface);
  box-sizing: border-box;
  overflow: hidden;
}
</style>
