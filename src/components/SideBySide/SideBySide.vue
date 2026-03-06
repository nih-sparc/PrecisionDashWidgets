<template>
  <slot></slot>
  <div class="side-by-side-wrap">
    <SideBySide
      :gene="PrecisionVars.selectedGene ?? undefined"
      :metadataColumn="PrecisionVars.selectedMetadataColumn ?? undefined"
      @update:Vars="(key, value) => PrecisionVars.setSelection(key, value)"
      :data-path="resolvedDataPath"
    ></SideBySide>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted } from "vue";
import SideBySide from "../../libs/SideBySide/SideBySide.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";
import { usePrecisionStore } from "../../stores/precisionVars";

const DEFAULT_DATA_PATH =
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2";

defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  dataPath?: string;
  initialGene?: string;
  initialMetadataColumn?: string;
}>();
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () => props.dataPath ?? (globalVars ? unref(globalVars.s3Url) : null) ?? DEFAULT_DATA_PATH
);

onMounted(() => {
  if (props.initialGene && PrecisionVars.selectedGene === null) {
    PrecisionVars.setSelectedGene(props.initialGene);
  }
  if (props.initialMetadataColumn && PrecisionVars.selectedMetadataColumn === null) {
    PrecisionVars.setSelectedMetadataColumn(props.initialMetadataColumn);
  }
});
</script>
<style scoped lang="scss">
.side-by-side-wrap {
  height: 100%;
  width: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
