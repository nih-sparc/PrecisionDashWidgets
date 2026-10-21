<template>
  <div class="linked-peaks-container">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">Loading linked peaks...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>Error:</strong> {{ error }}
    </div>

    <!-- Empty State: dataset has no link data -->
    <div v-else-if="!hasLinksFile" class="empty-container">
      <div class="empty-card">
        <h3 class="empty-title">No linked peak data</h3>
        <p class="empty-text">
          This dataset doesn't include peak-gene links. Linked peaks are available for
          multiome (RNA + ATAC) datasets.
        </p>
      </div>
    </div>

    <!-- Main Dashboard -->
    <div v-else class="dashboard">
      <div class="header">
        <h3 class="title">Linked Regulatory Regions</h3>
        <span v-if="prov.linksComputed" class="calc-badge header-badge" :title="methodNote">
          Calculated
        </span>
      </div>

      <div class="content-layout">
        <!-- Controls -->
        <div class="controls">
          <label class="label gene-expression-label">
            Gene
            <div class="gene-input-wrapper">
              <input
                v-model="geneSearch"
                type="text"
                placeholder="Gene name (e.g., SCN9A)"
                class="gene-input"
                list="linked-peaks-gene-suggestions"
                @input="debouncedSearchGenes"
                @keydown.enter="handleGeneSelect"
              />
              <datalist id="linked-peaks-gene-suggestions">
                <option v-for="g in geneSuggestions" :key="g" :value="g" />
              </datalist>
              <button
                @click="handleGeneSelect"
                :disabled="!geneSearch.trim() || dataLoading"
                class="visualize-btn"
              >
                {{ dataLoading ? "Loading..." : "Show links" }}
              </button>
            </div>
          </label>

          <label class="label">
            Minimum correlation (|r|): <strong class="value">{{ minAbsCorrelation.toFixed(2) }}</strong>
            <input
              v-model.number="minAbsCorrelation"
              type="range"
              min="0"
              :max="correlationMax"
              step="0.01"
              class="slider"
            />
          </label>

          <label class="label">
            Direction:
            <div class="plot-type-toggle">
              <button
                v-for="opt in DIRECTIONS"
                :key="opt.value"
                @click="direction = opt.value"
                :class="{ active: direction === opt.value }"
                class="toggle-btn"
                :title="opt.title"
              >
                {{ opt.label }}
              </button>
            </div>
          </label>

          <div class="label">
            <span>
              Link type:
              <span
                v-if="columnInfo('link_type').computed"
                class="calc-badge"
                :title="columnInfo('link_type').rule"
              >Calculated</span>
            </span>
            <label
              v-for="t in LINK_TYPES"
              :key="t.value"
              class="checkbox-label"
              :class="{ disabled: !typesAvailable }"
            >
              <input
                type="checkbox"
                class="checkbox"
                :value="t.value"
                v-model="selectedTypes"
                :disabled="!typesAvailable"
              />
              {{ t.label }}
            </label>
            <p v-if="links.length && !typesAvailable" class="hint">
              Link types aren't available for this dataset. Reprocess it to add them.
            </p>
          </div>

          <label class="label">
            Sort by:
            <select v-model="sortBy" class="select">
              <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>
        </div>

        <!-- Summary + table -->
        <div class="main-panel">
          <div v-if="dataLoading" class="loading-overlay">
            <div class="small-spinner"></div>
            <p>Loading links...</p>
          </div>

          <div v-if="message" class="plot-message">{{ message }}</div>

          <template v-if="links.length">
            <div class="summary">
              <div class="summary-item">
                <div class="summary-value">{{ summary.total }}</div>
                <div class="summary-label">
                  links shown<span v-if="summary.total !== links.length"> (of {{ links.length }})</span>
                </div>
              </div>
              <div class="summary-item">
                <div class="summary-value">
                  <span class="pos">{{ summary.positive }}</span> /
                  <span class="neg">{{ summary.negative }}</span>
                </div>
                <div class="summary-label">positive / negative</div>
              </div>
              <div class="summary-item">
                <div class="summary-value">
                  {{ summary.farthest ? formatDistance(summary.farthest.distance) : "—" }}
                </div>
                <div class="summary-label">
                  farthest link<span v-if="summary.farthest?.linkType && typesAvailable">
                    ({{ typeLabel(summary.farthest.linkType) }})</span>
                </div>
              </div>
            </div>

            <div class="table-scroll">
              <table class="links-table">
                <thead>
                  <tr>
                    <th @click="sortBy = 'position'" :class="{ sorted: sortBy === 'position' }">
                      Location
                    </th>
                    <th>
                      Type
                      <span
                        v-if="columnInfo('link_type').computed"
                        class="calc-badge"
                        :title="columnInfo('link_type').rule"
                      >Calc</span>
                    </th>
                    <th @click="sortBy = 'distance'" :class="{ sorted: sortBy === 'distance' }">
                      Distance to gene start
                      <span
                        v-if="columnInfo('distance_to_tss').computed"
                        class="calc-badge"
                        :title="columnInfo('distance_to_tss').rule"
                      >Calc</span>
                    </th>
                    <th
                      @click="sortBy = sortBy === 'strength' ? 'correlation' : 'strength'"
                      :class="{ sorted: sortBy === 'strength' || sortBy === 'correlation' }"
                    >
                      Correlation (r)
                      <span
                        v-if="columnInfo('correlation').computed"
                        class="calc-badge"
                        :title="methodNote"
                      >Calc</span>
                    </th>
                    <th @click="sortBy = 'pValue'" :class="{ sorted: sortBy === 'pValue' }">
                      p-value
                      <span
                        v-if="columnInfo('p_value').computed"
                        class="calc-badge"
                        :title="methodNote"
                      >Calc</span>
                    </th>
                    <th>
                      Top cell type
                      <span
                        v-if="columnInfo('top_cell_type').computed"
                        class="calc-badge"
                        :title="columnInfo('top_cell_type').rule"
                      >Calc</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="link in visibleLinks"
                    :key="`${link.chrom}-${link.start}`"
                    :class="{ selected: isSelected(link) }"
                    @click="selectLink(link)"
                    title="Show this peak in the chromatin view"
                  >
                    <td class="mono">{{ link.chrom }}:{{ link.start.toLocaleString() }}–{{ link.end.toLocaleString() }}</td>
                    <td>
                      <span v-if="typesAvailable" class="type-pill" :class="link.linkType">
                        {{ typeLabel(link.linkType) }}
                      </span>
                      <span v-else class="muted">—</span>
                    </td>
                    <td>{{ formatDistance(link.distance) }}</td>
                    <td>
                      <div class="corr-cell">
                        <div class="corr-bar-track">
                          <div
                            class="corr-bar"
                            :class="(link.correlation ?? 0) < 0 ? 'neg' : 'pos'"
                            :style="{ width: `${corrWidth(link.correlation)}%` }"
                          ></div>
                        </div>
                        <span class="mono">{{ link.correlation == null ? "—" : link.correlation.toFixed(3) }}</span>
                      </div>
                    </td>
                    <td class="mono">{{ formatPValue(link.pValue) }}</td>
                    <td>{{ link.topCellType ?? "—" }}</td>
                  </tr>
                  <tr v-if="!visibleLinks.length">
                    <td colspan="6" class="muted center">No links match these filters.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <p class="footnote">
            <template v-if="prov.known">
              <span v-if="anyComputed" class="calc-badge">Calc</span>
              {{ methodNote }}
              <span v-if="anyComputed">
                Hover a <span class="calc-badge">Calc</span> label to see how that column was worked out.
              </span>
            </template>
            <template v-else>
              This dataset doesn't record which values were calculated during processing.
            </template>
            Distance is measured from the gene start in the gene's direction: upstream is before
            the gene starts, downstream is into or past the gene. Click a row to show it in the
            chromatin view.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useDataEngine, useDatasetActiveConfig, useServicesCloudfront } from "../../composables/useSharedDataEngine.js";
import {
  LINK_TYPES,
  SORT_OPTIONS,
  hasLinkTypes,
  filterLinks,
  sortLinks,
  summarizeLinks,
  linkProvenance,
  describeLinkMethod,
  formatDistance,
  formatPValue,
} from "./linkedPeaks.js";

const props = defineProps({
  dataPath: { type: String, default: "/data" },
  gene: { type: String, default: null },
  // Peak shown in the chromatin view ({ chrom, start, end }), highlighted in the table
  focusedPeak: { type: Object, default: null },
  config: { type: Object, default: null },
});

const emit = defineEmits(["update:Vars", "select-peak"]);

const { viewer: sharedViewer, loading: engineLoading } = useDataEngine();
const getCloudfront = useServicesCloudfront();
const injectedConfig = useDatasetActiveConfig();
const activeConfig = computed(() => props.config || injectedConfig.value || {});

const DIRECTIONS = [
  { value: "all", label: "All", title: "Positive and negative links" },
  { value: "positive", label: "Positive", title: "Region opens as the gene goes up" },
  { value: "negative", label: "Negative", title: "Region closes as the gene goes up" },
];

const manager = shallowRef(null);
const loading = ref(true);
const error = ref(null);
const dataLoading = ref(false);
const message = ref("");
const hasLinksFile = ref(false);

const geneSearch = ref(props.gene || "");
const selectedGene = ref(props.gene || "");
const geneSuggestions = ref([]);

const links = shallowRef([]);
const minAbsCorrelation = ref(0);
const direction = ref("all");
const selectedTypes = ref(LINK_TYPES.map((t) => t.value));
const sortBy = ref("strength");

let searchTimeout = null;

const prov = computed(() => linkProvenance(activeConfig.value?.provenance));
const methodNote = computed(() => describeLinkMethod(prov.value.info));
const anyComputed = computed(
  () => prov.value.linksComputed || Object.values(prov.value.columns).some((c) => c.computed)
);

const typesAvailable = computed(() => hasLinkTypes(links.value));

const correlationMax = computed(() => {
  const max = Math.max(0, ...links.value.map((l) => Math.abs(l.correlation ?? 0)));
  return Math.max(0.05, Math.ceil(max * 100) / 100);
});

const filteredLinks = computed(() =>
  filterLinks(links.value, {
    minAbsCorrelation: minAbsCorrelation.value,
    direction: direction.value,
    types: typesAvailable.value ? new Set(selectedTypes.value) : null,
  })
);
const visibleLinks = computed(() => sortLinks(filteredLinks.value, sortBy.value));
const summary = computed(() => summarizeLinks(filteredLinks.value));

watch(
  () => props.gene,
  (newVal) => {
    if (newVal && newVal.toUpperCase() !== selectedGene.value.toUpperCase()) {
      selectedGene.value = newVal;
      geneSearch.value = newVal;
      if (manager.value) loadLinks();
    }
  }
);

watch(selectedGene, (newVal) => {
  if (newVal) emit("update:Vars", "selectedGene", newVal);
});

async function initWithViewer(viewerInstance) {
  try {
    manager.value = viewerInstance;
    hasLinksFile.value = await viewerInstance.loadLinkedPeaks();
    loading.value = false;
    if (hasLinksFile.value && selectedGene.value) await loadLinks();
  } catch (err) {
    console.error("Failed to initialize linked peaks:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
}

onMounted(async () => {
  if (sharedViewer.value) {
    await initWithViewer(sharedViewer.value);
  } else if (!engineLoading.value) {
    const { UMAPGeneViewer } = await import("../dataManager.js");
    const v = new UMAPGeneViewer(props.dataPath, { ...(props.config || {}), getCloudfront });
    await v.initialize();
    await initWithViewer(v);
  } else {
    const unwatch = watch(sharedViewer, async (v) => {
      if (v) {
        unwatch();
        await initWithViewer(v);
      }
    });
  }
});

onBeforeUnmount(() => {
  if (searchTimeout) clearTimeout(searchTimeout);
});

function debouncedSearchGenes() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    if (geneSearch.value.length < 1) {
      geneSuggestions.value = [];
      return;
    }
    try {
      const results = await manager.value.searchGenes(geneSearch.value);
      geneSuggestions.value = results.map((r) => r.gene_name).slice(0, 20);
    } catch (err) {
      console.error("Gene search failed:", err);
    }
  }, 300);
}

async function handleGeneSelect() {
  if (!geneSearch.value.trim()) return;
  selectedGene.value = geneSearch.value.trim().toUpperCase();
  await loadLinks();
}

async function loadLinks() {
  if (!manager.value || !selectedGene.value || !hasLinksFile.value) return;
  dataLoading.value = true;
  message.value = "";
  try {
    const result = await manager.value.getLinksForGene(selectedGene.value);
    links.value = result;
    // Keep the slider in range for the new gene
    if (minAbsCorrelation.value > correlationMax.value) minAbsCorrelation.value = 0;
    if (!result.length) message.value = noLinksMessage(selectedGene.value);
  } catch (err) {
    console.error("Failed to load links:", err);
    message.value = `Failed to load links: ${err.message}`;
  } finally {
    dataLoading.value = false;
  }
}

// Explain *why* a gene can have no links: computed links only cover the genes that were tested
function noLinksMessage(gene) {
  const info = prov.value.info;
  if (info?.source === "computed" && info.gene_selection) {
    return `No linked peaks for ${gene}. Links were only calculated for ${
      info.genes_tested != null ? info.genes_tested.toLocaleString() : "a selection of"
    } genes (${info.gene_selection}), so ${gene} may not have been tested.`;
  }
  return `No linked peaks for ${gene} in this dataset.`;
}

function selectLink(link) {
  emit("select-peak", { gene: selectedGene.value, chrom: link.chrom, start: link.start, end: link.end });
}

function isSelected(link) {
  const f = props.focusedPeak;
  return !!f && f.chrom === link.chrom && f.start === link.start && f.end === link.end;
}

function columnInfo(name) {
  return prov.value.columns[name] || { computed: false, rule: null };
}

function typeLabel(value) {
  return LINK_TYPES.find((t) => t.value === value)?.label ?? value ?? "—";
}

function corrWidth(r) {
  if (r == null) return 0;
  return Math.min(100, (Math.abs(r) / correlationMax.value) * 100);
}
</script>

<style scoped>
.linked-peaks-container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 24px;
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.content-layout {
  display: flex;
  gap: 24px;
  flex: 1;
  min-height: 0;
  padding-top: 16px;
}

.controls {
  width: 20%;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  flex-shrink: 0;
  overflow-y: auto;
  box-sizing: border-box;
}

.label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
}

.label .value {
  color: #1a202c;
}

.gene-expression-label {
  font-size: 14px;
  font-weight: 600;
  color: #1a202c;
}

.select {
  padding: 10px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 14px;
  background: white;
  color: #1a202c;
  cursor: pointer;
}

.select:focus,
.gene-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.gene-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gene-input {
  padding: 10px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 14px;
  background: white;
  color: #1a202c;
  min-width: 0;
  box-sizing: border-box;
}

.gene-input::placeholder {
  font-size: 13px;
}

.visualize-btn {
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 2px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);
}

.visualize-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
  opacity: 0.7;
  box-shadow: none;
}

.slider {
  width: 100%;
  accent-color: #667eea;
}

.plot-type-toggle {
  display: flex;
  gap: 6px;
}

.toggle-btn {
  flex: 1;
  padding: 7px 8px;
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 12px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
}

.toggle-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: #667eea;
  color: white;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #1a202c;
  cursor: pointer;
}

.checkbox-label.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.checkbox {
  width: 16px;
  height: 16px;
  accent-color: #667eea;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.main-panel {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.summary {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}

.summary-item {
  flex: 1;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
}

.summary-value {
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.summary-label {
  font-size: 12px;
  color: #64748b;
}

.pos {
  color: #d97706;
}

.neg {
  color: #2563eb;
}

.table-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid #e2e8f0;
}

.links-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  color: #1a202c;
}

.links-table th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: 12px;
  color: #475569;
  padding: 8px 10px;
  border-bottom: 1px solid #e2e8f0;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.links-table th.sorted {
  color: #667eea;
}

.links-table td {
  padding: 7px 10px;
  border-bottom: 1px solid #f1f5f9;
  white-space: nowrap;
}

.links-table tbody tr {
  cursor: pointer;
}

.links-table tbody tr:hover {
  background: #f8fafc;
}

.links-table tbody tr.selected {
  background: #eef2ff;
  box-shadow: inset 3px 0 0 #667eea;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.muted {
  color: #94a3b8;
}

.center {
  text-align: center;
}

.type-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #e2e8f0;
  color: #475569;
}

.type-pill.promoter {
  background: #dcfce7;
  color: #166534;
}

.type-pill.intronic {
  background: #e0e7ff;
  color: #3730a3;
}

.type-pill.distal {
  background: #fef3c7;
  color: #92400e;
}

.corr-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.corr-bar-track {
  width: 60px;
  height: 6px;
  background: #f1f5f9;
  border-radius: 3px;
  overflow: hidden;
}

.corr-bar {
  height: 100%;
}

.corr-bar.pos {
  background: #f59e0b;
}

.corr-bar.neg {
  background: #3b82f6;
}

.calc-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 5px;
  border: 1px solid #c4b5fd;
  border-radius: 3px;
  background: #f5f3ff;
  color: #6d28d9;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  vertical-align: middle;
  cursor: help;
}

.header-badge {
  font-size: 11px;
  padding: 1px 7px;
}

.footnote {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  flex-shrink: 0;
}

.plot-message {
  padding: 4px 2px;
  font-size: 13px;
  color: #4b5563;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  background: white;
}

.empty-card {
  max-width: 420px;
  padding: 24px 28px;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  background: #f8fafc;
  text-align: center;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
}

.empty-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: #64748b;
}

.spinner {
  width: 60px;
  height: 60px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  margin-top: 20px;
  font-size: 16px;
  color: #64748b;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 10;
}

.small-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.error-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  background: #fff3cd;
  border: 1px solid #ffc107;
  padding: 20px;
  color: #856404;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
