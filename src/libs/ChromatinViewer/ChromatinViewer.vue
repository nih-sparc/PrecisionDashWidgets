<template>
  <div class="chromatin-container">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">{{ loadingText }}</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>Error:</strong> {{ error }}
    </div>

    <!-- Empty State: dataset has no chromatin data -->
    <div v-else-if="!available.tracks" class="empty-container">
      <div class="empty-card">
        <h3 class="empty-title">No chromatin accessibility data</h3>
        <p class="empty-text">
          This dataset only has gene expression (RNA). Chromatin accessibility tracks are
          available for multiome (RNA + ATAC) datasets.
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
                placeholder="Gene name (e.g., SCN10A)"
                class="gene-input"
                list="chromatin-gene-suggestions"
                @input="debouncedSearchGenes"
                @keydown.enter="handleGeneSelect"
              />
              <datalist id="chromatin-gene-suggestions">
                <option v-for="gene in geneSuggestions" :key="gene" :value="gene" />
              </datalist>
              <button
                @click="handleGeneSelect"
                :disabled="!geneSearch.trim() || dataLoading || !available.geneCoords"
                class="visualize-btn"
              >
                {{ dataLoading ? "Loading..." : "Visualize" }}
              </button>
            </div>
          </label>

          <label class="label">
            Region around gene:
            <select v-model.number="flank" class="select">
              <option v-for="opt in FLANK_OPTIONS" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </label>

          <label class="label">
            Group by:
            <select v-model="groupBy" class="select">
              <option
                v-for="opt in GROUP_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                :disabled="!opt.available"
              >
                {{ opt.available ? opt.label : `${opt.label} (not available)` }}
              </option>
            </select>
          </label>

          <label class="label">
            Signal:
            <div class="plot-type-toggle">
              <button
                @click="signalMode = 'normalized'"
                :class="{ active: signalMode === 'normalized' }"
                class="toggle-btn"
                title="Mean counts per cell, so groups of different sizes are comparable"
              >
                Normalized
              </button>
              <button
                @click="signalMode = 'raw'"
                :class="{ active: signalMode === 'raw' }"
                :disabled="!hasCellCounts"
                class="toggle-btn"
                title="Total counts in the group (larger groups have higher signal)"
              >
                Raw
              </button>
            </div>
          </label>

          <label
            class="checkbox-label"
            :class="{ disabled: !available.links }"
            :title="available.links ? '' : 'Linked peaks aren\'t available for this dataset'"
          >
            <input
              v-model="highlightLinks"
              type="checkbox"
              class="checkbox"
              :disabled="!available.links"
            />
            Highlight linked peaks
          </label>
        </div>

        <!-- Tracks -->
        <div ref="plotContainer" class="plot-container">
          <div v-if="dataLoading" class="loading-overlay">
            <div class="small-spinner"></div>
            <p>Loading tracks...</p>
          </div>
          <div v-if="message" class="plot-message">{{ message }}</div>
          <div v-if="view" class="region-label">
            <strong>{{ view.gene.name }}</strong>
            {{ view.chrom }}:{{ formatBp(view.start) }}–{{ formatBp(view.end) }}
            ({{ view.gene.strand === "-" ? "minus" : "plus" }} strand)
            <span v-if="available.links && highlightLinks" class="link-summary">· {{ linkSummary }}</span>
          </div>
          <div class="svg-scroll">
            <svg ref="plotSvg" class="plot-svg"></svg>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import * as d3 from "d3";
import { useDataEngine, useDatasetActiveConfig, useServicesCloudfront } from "../../composables/useSharedDataEngine.js";
import { useKeepAliveGate } from "../../composables/useKeepAliveGate.js";

const props = defineProps({
  dataPath: { type: String, default: "/data" },
  gene: { type: String, default: null },
  // Peak to show and highlight ({ gene, chrom, start, end }), e.g. from the linked peaks table
  focus: { type: Object, default: null },
  config: { type: Object, default: null },
});

const emit = defineEmits(["update:Vars"]);

const { viewer: sharedViewer, loading: engineLoading } = useDataEngine();
const getCloudfront = useServicesCloudfront();
const { runWhenActive, observeResize } = useKeepAliveGate();
const injectedConfig = useDatasetActiveConfig();
const activeConfig = computed(() => props.config || injectedConfig.value || {});

const FLANK_OPTIONS = [
  { value: 2000, label: "± 2 kb" },
  { value: 10000, label: "± 10 kb" },
  { value: 50000, label: "± 50 kb" },
  { value: 100000, label: "± 100 kb" },
  { value: 250000, label: "± 250 kb" },
];

// Tracks are precomputed per cell type only; other groupings need processor support
const GROUP_OPTIONS = [
  { value: "cell_type", label: "Cell type", available: true },
  { value: "cluster", label: "Cluster", available: false },
  { value: "donor", label: "Donor", available: false },
];

const TRACK_HEIGHT = 34;
const TRACK_GAP = 4;
const GENE_LANE_HEIGHT = 34;
const LINK_ROW_HEIGHT = 60;
const MARGIN = { top: 34, right: 20, bottom: 12, left: 190 };
const TARGET_COLOR = "#667eea";
const OTHER_GENE_COLOR = "#94a3b8";
const LINK_COLOR = "#f59e0b";
const FOCUS_COLOR = "#667eea";
const FOCUS_PADDING = 2000;

const plotSvg = ref(null);
const plotContainer = ref(null);
const manager = shallowRef(null);

const loading = ref(true);
const loadingText = ref("Loading data...");
const error = ref(null);
const dataLoading = ref(false);
const message = ref("");

const available = ref({ tracks: false, geneCoords: false, links: false });
const groups = ref([]);
const cellCounts = shallowRef(new Map());
const hasCellCounts = computed(() => cellCounts.value.size > 0);

const geneSearch = ref(props.gene || "");
const selectedGene = ref(props.gene || "");
const geneSuggestions = ref([]);
const flank = ref(50000);
const groupBy = ref("cell_type");
const signalMode = ref("normalized");
const highlightLinks = ref(true);

// { gene, chrom, start, end, genes, signal, links }
const view = shallowRef(null);

let searchTimeout = null;
let resizeObserver = null;
let loadSeq = 0;

const linkSummary = computed(() => {
  const links = view.value?.links || [];
  if (!links.length) return `No linked peaks for ${view.value.gene.name}.`;
  const shown = links.filter((l) => l.end >= view.value.start && l.start <= view.value.end);
  const hidden = links.length - shown.length;
  const base = `${links.length} linked peak${links.length === 1 ? "" : "s"}`;
  return hidden ? `${base} (${hidden} outside this region — widen it to see them)` : base;
});

watch(
  () => props.gene,
  (newVal) => {
    if (newVal && newVal !== selectedGene.value) {
      selectedGene.value = newVal;
      geneSearch.value = newVal;
      if (manager.value) runWhenActive(loadRegion);
    }
  }
);

watch(selectedGene, (newVal) => {
  if (newVal) emit("update:Vars", "selectedGene", newVal);
});

// A peak picked elsewhere: redraw if it's already in view, otherwise widen the region.
// When the gene changes too, the gene watcher's load already includes the peak.
watch(
  () => props.focus,
  () => {
    const v = view.value;
    if (!v || !manager.value) return;
    const f = focusForGene(v.gene);
    if (!f) return runWhenActive(draw);
    if (f.start >= v.start && f.end <= v.end) runWhenActive(draw);
    else runWhenActive(loadRegion);
  }
);

watch(flank, () => {
  if (view.value) runWhenActive(loadRegion);
});

watch([signalMode, highlightLinks, groupBy], () => runWhenActive(draw));

async function initWithViewer(viewerInstance) {
  try {
    manager.value = viewerInstance;
    loadingText.value = "Loading chromatin data...";
    available.value = await viewerInstance.loadChromatin();

    if (available.value.tracks) {
      groups.value = sortGroups(await viewerInstance.getChromatinGroups());
      cellCounts.value = await countCellsPerGroup(viewerInstance);
    }
    if (!available.value.links) highlightLinks.value = false;

    loading.value = false;
    if (!available.value.tracks) return;

    await nextTick();
    resizeObserver = observeResize(plotContainer.value, draw);

    if (!available.value.geneCoords) {
      message.value =
        "Gene locations aren't available for this dataset yet, so tracks can't be placed. Reprocess the dataset to add them.";
      return;
    }
    if (selectedGene.value) await loadRegion();
  } catch (err) {
    console.error("Failed to initialize chromatin view:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
}

// Cells per group, used to turn mean signal back into raw totals
async function countCellsPerGroup(viewerInstance) {
  const column = activeConfig.value?.cellTypeColumn || "cell_type";
  const counts = new Map();
  try {
    const cells = await viewerInstance.getReductionData();
    for (let i = 0; i < cells.length; i++) {
      const value = cells[i][column];
      if (value == null) continue;
      const key = String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  } catch (err) {
    console.warn("Could not count cells per group:", err);
  }
  return counts;
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
  resizeObserver?.disconnect();
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
  if (!geneSearch.value.trim() || !available.value.geneCoords) return;
  selectedGene.value = geneSearch.value.trim().toUpperCase();
  await loadRegion();
}

// The focused peak, if it belongs to this gene
function focusForGene(gene) {
  const f = props.focus;
  if (!f || !gene || String(f.gene).toUpperCase() !== gene.name.toUpperCase()) return null;
  const bare = (c) => String(c).replace(/^chr/i, "");
  return bare(f.chrom) === bare(gene.chrom) ? f : null;
}

async function loadRegion() {
  if (!manager.value || !selectedGene.value || !available.value.geneCoords) return;
  // Ignore results from an older request if the gene changed meanwhile
  const seq = ++loadSeq;
  dataLoading.value = true;
  message.value = "";
  try {
    const gene = await manager.value.getGeneCoordinates(selectedGene.value);
    if (seq !== loadSeq) return;
    if (!gene) {
      view.value = null;
      message.value = `No genome location found for ${selectedGene.value}.`;
      draw();
      return;
    }
    // Widen past the chosen region size if needed so a focused peak is visible
    const f = focusForGene(gene);
    const start = Math.max(0, Math.min(gene.start - flank.value, f ? f.start - FOCUS_PADDING : Infinity));
    const end = Math.max(gene.end + flank.value, f ? f.end + FOCUS_PADDING : -Infinity);
    const [genes, signal, links] = await Promise.all([
      manager.value.getGenesInRegion(gene.chrom, start, end),
      manager.value.getChromatinSignal(gene.chrom, start, end),
      available.value.links ? manager.value.getLinkedPeaks(gene.name) : [],
    ]);
    if (seq !== loadSeq) return;
    view.value = { gene, chrom: gene.chrom, start, end, genes, signal, links };
    if (!signal.length) message.value = "No accessible peaks in this region.";
    await nextTick();
    draw();
  } catch (err) {
    console.error("Failed to load chromatin region:", err);
    message.value = `Failed to load region: ${err.message}`;
  } finally {
    if (seq === loadSeq) dataLoading.value = false;
  }
}

function signalValue(d) {
  if (signalMode.value === "normalized") return d.signal;
  return d.signal * (cellCounts.value.get(d.group) || 0);
}

function draw() {
  const svgEl = plotSvg.value;
  if (!svgEl) return;
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const v = view.value;
  if (!v) {
    svg.attr("height", 0);
    return;
  }

  const width = Math.max(300, plotContainer.value?.clientWidth || 0) - 2;
  const x = d3
    .scaleLinear()
    .domain([v.start, v.end])
    .range([MARGIN.left, width - MARGIN.right]);
  const clampX = (pos) => Math.max(MARGIN.left, Math.min(width - MARGIN.right, x(pos)));

  const lanes = assignLanes(v.genes, x, v.gene.name);
  const geneRowHeight = Math.max(1, lanes.length) * GENE_LANE_HEIGHT;
  const tracksTop = MARGIN.top + geneRowHeight + 20;
  const tracksHeight = groups.value.length * (TRACK_HEIGHT + TRACK_GAP);
  const showLinks = highlightLinks.value && available.value.links;
  const linkRowTop = tracksTop + tracksHeight + 4;
  const height = linkRowTop + (showLinks ? LINK_ROW_HEIGHT : 0) + MARGIN.bottom;

  svg.attr("width", width).attr("height", height);

  // Genomic axis
  const span = v.end - v.start;
  const decimals = span < 20000 ? 3 : 2;
  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${MARGIN.top - 6})`)
    .call(
      d3
        .axisTop(x)
        .ticks(Math.max(2, Math.floor((width - MARGIN.left) / 130)))
        .tickFormat((d) => `${(d / 1e6).toFixed(decimals)} Mb`)
    )
    .call((axis) => axis.selectAll("text").attr("font-size", 16));

  // Linked peak bands sit behind everything else
  const visibleLinks = showLinks
    ? v.links.filter((l) => l.end >= v.start && l.start <= v.end)
    : [];
  const maxCorr = d3.max(visibleLinks, (l) => Math.abs(l.correlation ?? 0)) || 1;
  svg
    .append("g")
    .selectAll("rect")
    .data(visibleLinks)
    .join("rect")
    .attr("x", (l) => clampX(l.start) - 1.5)
    .attr("width", (l) => Math.max(3, clampX(l.end) - clampX(l.start) + 3))
    .attr("y", MARGIN.top)
    .attr("height", linkRowTop - MARGIN.top)
    .attr("fill", LINK_COLOR)
    .attr("opacity", (l) => 0.12 + 0.3 * (Math.abs(l.correlation ?? 0) / maxCorr))
    .append("title")
    .text((l) => linkTooltip(v, l));

  drawFocus(svg, x, clampX, linkRowTop, v);
  drawGeneModel(svg, lanes, x, clampX, v);
  drawTracks(svg, x, tracksTop, width, v);
  if (showLinks) drawLinkArcs(svg, x, clampX, linkRowTop, width, v, visibleLinks);
}

// Outline the peak picked in the linked peaks table
function drawFocus(svg, x, clampX, bottom, v) {
  const f = focusForGene(v.gene);
  if (!f || f.end < v.start || f.start > v.end) return;
  const x1 = clampX(f.start) - 3;
  const width = Math.max(6, clampX(f.end) - clampX(f.start) + 6);
  const g = svg.append("g").attr("class", "focus");
  g.append("rect")
    .attr("x", x1)
    .attr("width", width)
    .attr("y", MARGIN.top)
    .attr("height", bottom - MARGIN.top)
    .attr("fill", FOCUS_COLOR)
    .attr("fill-opacity", 0.08)
    .attr("stroke", FOCUS_COLOR)
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "4 3");
  g.append("title").text(`Selected peak\n${v.chrom}:${formatBp(f.start)}–${formatBp(f.end)}`);
}

// Greedy packing so overlapping genes (and their labels) get separate rows
function assignLanes(genes, x, targetName) {
  const sorted = [...genes].sort((a, b) =>
    a.name === targetName ? -1 : b.name === targetName ? 1 : a.start - b.start
  );
  const laneEnds = [];
  const lanes = [];
  for (const gene of sorted) {
    // The label sits left of the gene start
    const left = x(gene.start) - 8 - gene.name.length * 7;
    const right = x(gene.end) + 6;
    let lane = laneEnds.findIndex((laneEnd) => left > laneEnd);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(right);
      lanes.push([]);
    } else {
      laneEnds[lane] = right;
    }
    lanes[lane].push(gene);
  }
  return lanes;
}

function drawGeneModel(svg, lanes, x, clampX, v) {
  const g = svg.append("g").attr("class", "gene-model");
  lanes.forEach((lane, i) => {
    const mid = MARGIN.top + i * GENE_LANE_HEIGHT + GENE_LANE_HEIGHT / 2 + 2;
    for (const gene of lane) {
      const isTarget = gene.name === v.gene.name;
      const color = isTarget ? TARGET_COLOR : OTHER_GENE_COLOR;
      const x1 = clampX(gene.start);
      const x2 = clampX(gene.end);
      const geneG = g.append("g");
      geneG.append("title").text(
        `${gene.name} (${gene.strand} strand)\n${gene.chrom}:${formatBp(gene.start)}–${formatBp(gene.end)}\n${gene.exons.length} exon${gene.exons.length === 1 ? "" : "s"}`
      );

      // Intron line with strand chevrons
      geneG
        .append("line")
        .attr("x1", x1)
        .attr("x2", x2)
        .attr("y1", mid)
        .attr("y2", mid)
        .attr("stroke", color)
        .attr("stroke-width", 1.5);
      const dir = gene.strand === "-" ? -1 : 1;
      for (let cx = x1 + 12; cx < x2 - 6; cx += 40) {
        geneG
          .append("path")
          .attr("d", `M${cx - 3 * dir},${mid - 3} L${cx},${mid} L${cx - 3 * dir},${mid + 3}`)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.2);
      }

      // Exons
      geneG
        .selectAll("rect")
        .data(gene.exons.filter(([s, e]) => e >= v.start && s <= v.end))
        .join("rect")
        .attr("x", ([s]) => clampX(s))
        .attr("width", ([s, e]) => Math.max(1.5, clampX(e) - clampX(s)))
        .attr("y", mid - 6)
        .attr("height", 12)
        .attr("fill", color);

      // Label to the left of the gene, or inside the view if it starts off-screen
      const labelX = Math.max(MARGIN.left + 2, x(gene.start) - 6);
      geneG
        .append("text")
        .attr("x", labelX)
        .attr("y", mid - 9)
        .attr("text-anchor", labelX === MARGIN.left + 2 ? "start" : "end")
        .attr("font-size", 16)
        .attr("font-weight", isTarget ? 700 : 400)
        .attr("fill", isTarget ? TARGET_COLOR : "#475569")
        .text(gene.name);
    }
  });

  svg
    .append("text")
    .attr("x", MARGIN.left - 10)
    .attr("y", MARGIN.top + GENE_LANE_HEIGHT / 2 + 6)
    .attr("text-anchor", "end")
    .attr("font-size", 16)
    .attr("font-weight", 600)
    .attr("fill", "#1a202c")
    .text("Genes");
}

function drawTracks(svg, x, top, width, v) {
  const byGroup = d3.group(v.signal, (d) => d.group);
  const yMax = d3.max(v.signal, signalValue) || 1;
  const y = d3.scaleLinear().domain([0, yMax]).range([0, TRACK_HEIGHT - 4]);
  const color = d3.scaleOrdinal(d3.schemeTableau10).domain(groups.value);
  const unit = signalMode.value === "normalized" ? "mean counts per cell" : "total counts";

  // Row backgrounds go underneath everything so link and focus highlights stay visible
  const backgrounds = svg.insert("g", ":first-child").attr("class", "track-backgrounds");
  const g = svg.append("g").attr("class", "tracks");
  groups.value.forEach((group, i) => {
    const trackTop = top + i * (TRACK_HEIGHT + TRACK_GAP);
    const baseline = trackTop + TRACK_HEIGHT;
    const row = g.append("g");

    backgrounds
      .append("rect")
      .attr("x", MARGIN.left)
      .attr("y", trackTop)
      .attr("width", width - MARGIN.left - MARGIN.right)
      .attr("height", TRACK_HEIGHT)
      .attr("fill", i % 2 ? "#f8fafc" : "#ffffff");

    row
      .append("line")
      .attr("x1", MARGIN.left)
      .attr("x2", width - MARGIN.right)
      .attr("y1", baseline)
      .attr("y2", baseline)
      .attr("stroke", "#cbd5e1");

    const cells = cellCounts.value.get(group);
    row
      .append("text")
      .attr("x", MARGIN.left - 10)
      .attr("y", trackTop + TRACK_HEIGHT / 2 + 6)
      .attr("text-anchor", "end")
      .attr("font-size", 16)
      .attr("fill", "#1a202c")
      .text(truncate(group, 18))
      .append("title")
      .text(cells ? `${group} (${cells.toLocaleString()} cells)` : group);

    row
      .selectAll("rect.peak")
      .data(byGroup.get(group) || [])
      .join("rect")
      .attr("class", "peak")
      .attr("x", (d) => x(Math.max(d.start, v.start)))
      .attr("width", (d) => Math.max(1.5, x(Math.min(d.end, v.end)) - x(Math.max(d.start, v.start))))
      .attr("y", (d) => baseline - y(signalValue(d)))
      .attr("height", (d) => Math.max(0.5, y(signalValue(d))))
      .attr("fill", color(group))
      .append("title")
      .text(
        (d) =>
          `${group}\n${v.chrom}:${formatBp(d.start)}–${formatBp(d.end)}\n${formatSignal(signalValue(d))} ${unit}`
      );
  });

  // One shared scale for all tracks, so heights compare across groups
  svg
    .append("text")
    .attr("x", width - MARGIN.right)
    .attr("y", top - 3)
    .attr("text-anchor", "end")
    .attr("font-size", 16)
    .attr("fill", "#64748b")
    .text(`Scale: 0–${formatSignal(yMax)} ${unit} (same for all tracks)`);
}

// Signac-style arcs from the gene's TSS to each linked peak
function drawLinkArcs(svg, x, clampX, top, width, v, links) {
  const baseline = top + LINK_ROW_HEIGHT - 8;
  const tss = v.gene.strand === "-" ? v.gene.end : v.gene.start;
  const corrMax = d3.max(links, (l) => Math.abs(l.correlation ?? 0)) || 1;
  const g = svg.append("g").attr("class", "links");

  g.append("text")
    .attr("x", MARGIN.left - 10)
    .attr("y", baseline - 8)
    .attr("text-anchor", "end")
    .attr("font-size", 16)
    .attr("font-weight", 600)
    .attr("fill", "#1a202c")
    .text("Links");

  g.append("line")
    .attr("x1", MARGIN.left)
    .attr("x2", width - MARGIN.right)
    .attr("y1", baseline)
    .attr("y2", baseline)
    .attr("stroke", "#e2e8f0");

  g.selectAll("path")
    .data(links)
    .join("path")
    .attr("d", (l) => {
      const x1 = clampX(tss);
      const x2 = clampX((l.start + l.end) / 2);
      const h = Math.min(LINK_ROW_HEIGHT - 14, 8 + Math.abs(x2 - x1) / 3);
      return `M${x1},${baseline} Q${(x1 + x2) / 2},${baseline - 2 * h} ${x2},${baseline}`;
    })
    .attr("fill", "none")
    .attr("stroke", (l) => ((l.correlation ?? 0) < 0 ? "#3b82f6" : LINK_COLOR))
    .attr("stroke-width", (l) => 1 + 2 * (Math.abs(l.correlation ?? 0) / corrMax))
    .attr("opacity", 0.85)
    .append("title")
    .text((l) => linkTooltip(v, l));
}

function linkTooltip(v, l) {
  const corr = l.correlation == null ? "n/a" : l.correlation.toFixed(3);
  return `Linked peak for ${v.gene.name}\n${v.chrom}:${formatBp(l.start)}–${formatBp(l.end)}\nCorrelation: ${corr}`;
}

function sortGroups(list) {
  return [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatBp(value) {
  return Math.round(value).toLocaleString();
}

function formatSignal(value) {
  if (value >= 100) return Math.round(value).toLocaleString();
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}
</script>

<style scoped>
.chromatin-container {
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
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  flex-shrink: 0;
}

.label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
  white-space: nowrap;
}

.gene-expression-label {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
}

.select {
  padding: 4px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 2px;
  font-size: 16px;
  background: white;
  color: #1a202c;
  cursor: pointer;
}

.select:hover {
  border-color: #cbd5e1;
}

.select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
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
  font-size: 16px;
  background: white;
  color: #1a202c;
  min-width: 0;
  box-sizing: border-box;
}

.gene-input::placeholder {
  font-size: 16px;
}

.gene-input:hover {
  border-color: #cbd5e1;
}

.gene-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.visualize-btn {
  padding: 4px 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 2px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}

.visualize-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
}

.visualize-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
  opacity: 0.7;
  transform: none;
  box-shadow: none;
}

.plot-type-toggle {
  display: flex;
  gap: 0;
}

.toggle-btn {
  padding: 3px 10px;
  background: white;
  border: 1px solid #cbd5e1;
  margin-left: -1px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
}

.toggle-btn:hover:not(:disabled) {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.toggle-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle-btn.active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: #667eea;
  color: white;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 16px;
  font-weight: 500;
  color: #1a202c;
  cursor: pointer;
  white-space: nowrap;
}

.checkbox-label.disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
}

.hint {
  margin: -12px 0 0;
  font-size: 16px;
  color: #64748b;
  line-height: 1.4;
}

.plot-container {
  flex: 1;
  min-width: 0;
  position: relative;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.region-label {
  padding: 6px 10px 0;
  font-size: 16px;
  color: #475569;
  flex-shrink: 0;
}

.link-summary {
  color: #64748b;
}

.region-label strong {
  color: #667eea;
  margin-right: 6px;
}

.plot-message {
  padding: 12px;
  font-size: 16px;
  color: #4b5563;
  flex-shrink: 0;
}

.svg-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.plot-svg {
  display: block;
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
  font-size: 16px;
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
