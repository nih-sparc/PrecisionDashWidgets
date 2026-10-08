<template>
  <slot></slot>
  <div class="gene-coexpression-wrap">
    <GeneCoexpressionViewer
      :gene1="PrecisionVars.selectedGene1 ?? undefined"
      :gene2="PrecisionVars.selectedGene2 ?? undefined"
      @update:Vars="PrecisionVars.setSelection"
      :data-path="resolvedDataPath"
      :config="props.config"
    ></GeneCoexpressionViewer>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted } from "vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import GeneCoexpressionViewer from "../../libs/GeneExpressionViewer/GeneCoexpressionViewer.vue";
import { useDashboardGlobalVars } from "../../useGlobalVars";

defineOptions({
  inheritAttrs: false,
});
const props = defineProps<{
  dataPath?: string;
  initialGene1?: string;
  initialGene2?: string;
  config?: Record<string, any>;
}>();
const globalVars = useDashboardGlobalVars();
const PrecisionVars = usePrecisionStore();
const resolvedDataPath = computed(
  () => props.dataPath ?? (globalVars ? unref(globalVars.services)?.s3Url : null) ?? null
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
