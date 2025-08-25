<template>                 
    <slot :widgetName="widgetName"></slot>
    <div class="umap-wrap">
        <div class="umap-title">
            <el-tooltip placement="top-start">
                <template #content>Type in a query or use the suggested query buttons to run on your csv file</template>
                <el-icon color="#8300BF"><InfoFilled /></el-icon>                     
            </el-tooltip>
        </div>
        <UMAP :apiKey="apiUrl"></UMAP>
    </div>
</template>
<script setup>

import { ref, defineEmits, inject, watch, onMounted, onUnmounted, computed,unref } from 'vue';
import { ElTooltip } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import { UMAP} from "pennsieve-visualization"
import { useDashboardGlobalVars } from '../../useGlobalVars'

const globalVars = useDashboardGlobalVars() 

defineOptions({
    inheritAttrs: false
})

const widgetName = ref('Data Explorer');
const apiUrl = computed(() => unref(globalVars?.apiUrl) || '')


</script>
<style scoped lang="scss">
.umap-wrap{
    margin:0 10px 0 10px;
    .umap-info{
        line-height: 20px;
        position: absolute;
        right: 0;
        margin-right: 6px;
    }
}
</style>