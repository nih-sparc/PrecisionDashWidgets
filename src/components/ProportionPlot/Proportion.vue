<template>
  <slot></slot>
  <div class="proportion-plot-wrap">
    <ProportionPlot
      :data-path="resolvedDataPath"
      @update:Vars="PrecisionVars.setSelection"
    />
  </div>
</template>
<script setup lang="ts">
import { unref, computed } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import ProportionPlot from "../../libs/ProportionPlot/ProportionPlot.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";

const DEFAULT_DATA_PATH =
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  dataPath?: string;
}>();

const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () =>
    props.dataPath ??
    (globalVars ? unref(globalVars.s3Url) : null) ??
    DEFAULT_DATA_PATH
);
</script>
<style scoped lang="scss">
.proportion-plot-wrap {
  width: 100%;
  height: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
