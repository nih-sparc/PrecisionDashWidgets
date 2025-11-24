<template>
  <slot></slot>
  <div class="ai-plotly-wrap">
    <AiPlotly
      :data-path="urlSrc"
      :api-key="apiKey"
      :initial-data-url="initialDataUrl"
      @save-config="handleSaveConfig"
      @plot-generated="handlePlotGenerated"
    ></AiPlotly>
  </div>
</template>

<script setup lang="ts">
import { unref, computed } from "vue";

import AiPlotly from "../../libs/AiPlotly/AiPlotly.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";
import { usePrecisionStore } from "../../stores/precisionVars";

defineOptions({
  inheritAttrs: false,
});

// Props
const props = defineProps({
  apiKey: {
    type: String,
    default: "",
  },
  initialDataUrl: {
    type: String,
    default:
      "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2",
  },
  dataPath: {
    type: String,
    default:
      "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2",
  },
});

// Emits
const emit = defineEmits(["save-config", "plot-generated"]);

// Store and global vars
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const urlSrc = computed(() => unref(globalVars?.s3Url) || props.dataPath);

// Event handlers
function handleSaveConfig(config: any) {
  emit("save-config", config);
}

function handlePlotGenerated(data: any) {
  emit("plot-generated", data);
}
</script>

<style scoped lang="scss">
.ai-plotly-wrap {
  height: 100%;
  width: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: auto;
}
</style>
