<template>
  <slot></slot>
  <div class="pdw-theme chromatin-wrap">
    <ChromatinViewer
      :gene="PrecisionVars.selectedChromatinGene ?? undefined"
      :focus="PrecisionVars.chromatinFocus"
      :link-filters="PrecisionVars.linkFilters"
      @select-peak="PrecisionVars.setChromatinFocus"
      @update:Vars="handleVarsUpdate"
      :data-path="resolvedDataPath"
      :config="props.config"
    ></ChromatinViewer>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import ChromatinViewer from "../../libs/ChromatinViewer/ChromatinViewer.vue";
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

// The viewer emits "selectedGene"; keep it separate from the other views' genes
function handleVarsUpdate(key: string, value: string | null) {
  if (key === "selectedGene") {
    PrecisionVars.setSelection("selectedChromatinGene", value);
  } else {
    PrecisionVars.setSelection(key, value);
  }
}
</script>
<style scoped lang="scss">
.chromatin-wrap {
  height: 100%;
  width: 100%;
  padding: 0;
  background: var(--pdw-surface);
  box-sizing: border-box;
  overflow: hidden;
}
</style>
