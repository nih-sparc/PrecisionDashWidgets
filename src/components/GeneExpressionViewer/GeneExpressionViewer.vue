<template>
  <slot></slot>
  <div class="gene-coexpression-wrap">
    <GeneCoexpressionViewer
      :gene1="PrecisionVars.selectedGene1 ?? undefined"
      :gene2="PrecisionVars.selectedGene2 ?? undefined"
      @update:Vars="PrecisionVars.setSelection"
      :data-path="resolvedDataPath"
    ></GeneCoexpressionViewer>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import GeneCoexpressionViewer from "../../libs/GeneExpressionViewer/GeneCoexpressionViewer.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";

const DEFAULT_DATA_PATH =
  "https://temp-precision-dashboard-data.s3.us-east-1.amazonaws.com/humandrg/v2";

defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  dataPath?: string;
  initialGene1?: string;
  initialGene2?: string;
}>();
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () => props.dataPath ?? (globalVars ? unref(globalVars.services)?.s3Url : null) ?? DEFAULT_DATA_PATH
);

onMounted(() => {
  if (props.initialGene1 && PrecisionVars.selectedGene1 === null) {
    PrecisionVars.setSelectedGene1(props.initialGene1);
  }
  if (props.initialGene2 && PrecisionVars.selectedGene2 === null) {
    PrecisionVars.setSelectedGene2(props.initialGene2);
  }
});
</script>
<style scoped lang="scss">
.gene-coexpression-wrap {
  height: 100%;
  width: 100%;
  padding: 20px;
  background: white;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
