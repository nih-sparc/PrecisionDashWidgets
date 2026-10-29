<template>
  <div class="pdw-theme chromatin-container">
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
                class="visualize-btn pdw-btn pdw-btn--primary"
              >
                {{ dataLoading ? "Loading..." : "Visualize" }}
              </button>
            </div>
          </label>

          <label class="label">
            Region around gene:
            <select v-model="flank" class="select">
              <option
                v-for="opt in FLANK_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                :disabled="opt.value === 'links' && !available.links"
              >
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
            <SegmentedToggle
              v-model="signalMode"
              aria-label="Signal"
              :options="[
                {
                  key: 'normalized',
                  label: 'Normalized',
                  title: 'Mean counts per cell, so groups of different sizes are comparable',
                },
                {
                  key: 'raw',
                  label: 'Raw',
                  disabled: !hasCellCounts,
                  title: 'Total counts in the group (larger groups have higher signal)',
                },
              ]"
            />
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
            Show linked peaks
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
          <div
            v-if="tip"
            class="chart-tooltip"
            :style="{ left: `${tip.x}px`, top: `${tip.y}px` }"
            @mouseenter="keepTip"
            @mouseleave="hideTipSoon"
          >
            <div class="tip-title">{{ tip.title }}</div>
            <div v-for="(line, i) in tip.lines" :key="i" class="tip-line">{{ line }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import SegmentedToggle from "../shared/SegmentedToggle.vue";
import { ref, shallowRef, computed, onBeforeUnmount, watch, nextTick } from "vue";
import * as d3 from "d3";
import { useDatasetActiveConfig, useWidgetDataEngine } from "../../composables/useSharedDataEngine.js";
import { useKeepAliveGate } from "../../composables/useKeepAliveGate.js";
import {
  CORRELATION_SCALE_MAX,
  LINK_TYPES,
  NEGATIVE_COLOR,
  POSITIVE_COLOR,
  correlationStrength,
  filterLinks,
  formatDistance,
  formatPValue,
  hasLinkTypes,
  linkFilterOptions,
  samePeak,
} from "../LinkedPeaksTable/linkedPeaks.js";

const props = defineProps({
  dataPath: { type: String, default: "/data" },
  gene: { type: String, default: null },
  // Selected linked peak ({ gene, chrom, start, end }), from an arc or the linked peaks table
  focus: { type: Object, default: null },
  // The Linked Peaks table's filters; arcs show the same links as the table
  linkFilters: { type: Object, default: null },
  config: { type: Object, default: null },
});

const emit = defineEmits(["update:Vars", "select-peak"]);

const { runWhenActive, observeResize } = useKeepAliveGate();
const injectedConfig = useDatasetActiveConfig();
const activeConfig = computed(() => props.config || injectedConfig.value || {});

const FLANK_OPTIONS = [
  { value: 2000, label: "± 2 kb" },
  { value: 10000, label: "± 10 kb" },
  { value: 50000, label: "± 50 kb" },
  { value: 100000, label: "± 100 kb" },
  { value: 250000, label: "± 250 kb" },
  // LinkPeaks searches ±500 kb from the TSS; ~30% of links are beyond 250 kb
  { value: 500000, label: "± 500 kb" },
  { value: "links", label: "All linked peaks" },
];
// "All linked peaks": padding around the outermost link, and the region used when the gene
// has none
const LINKS_PADDING = 5000;
const NO_LINKS_FLANK = 50000;

// Tracks are precomputed per cell type only; other groupings need processor support
const GROUP_OPTIONS = [
  { value: "cell_type", label: "Cell type", available: true },
  { value: "cluster", label: "Cluster", available: false },
  { value: "donor", label: "Donor", available: false },
];

const TRACK_HEIGHT = 34;
const TRACK_GAP = 4;
const GENE_LANE_HEIGHT = 34;
const LINK_ROW_HEIGHT = 70;
const MARGIN = { top: 34, right: 20, bottom: 12, left: 190 };
// The target gene and focused peak use the theme's primary color (--pdw-primary), read
// at draw time: SVG fill/stroke attributes can't reference CSS variables
const DEFAULT_ACCENT = "#667eea";
let accentColor = DEFAULT_ACCENT;
const OTHER_GENE_COLOR = "#94a3b8";
// Unique ids for SVG clip paths when several chromatin views are on a page
let instanceCount = 0;
const clipId = `chromatin-links-clip-${++instanceCount}`;

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

// Hover card for arcs (and tracks): { x, y, title, lines }
const tip = shallowRef(null);

let searchTimeout = null;
let tipTimeout = null;
let resizeObserver = null;
let loadSeq = 0;

// The links the table's filters keep
const shownLinks = computed(() => {
  const links = view.value?.links || [];
  return filterLinks(links, linkFilterOptions(props.linkFilters, links));
});

const linkSummary = computed(() => {
  const v = view.value;
  const links = v?.links || [];
  if (!links.length) return `No linked peaks for ${v.gene.name}.`;
  const shown = shownLinks.value;
  const outside = shown.filter((l) => l.end < v.start || l.start > v.end).length;
  let text = `${shown.length} linked peak${shown.length === 1 ? "" : "s"}`;
  if (shown.length !== links.length) text += ` (of ${links.length}; the rest are hidden by the Linked Peaks filters)`;
  if (outside) text += ` · ${outside} outside this region, marked at the edges`;
  return text;
});

// The gene is shared with the Linked Peaks panel; names compare case-insensitively, as there
watch(
  () => props.gene,
  (newVal) => {
    if (newVal && newVal.toUpperCase() !== selectedGene.value.toUpperCase()) {
      selectedGene.value = newVal;
      geneSearch.value = newVal;
      if (manager.value) runWhenActive(loadRegion);
    }
  }
);

watch(selectedGene, (newVal) => {
  if (newVal) emit("update:Vars", "selectedGene", newVal);
});

// Selecting a peak only emphasizes it; the view stays where it is
watch(
  () => props.focus,
  () => {
    if (view.value) runWhenActive(draw);
  }
);

watch(
  () => props.linkFilters,
  () => {
    if (view.value) runWhenActive(draw);
  },
  { deep: true }
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
  clearTimeout(tipTimeout);
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
    const links = available.value.links ? await manager.value.getLinksForGene(gene.name) : [];
    if (seq !== loadSeq) return;
    let { start, end } = regionAround(gene, links);
    start = Math.max(0, start);
    const [genes, signal] = await Promise.all([
      manager.value.getGenesInRegion(gene.chrom, start, end),
      manager.value.getChromatinSignal(gene.chrom, start, end),
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

// The gene plus the chosen flank, or every linked peak for "All linked peaks"
function regionAround(gene, links) {
  if (flank.value !== "links") return { start: gene.start - flank.value, end: gene.end + flank.value };
  if (!links.length) return { start: gene.start - NO_LINKS_FLANK, end: gene.end + NO_LINKS_FLANK };
  return {
    start: Math.min(gene.start, ...links.map((l) => l.start)) - LINKS_PADDING,
    end: Math.max(gene.end, ...links.map((l) => l.end)) + LINKS_PADDING,
  };
}

function signalValue(d) {
  if (signalMode.value === "normalized") return d.signal;
  return d.signal * (cellCounts.value.get(d.group) || 0);
}

function draw() {
  const svgEl = plotSvg.value;
  if (!svgEl) return;
  accentColor = getComputedStyle(svgEl).getPropertyValue("--pdw-primary").trim() || DEFAULT_ACCENT;
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  // The hovered element is gone, so its mouseleave will never fire
  hideTip();

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
  const showLinks = highlightLinks.value && available.value.links;
  // Links sit right under the genes, so they're visible without scrolling past the tracks
  const linkRowTop = MARGIN.top + geneRowHeight + 4;
  const tracksTop = linkRowTop + (showLinks ? LINK_ROW_HEIGHT : 0) + 20;
  const tracksHeight = groups.value.length * (TRACK_HEIGHT + TRACK_GAP);
  const tracksBottom = tracksTop + tracksHeight;
  const height = tracksBottom + MARGIN.bottom;

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
    .call((axis) => axis.selectAll("text").attr("font-size", 14));

  // Band behind the tracks for the hovered link (drawn on hover, under everything else)
  const hoverBand = svg.append("g").attr("class", "hover-band");
  const showBand = (l) => {
    hoverBand.selectAll("*").remove();
    if (!l || l.end < v.start || l.start > v.end) return;
    hoverBand
      .append("rect")
      .attr("x", clampX(l.start) - 2)
      .attr("width", Math.max(4, clampX(l.end) - clampX(l.start) + 4))
      .attr("y", MARGIN.top)
      .attr("height", tracksBottom - MARGIN.top)
      .attr("fill", linkColor(l))
      .attr("opacity", 0.18);
  };

  drawFocus(svg, x, clampX, tracksBottom, v);
  drawGeneModel(svg, lanes, x, clampX, v);
  drawTracks(svg, x, tracksTop, width, v);
  if (showLinks) drawLinkArcs(svg, x, linkRowTop, width, v, shownLinks.value, showBand);
}

// Outline the selected linked peak
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
    .attr("fill", accentColor)
    .attr("fill-opacity", 0.08)
    .attr("stroke", accentColor)
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
      const color = isTarget ? accentColor : OTHER_GENE_COLOR;
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
        .attr("font-size", 14)
        .attr("font-weight", isTarget ? 700 : 400)
        .attr("fill", isTarget ? accentColor : "#475569")
        .text(gene.name);
    }
  });

  svg
    .append("text")
    .attr("x", MARGIN.left - 10)
    .attr("y", MARGIN.top + GENE_LANE_HEIGHT / 2 + 6)
    .attr("text-anchor", "end")
    .attr("font-size", 14)
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
      .attr("font-size", 14)
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
    .attr("font-size", 14)
    .attr("fill", "#64748b")
    .text(`Scale: 0–${formatSignal(yMax)} ${unit} (same for all tracks)`);
}

// Signac-style arcs from the gene's TSS to each linked peak. Width and opacity follow |r| on
// the same fixed scale as the table's bars; color is the sign. Arcs to peaks outside the
// region run to the plot edge (clipped), and edge markers count them.
function drawLinkArcs(svg, x, top, width, v, links, showBand) {
  const baseline = top + LINK_ROW_HEIGHT - 8;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const tssX = x(geneTss(v.gene));
  const g = svg.append("g").attr("class", "links");

  // Row label and color key in the left margin
  g.append("text")
    .attr("x", left - 10)
    .attr("y", top + 16)
    .attr("text-anchor", "end")
    .attr("font-size", 14)
    .attr("font-weight", 600)
    .attr("fill", "#1a202c")
    .text("Links")
    .append("title")
    .text(
      `Arcs join each linked peak to ${v.gene.name}'s TSS. Thicker, darker arcs have a larger |r| (scale 0–${CORRELATION_SCALE_MAX}).`
    );
  [
    ["r > 0", POSITIVE_COLOR],
    ["r < 0", NEGATIVE_COLOR],
  ].forEach(([label, color], i) => {
    const y = top + 36 + i * 18;
    g.append("line")
      .attr("x1", left - 82)
      .attr("x2", left - 62)
      .attr("y1", y - 5)
      .attr("y2", y - 5)
      .attr("stroke", color)
      .attr("stroke-width", 3);
    g.append("text")
      .attr("x", left - 10)
      .attr("y", y)
      .attr("text-anchor", "end")
      .attr("font-size", 14)
      .attr("fill", "#475569")
      .text(label);
  });

  g.append("line")
    .attr("x1", left)
    .attr("x2", right)
    .attr("y1", baseline)
    .attr("y2", baseline)
    .attr("stroke", "#e2e8f0");

  g.append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", left)
    .attr("y", top)
    .attr("width", right - left)
    .attr("height", LINK_ROW_HEIGHT);

  const arcPath = (l) => {
    const x2 = x(linkMid(l));
    const h = Math.min(LINK_ROW_HEIGHT - 16, 8 + Math.abs(x2 - tssX) / 3);
    return `M${tssX},${baseline} Q${(tssX + x2) / 2},${baseline - 2 * h} ${x2},${baseline}`;
  };
  // Strongest on top, the selected link above all
  const selected = links.find((l) => isFocused(v, l));
  const ordered = [...links].sort(
    (a, b) => (a === selected) - (b === selected) || correlationStrength(a.correlation) - correlationStrength(b.correlation)
  );
  const arcs = g.append("g").attr("clip-path", `url(#${clipId})`);

  if (selected) {
    arcs
      .append("path")
      .attr("d", arcPath(selected))
      .attr("fill", "none")
      .attr("stroke", accentColor)
      .attr("stroke-width", arcWidth(selected) + 5)
      .attr("opacity", 0.35);
  }

  const visible = arcs
    .append("g")
    .selectAll("path")
    .data(ordered)
    .join("path")
    .attr("d", arcPath)
    .attr("fill", "none")
    .attr("stroke", linkColor)
    .attr("stroke-width", arcWidth)
    .attr("opacity", (l) => (l === selected ? 1 : 0.35 + 0.65 * correlationStrength(l.correlation)));

  // Wide invisible strokes make thin arcs easy to hover and click
  arcs
    .append("g")
    .selectAll("path")
    .data(ordered)
    .join("path")
    .attr("d", arcPath)
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", 12)
    .style("pointer-events", "stroke")
    .style("cursor", "pointer")
    .on("mouseenter", (event, l) => {
      visible.attr("stroke-width", (d) => arcWidth(d) + (d === l ? 2 : 0));
      showBand(l);
      showTip(event, `Linked peak · ${v.gene.name}`, linkTipLines(v, l));
    })
    .on("mousemove", moveTip)
    .on("mouseleave", () => {
      visible.attr("stroke-width", arcWidth);
      showBand(null);
      hideTipSoon();
    })
    .on("click", (event, l) => selectPeak(v, l));

  drawEdgeMarkers(g, baseline, left, right, v, links);
}

// "◂ 3" / "3 ▸" at the plot edges for links outside the region; clicking fits all links.
// They sit on the baseline, below where the cut-off arcs leave the plot.
function drawEdgeMarkers(g, baseline, left, right, v, links) {
  const sides = [
    { side: "left", list: links.filter((l) => l.end < v.start), x: left + 4, anchor: "start" },
    { side: "right", list: links.filter((l) => l.start > v.end), x: right - 4, anchor: "end" },
  ];
  for (const { side, list, x: tx, anchor } of sides) {
    if (!list.length) continue;
    const label = side === "left" ? `◂ ${list.length} more` : `${list.length} more ▸`;
    const marker = g
      .append("g")
      .style("cursor", "pointer")
      .on("click", () => {
        hideTip();
        flank.value = "links";
      });
    const text = marker
      .append("text")
      .attr("x", tx)
      .attr("y", baseline - 6)
      .attr("text-anchor", anchor)
      .attr("font-size", 14)
      .attr("font-weight", 600)
      .attr("fill", "#475569")
      .text(label);
    const box = text.node().getBBox();
    marker
      .insert("rect", "text")
      .attr("x", box.x - 4)
      .attr("y", box.y - 1)
      .attr("width", box.width + 8)
      .attr("height", box.height + 2)
      .attr("rx", 3)
      .attr("fill", "#ffffff")
      .attr("stroke", "#cbd5e1");
    marker
      .on("mouseenter", (event) =>
        showTip(
          event,
          `${list.length} linked peak${list.length === 1 ? "" : "s"} ${side} of this region`,
          [
            ...list
              .slice(0, 8)
              .map((l) => `${formatBp(l.start)} · r = ${formatR(l.correlation)} · ${formatDistance(l.distance)}`),
            ...(list.length > 8 ? [`…and ${list.length - 8} more`] : []),
            "Click to show all linked peaks",
          ]
        )
      )
      .on("mousemove", moveTip)
      .on("mouseleave", hideTipSoon);
  }
}

function selectPeak(v, l) {
  if (isFocused(v, l)) return emit("select-peak", null);
  emit("select-peak", { gene: v.gene.name, chrom: l.chrom, start: l.start, end: l.end });
}

function isFocused(v, l) {
  return samePeak(focusForGene(v.gene), l);
}

function geneTss(gene) {
  return gene.strand === "-" ? gene.end : gene.start;
}

function linkMid(l) {
  return (l.start + l.end) / 2;
}

function linkColor(l) {
  return (l.correlation ?? 0) < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR;
}

function arcWidth(l) {
  return 1 + 3 * correlationStrength(l.correlation);
}

function formatR(r) {
  return r == null ? "n/a" : r.toFixed(3);
}

function linkTipLines(v, l) {
  const lines = [`${l.chrom}:${formatBp(l.start)}–${formatBp(l.end)}`];
  if (l.end < v.start || l.start > v.end) lines.push("(outside the visible region)");
  if (hasLinkTypes([l])) {
    lines.push(`Type: ${LINK_TYPES.find((t) => t.value === l.linkType)?.label ?? l.linkType}`);
  }
  lines.push(`Distance: ${formatDistance(l.distance)}`);
  lines.push(`r = ${formatR(l.correlation)} · p = ${formatPValue(l.pValue)}`);
  lines.push(isFocused(v, l) ? "Click to clear the selection" : "Click to select");
  return lines;
}

// ---- Hover card. It lingers briefly so the pointer can move onto it.

function tipPosition(event) {
  const rect = plotContainer.value.getBoundingClientRect();
  const x = event.clientX - rect.left + 14;
  const y = event.clientY - rect.top + 14;
  return { x: Math.max(4, Math.min(x, rect.width - 300)), y };
}

function showTip(event, title, lines) {
  clearTimeout(tipTimeout);
  tip.value = { ...tipPosition(event), title, lines };
}

function moveTip(event) {
  if (tip.value) tip.value = { ...tip.value, ...tipPosition(event) };
}

function keepTip() {
  clearTimeout(tipTimeout);
}

function hideTipSoon() {
  clearTimeout(tipTimeout);
  tipTimeout = setTimeout(hideTip, 150);
}

function hideTip() {
  clearTimeout(tipTimeout);
  tip.value = null;
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

.select:hover {
  border-color: #cbd5e1;
}

.select:focus {
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

.gene-input:hover {
  border-color: #cbd5e1;
}

.gene-input:focus {
  outline: none;
  border-color: var(--pdw-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--pdw-primary) 10%, transparent);
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
  opacity: 0.6;
}

.checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--pdw-primary);
}

.hint {
  margin: -12px 0 0;
  font-size: 14px;
  color: var(--pdw-text-muted);
  line-height: var(--pdw-line-height);
}

.plot-container {
  flex: 1;
  min-width: 0;
  position: relative;
  background: var(--pdw-surface);
  border: 1px solid var(--pdw-border);
  border-radius: 2px;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.region-label {
  padding: 6px 10px 0;
  font-size: 14px;
  color: #475569;
  flex-shrink: 0;
}

.link-summary {
  color: var(--pdw-text-muted);
}

.region-label strong {
  color: var(--pdw-primary);
  margin-right: 6px;
}

.plot-message {
  padding: 12px;
  font-size: 14px;
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

.chart-tooltip {
  position: absolute;
  z-index: 20;
  max-width: 290px;
  padding: 6px 10px;
  background: var(--pdw-surface);
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.12);
  font-size: 14px;
  color: var(--pdw-text);
  pointer-events: auto;
}

.tip-title {
  font-weight: 600;
  margin-bottom: 2px;
}

.tip-line {
  color: var(--pdw-text-muted);
  white-space: nowrap;
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
