<template>                 
    <slot :widgetName="widgetName"></slot>
    <div class="data-explorer-wrap">
        <div class="data-explorer-info">
            <el-tooltip placement="top-start">
                <template #content>Type in a query or use the suggested query buttons to run on your csv file</template>
                <el-icon color="#8300BF"><InfoFilled /></el-icon>                     
            </el-tooltip>
        </div>
        <DataExplorer :srcUrl="urlSrc" ></DataExplorer>
    </div>
</template>
<script setup lang="ts">

import { ref, unref, computed, watchEffect } from 'vue';
import { ElTooltip } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import { DataExplorer} from "pennsieve-visualization"
import { useDashboardGlobalVars } from '../../useGlobalVars'
defineOptions({
    inheritAttrs: false
})
const globalVars = useDashboardGlobalVars() 
const widgetName = ref('Data Explorer');
const urlSrc = computed(() => unref(globalVars!.s3Url))

// Write:
// globalVars!.setFilter('query', 'astrocytes')
// globalVars!.clearFilter('search')
// const gv = inject<any | null>('dashboard:globalVars', null)
//   gv.setFilter("red","#489y6")
// watchEffect(() => {
//   console.log('red =', gv?.filters.value.red)
// })
// Read reactively:
// watch(() => unref(globalVars!.filters).csvSrc, v => {
//     console.log("new package added "+v)
// })

watchEffect(()=>{

})





</script>
<style scoped lang="scss">
.data-explorer-wrap{
    overflow: auto;
    margin:0 10px 0 10px;
    .data-explorer-info{
        line-height: 20px;
        position: absolute;
        right: 0;
        margin-right: 6px;
    }
}
:deep(.dashboard-header h1){ display: none;}
</style>
