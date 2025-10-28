<template>
  <slot></slot>
  <div class="side-by-side-wrap">
    <SideBySide
      :gene="PrecisionVars.selectedGene ?? undefined"
      :metadataColumn="PrecisionVars.selectedMetadataColumn ?? undefined"
      @update:Vars="(key, value) => PrecisionVars.setSelection(key, value)"
      data-path="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
    ></SideBySide>
  </div>
</template>
<script setup lang="ts">
import { ref, unref, computed, watchEffect } from "vue";

import SideBySide from "../../libs/SideBySide/SideBySide.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";
import { usePrecisionStore } from "../../stores/precisionVars";
defineOptions({
  inheritAttrs: false,
});
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const urlSrc = computed(() => unref(globalVars!.s3Url));
</script>
<style scoped lang="scss">
.side-by-side-wrap {
  height: 90%;
  padding: 20px;
  background: white;
}
</style>
