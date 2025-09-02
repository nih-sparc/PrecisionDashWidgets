<template>                 
    <slot></slot>
    <div class="proportion-plot-wrap">
        <ProportionPlot :srcUrl="urlSrc" ></ProportionPlot>
    </div>
</template>
<script setup lang="ts">

import { ref, unref, computed, watchEffect } from 'vue';
import { ElTooltip } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import { ProportionPlot} from "pennsieve-visualization"
import { useDashboardGlobalVars } from '../../useGlobalVars'
defineOptions({
    inheritAttrs: false
})
const globalVars = useDashboardGlobalVars() 
const urlSrc = computed(() => unref(globalVars!.s3Url))

</script>
<style scoped lang="scss">
.proportion-plot-wrap{
  width: 100%;
  height: 100%;      
  margin: 0 10px;
  overflow: hidden;
}
:deep(.dashboard-header h1){ display: none;}
:deep(.pp-container){height: 100%;}
//set to vars when you figure out how to get them from the dashboard.
:deep(.pp-btn--primary){
    // background: #4f46e5; 
    // border-color: #4f46e5; 
}

</style>
