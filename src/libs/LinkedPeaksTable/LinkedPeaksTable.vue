<template>
  <div class="pdw-theme linked-peaks-container">
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
                class="visualize-btn pdw-btn pdw-btn--primary"
              >
                {{ dataLoading ? "Loading..." : "Show links" }}
              </button>
            </div>
          </label>

          <label class="label">
            |r| ≥ <strong class="value">{{ minAbsCorrelation.toFixed(2) }}</strong>
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
            <SegmentedToggle v-model="direction" aria-label="Link direction" :options="DIRECTIONS" />
          </label>

          <div
            class="label"
            :title="links.length && !typesAvailable ? 'Link types aren\'t available for this dataset. Reprocess it to add them.' : ''"
          >
            <span>
              Type:
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
          </div>

          <label class="label">
            Sort:
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

            <p v-if="selectedHidden" class="plot-message">
              The selected peak is hidden by the filters above.
            </p>

            <div ref="tableScroll" class="table-scroll">
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
                    <th
                      @click="sortBy = 'distance'"
                      :class="{ sorted: sortBy === 'distance' }"
                      title="Distance from the gene start, in the gene's direction"
                    >
                      Distance
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
                    <th :title="mostOpenHeaderTitle">
                      Most open in
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
                    title="Select this peak (its arc is highlighted in the chromatin view)"
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
                        <div class="corr-bar-track" :title="`Bar spans |r| from 0 to ${CORRELATION_SCALE_MAX}`">
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
                    <td :title="mostOpenTitle(link)">
                      {{ mostOpenType(link) }}
                      <span v-if="!mostOpen.size && link.topCellType" class="muted">*</span>
                    </td>
                  </tr>
                  <tr v-if="!visibleLinks.length">
                    <td colspan="6" class="muted center">No links match these filters.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <button
            class="about-toggle"
            :aria-expanded="showAbout"
            :title="prov.known ? methodNote : ''"
            @click="showAbout = !showAbout"
          >
            <span v-if="prov.linksComputed" class="calc-badge header-badge">Calculated</span>
            How these links were calculated
            <span class="chevron">{{ showAbout ? "▾" : "▸" }}</span>
          </button>
          <p v-if="showAbout" class="footnote">
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
import SegmentedToggle from "../shared/SegmentedToggle.vue";
import { ref, shallowRef, computed, onBeforeUnmount, watch, nextTick } from "vue";
import { useDatasetActiveConfig, useWidgetDataEngine } from "../../composables/useSharedDataEngine.js";
import {
  LINK_TYPES,
  SORT_OPTIONS,
  CORRELATION_SCALE_MAX,
  MOST_OPEN_TOOLTIP,
  correlationStrength,
  defaultLinkFilters,
  linkFilterOptions,
  samePeak,
  hasLinkTypes,
  filterLinks,
  sortLinks,
  summarizeLinks,
  linkProvenance,
  describeLinkMethod,
  formatDistance,
  formatPValue,
} from "./linkedPeaks.js";
import { mostOpenByPeak, peakKey, formatSignal } from "../shared/chromatinSignal.js";

const TRACKS_FILE = "chromatin_tracks.parquet";

const props = defineProps({
  dataPath: { type: String, default: "/data" },
  gene: { type: String, default: null },
  // Selected peak ({ chrom, start, end }), highlighted here and in the chromatin view
  focusedPeak: { type: Object, default: null },
  // Filters shared with the chromatin view's arcs; without them the table keeps its own
  linkFilters: { type: Object, default: null },
  config: { type: Object, default: null },
});

const emit = defineEmits(["update:Vars", "select-peak", "update:linkFilters"]);

const injectedConfig = useDatasetActiveConfig();
const activeConfig = computed(() => props.config || injectedConfig.value || {});

const DIRECTIONS = [
  { key: "all", label: "All", title: "Positive and negative links" },
  { key: "positive", label: "Positive", title: "Region opens as the gene goes up" },
  { key: "negative", label: "Negative", title: "Region closes as the gene goes up" },
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
// Depth-normalized most-open cell type per peak ("start-end" → { group, rpm, meanSignal }),
// when the chromatin tracks are loaded; empty means the processor's top_cell_type is shown
const mostOpen = shallowRef(new Map());
const sortBy = ref("strength");
const tableScroll = ref(null);

const localFilters = ref(defaultLinkFilters());
const filters = computed(() => props.linkFilters || localFilters.value);
function filterModel(key) {
  return computed({
    get: () => filters.value[key],
    set: (value) => {
      const next = { ...filters.value, [key]: value };
      localFilters.value = next;
      emit("update:linkFilters", next);
    },
  });
}
const minAbsCorrelation = filterModel("minAbsCorrelation");
const direction = filterModel("direction");
const selectedTypes = filterModel("types");
const showAbout = ref(false);

let searchTimeout = null;
let stopTracksListener = null;
let mostOpenSeq = 0;

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
  filterLinks(links.value, linkFilterOptions(filters.value, links.value))
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

const selectedHidden = computed(
  () =>
    !!props.focusedPeak &&
    links.value.some((l) => isSelected(l)) &&
    !filteredLinks.value.some((l) => isSelected(l))
);

// A peak selected here or from an arc: bring its row into view
watch(
  () => props.focusedPeak,
  async () => {
    await nextTick();
    tableScroll.value?.querySelector("tr.selected")?.scrollIntoView({ block: "nearest" });
  }
);

async function initWithViewer(viewerInstance) {
  try {
    manager.value = viewerInstance;
    // The tracks are large, so they're only used when the chromatin view has loaded them
    stopTracksListener?.();
    stopTracksListener = viewerInstance.onChromatinFileLoaded((name) => {
      if (name === TRACKS_FILE) updateMostOpen();
    });
    hasLinksFile.value = await viewerInstance.loadLinkedPeaks();
    loading.value = false;
    if (hasLinksFile.value && selectedGene.value) await loadLinks();
  } catch (err) {
    console.error("Failed to initialize linked peaks:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
}

// Shared engine: the provider's, or one per data URL shared with the other widgets
useWidgetDataEngine({
  dataPath: () => props.dataPath,
  config: () => props.config,
  onReady: initWithViewer,
  onError: (message) => {
    error.value = message;
    loading.value = false;
  },
});

onBeforeUnmount(() => {
  if (searchTimeout) clearTimeout(searchTimeout);
  stopTracksListener?.();
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
    updateMostOpen();
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

// Clicking the selected row again clears the selection
function selectLink(link) {
  if (isSelected(link)) return emit("select-peak", null);
  emit("select-peak", { gene: selectedGene.value, chrom: link.chrom, start: link.start, end: link.end });
}

function isSelected(link) {
  const f = props.focusedPeak;
  return !!f && String(f.gene).toUpperCase() === selectedGene.value.toUpperCase() && samePeak(f, link);
}

// Recompute "most open in" by reads per million in peaks, if the tracks are loaded
async function updateMostOpen() {
  const seq = ++mostOpenSeq;
  const m = manager.value;
  const current = links.value;
  const depth = m?.getChromatinDepth();
  if (!current.length || !depth || !m.isChromatinFileLoaded(TRACKS_FILE)) {
    mostOpen.value = new Map();
    return;
  }
  try {
    const signals = await m.getPeakSignals(current[0].chrom, current);
    if (seq === mostOpenSeq) mostOpen.value = mostOpenByPeak(signals, depth);
  } catch (err) {
    console.warn("Could not recompute most-open cell types:", err);
    if (seq === mostOpenSeq) mostOpen.value = new Map();
  }
}

const mostOpenHeaderTitle = computed(() =>
  mostOpen.value.size
    ? `${MOST_OPEN_TOOLTIP} Ranked by reads per million in peaks (depth-normalized, calculated in the dashboard).`
    : `${MOST_OPEN_TOOLTIP} * Ranked by mean counts per cell, not adjusted for sequencing depth: open the Chromatin Accessibility view to rank by reads per million.`
);

function mostOpenType(link) {
  return mostOpen.value.get(peakKey(link))?.group ?? link.topCellType ?? "—";
}

function mostOpenTitle(link) {
  const processor =
    link.topCellType != null
      ? `${link.topCellType}: ${formatSignal(link.topCellTypeSignal ?? 0)} mean counts per cell (processor's value, not depth-normalized)`
      : null;
  const best = mostOpen.value.get(peakKey(link));
  if (!best) return processor ?? "";
  const lines = [
    `${best.group}: ${formatSignal(best.rpm)} reads per million in peaks (depth-normalized, calculated in the dashboard)`,
  ];
  if (processor) lines.push(processor);
  return lines.join("\n");
}

function columnInfo(name) {
  return prov.value.columns[name] || { computed: false, rule: null };
}

function typeLabel(value) {
  return LINK_TYPES.find((t) => t.value === value)?.label ?? value ?? "—";
}

function corrWidth(r) {
  return correlationStrength(r) * 100;
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
  background: var(--pdw-surface);
  padding: 12px 16px;
  box-sizing: border-box;
}



.content-layout {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  padding: 6px 10px;
  background: var(--pdw-surface-muted);
  border: 1px solid var(--pdw-border);
  border-radius: 2px;
  flex-shrink: 0;
}

.label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--pdw-text-muted);
  white-space: nowrap;
}

.label .value {
  color: var(--pdw-text);
}

.gene-expression-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--pdw-text);
}

.select {
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  font-size: 14px;
  background: var(--pdw-surface);
  color: var(--pdw-text);
  cursor: pointer;
}

.select:focus,
.gene-input:focus {
  outline: none;
  border-color: var(--pdw-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pdw-primary) 10%, transparent);
}

.gene-input-wrapper {
  display: flex;
  gap: 6px;
}

.gene-input {
  width: 130px;
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  font-size: 14px;
  background: var(--pdw-surface);
  color: var(--pdw-text);
  min-width: 0;
  box-sizing: border-box;
}

.gene-input::placeholder {
  font-size: 14px;
}



.slider {
  width: 90px;
  accent-color: var(--pdw-primary);
}




.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--pdw-text);
  cursor: pointer;
  white-space: nowrap;
}

.checkbox-label.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--pdw-primary);
}

.hint {
  margin: 0;
  font-size: 14px;
  color: var(--pdw-text-muted);
  line-height: var(--pdw-line-height);
}

.main-panel {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.summary {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.summary-item {
  flex: 1;
  padding: 4px 10px;
  background: var(--pdw-surface-muted);
  border: 1px solid var(--pdw-border);
  border-radius: 2px;
}

.summary-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--pdw-text);
}

.summary-label {
  font-size: 14px;
  color: var(--pdw-text-muted);
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
  border: 1px solid var(--pdw-border);
}

.links-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  color: var(--pdw-text);
}

.links-table th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  text-align: left;
  font-weight: 600;
  font-size: 14px;
  color: #475569;
  padding: 6px 8px;
  border-bottom: 1px solid var(--pdw-border);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.links-table th.sorted {
  color: var(--pdw-primary);
}

.links-table td {
  padding: 4px 8px;
  border-bottom: 1px solid #f1f5f9;
  white-space: nowrap;
}

.links-table tbody tr {
  cursor: pointer;
}

.links-table tbody tr:hover {
  background: var(--pdw-surface-muted);
}

.links-table tbody tr.selected {
  background: #eef2ff;
  box-shadow: inset 3px 0 0 var(--pdw-primary);
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
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
  font-size: 14px;
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
  width: 40px;
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
  font-size: 14px;
  font-weight: 600;
  line-height: 15px;
  vertical-align: middle;
  cursor: help;
}

.header-badge {
  font-size: 14px;
  padding: 1px 7px;
  margin-left: 0;
}


.about-toggle {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: none;
  background: none;
  font-size: 14px;
  color: var(--pdw-text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.about-toggle:hover {
  color: var(--pdw-text);
}

.chevron {
  font-size: 14px;
}

.footnote {
  margin: 0;
  font-size: 14px;
  color: var(--pdw-text-muted);
  line-height: var(--pdw-line-height);
  flex-shrink: 0;
}

.plot-message {
  padding: 4px 2px;
  font-size: 14px;
  color: #4b5563;
}

.loading-container,
.empty-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  background: var(--pdw-surface);
}

.empty-card {
  max-width: 420px;
  padding: 24px 28px;
  border: 1px solid var(--pdw-border);
  border-radius: 2px;
  background: var(--pdw-surface-muted);
  text-align: center;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--pdw-text);
}

.empty-text {
  margin: 0;
  font-size: 14px;
  line-height: var(--pdw-line-height);
  color: var(--pdw-text-muted);
}

.spinner {
  width: 60px;
  height: 60px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid var(--pdw-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.loading-text {
  margin-top: 20px;
  font-size: 16px;
  color: var(--pdw-text-muted);
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
  border-top: 3px solid var(--pdw-primary);
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
