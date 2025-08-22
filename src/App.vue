<script setup lang="ts">
import { ref } from 'vue';
import {PennsieveDashboard} from 'pennsieve-dashboard'
import {UMAP, DataExplorer} from './components/index'

const availableWidgets = [
  { name: 'umap', component: UMAP },
  { name: 'data explorer', component: DataExplorer },
]
const dashboardOptions = ref({
  availableWidgets
})
</script>

<template>
  <PennsieveDashboard :options="dashboardOptions"></PennsieveDashboard>

</template>

<style scoped>
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
