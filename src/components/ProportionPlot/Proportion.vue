<template>
  <slot></slot>
  <div class="proportion-plot-wrap">
    <ProportionPlot
      :data-path="resolvedDataPath"
      :config="props.config"
      @update:Vars="PrecisionVars.setSelection"
    />
  </div>
</template>
<script setup lang="ts">
import { unref, computed } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import ProportionPlot from "../../libs/ProportionPlot/ProportionPlot.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps<{
  dataPath?: string;
  config?: Record<string, any>;
}>();

const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () =>
    props.dataPath ??
    (globalVars ? unref(globalVars.services)?.s3Url : null) ??
    null
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
