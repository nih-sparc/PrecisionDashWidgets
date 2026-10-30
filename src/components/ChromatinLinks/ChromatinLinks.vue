<template>
  <!-- childIcons: header icons the dashboard shows next to the title -->
  <slot :childIcons="childIcons"></slot>
  <!-- The chromatin view and its linked peaks table in one widget: one title bar, one gene
       (set in the chromatin view), each part's controls in the left column beside it -->
  <div class="pdw-theme chromatin-links-wrap">
    <div class="chromatin-part">
      <ChromatinViewer
        :gene="PrecisionVars.selectedChromatinGene ?? undefined"
        :focus="PrecisionVars.chromatinFocus"
        :link-filters="PrecisionVars.linkFilters"
        :zoom="PrecisionVars.chromatinZoom"
        @select-peak="PrecisionVars.setChromatinFocus"
        @zoom-peak="PrecisionVars.setChromatinZoom"
        @update:Vars="handleVarsUpdate"
        :data-path="resolvedDataPath"
        :config="props.config"
      ></ChromatinViewer>
    </div>
    <div class="links-part">
      <LinkedPeaksTable
        :show-gene-input="false"
        :gene="PrecisionVars.selectedChromatinGene ?? undefined"
        :focused-peak="PrecisionVars.chromatinFocus"
        :link-filters="PrecisionVars.linkFilters"
        @select-peak="PrecisionVars.setChromatinFocus"
        @zoom-peak="PrecisionVars.setChromatinZoom"
        @update:link-filters="PrecisionVars.setLinkFilters"
        @update:Vars="handleVarsUpdate"
        :data-path="resolvedDataPath"
        :config="props.config"
      ></LinkedPeaksTable>
    </div>
  </div>
</template>
<script setup lang="ts">
import { unref, computed, onMounted, shallowRef } from "vue";
import { InfoFilled } from "@element-plus/icons-vue";
import { usePrecisionStore } from "../../stores/precisionVars";
import ChromatinViewer from "../../libs/ChromatinViewer/ChromatinViewer.vue";
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

// Both parts emit "selectedGene"; keep it separate from the other views' genes
function handleVarsUpdate(key: string, value: string | null) {
  if (key === "selectedGene") {
    PrecisionVars.setSelection("selectedChromatinGene", value);
  } else {
    PrecisionVars.setSelection(key, value);
  }
}
</script>
<style scoped lang="scss">
.chromatin-links-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--pdw-surface);
  box-sizing: border-box;
  overflow: hidden;
}

// The chromatin view gets a bit more height than the table
.chromatin-part {
  flex: 58 1 0;
  min-height: 0;
}

.links-part {
  flex: 42 1 0;
  min-height: 0;
  border-top: 1px solid var(--pdw-border);
}

// One widget, so the parts sit close together
.chromatin-part :deep(.dashboard) {
  padding: 8px 12px 6px;
}

.links-part :deep(.dashboard) {
  padding: 6px 12px 8px;
}
</style>
