<template>                 
    <slot :widgetName="widgetName"></slot>
    <div class="umap-wrap">
        <UMAP  :srcUrl="urlSrc"></UMAP>
    </div>
</template>
<script setup>

import { ref, watch,unref, computed, watchEffect } from 'vue';
import { ElTooltip } from "element-plus";
import { InfoFilled } from "@element-plus/icons-vue";
import { UMAP} from "pennsieve-visualization"
import { useDashboardGlobalVars } from '../../useGlobalVars'
defineOptions({
    inheritAttrs: false
})
const globalVars = useDashboardGlobalVars() 
const widgetName = ref('Data Explorer');
const urlSrc = computed(() => unref(globalVars?.s3Url))
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