<template>
  <slot></slot>
  <div class="gene-coexpression-wrap">
    <GeneCoexpressionViewer
      data-path="https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2"
    ></GeneCoexpressionViewer>
  </div>
</template>
<script setup lang="ts">
import { ref, unref, computed, watchEffect } from "vue";

import GeneCoexpressionViewer from "../../libs/GeneExpressionViewer/GeneCoexpressionViewer.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";
defineOptions({
  inheritAttrs: false,
});
const globalVars = useDashboardGlobalVars();
const urlSrc = computed(() => unref(globalVars!.s3Url));
</script>
<style scoped lang="scss">
.gene-coexpression-wrap {
  height: 100%;
  padding: 20px;
  background: white;
}
</style>
