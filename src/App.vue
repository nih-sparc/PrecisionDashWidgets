<script setup lang="ts">
import { ref } from 'vue';
import {PennsieveDashboard} from 'pennsieve-dashboard'
import {UMAP, DataExplorer} from './components/index'

const availableWidgets = [
  { name: 'Umap', component: UMAP },
  { name: 'Data Explorer', component: DataExplorer },
]
const dashboardOptions = ref({
  availableWidgets
})
</script>

<template>
  <PennsieveDashboard class="dashboard-app" :options="dashboardOptions"></PennsieveDashboard>

</template>

<style scoped>
/* set style vars from outside the dashboard > customize to match your application */
.dashboard-app{
    --el-color-primary: #243d8e;
    --el-color-primary-light-3: #fbfdff;
    --el-color-primary-dark-2: #546085;
    --color:#243d8e;
    --el-dialog-width: 90%;
    --dash-secondary: #243d8e;
  }
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}
</style>
