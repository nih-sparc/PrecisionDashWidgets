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
        <!-- Controls: what to show (gene, region), then how to show it -->
        <div class="controls">
          <div class="control-row">
            <label class="label gene-expression-label">
              Gene
              <div class="gene-input-wrapper">
                <input
                  v-model="geneSearch"
                  type="text"
                  placeholder="e.g. SCN10A"
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

            <label class="label" title="How much of the genome around the gene to show">
              Region:
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

            <!-- Only worth showing once the processor writes tracks for more than one grouping -->
            <label v-if="groupChoices > 1" class="label">
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
          </div>

          <div class="control-row">
            <label class="label" :title="currentSignal.title">
              Signal:
              <select v-model="signalMode" class="select">
                <option
                  v-for="opt in signalOptions"
                  :key="opt.key"
                  :value="opt.key"
                  :disabled="opt.disabled"
                >
                  {{ opt.label }}
                </option>
              </select>
              <span
                v-if="signalMode === 'rpm'"
                class="calc-badge"
                :title="`${SIGNAL_MODES[0].title} Reads in peaks per cell: ${depth?.readsColumn}.`"
              >Calc</span>
            </label>

            <label class="label" title="Which cell types' tracks come first">
              Order:
              <select v-model="trackOrder" class="select">
                <option v-for="opt in ORDER_OPTIONS" :key="opt.value" :value="opt.value" :title="opt.title">
                  {{ opt.label }}
                </option>
              </select>
            </label>

            <SegmentedToggle v-model="trackScale" aria-label="Track scale" :options="SCALE_OPTIONS" />
            <SegmentedToggle v-model="trackHeight" aria-label="Track height" :options="HEIGHT_OPTIONS" />

            <label
              class="checkbox-label"
              :class="{ disabled: !available.links }"
              :title="available.links ? 'Arcs from the gene\'s TSS to each linked peak' : 'Linked peaks aren\'t available for this dataset'"
            >
              <input
                v-model="highlightLinks"
                type="checkbox"
                class="checkbox"
                :disabled="!available.links"
              />
              Links
            </label>
          </div>
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
            <span class="strand-note">({{ strandNote(view.gene) }})</span>
            {{ view.chrom }}:{{ formatBp(view.start) }}–{{ formatBp(view.end) }}
            <template v-if="view.zoomed">
              <span class="zoom-note">· zoomed to ±5 kb around the selected peak</span>
              <button type="button" class="pdw-btn back-btn" @click="setZoom(null)">
                Back to full view
              </button>
            </template>
            <span v-else-if="available.links && highlightLinks" class="link-summary">· {{ linkSummary }}</span>
          </div>
          <div v-if="view" class="legend">
            <template v-if="available.links && highlightLinks">
              <span class="legend-item"><span class="swatch" :style="{ background: POSITIVE_COLOR }"></span>r &gt; 0</span>
              <span class="legend-item"><span class="swatch" :style="{ background: NEGATIVE_COLOR }"></span>r &lt; 0</span>
              <span :title="`Arc width and opacity follow |r| on a fixed 0–${CORRELATION_SCALE_MAX} scale`">
                thicker arc = larger |r|
              </span>
              <span class="legend-sep">·</span>
              <span title="Peaks not linked to this gene are drawn lighter">faded bars: not linked</span>
              <span class="legend-sep">·</span>
            </template>
            <span>{{ scaleNote }}</span>
          </div>
          <!-- Axis, genes and links stay in view while the tracks scroll -->
          <svg ref="headSvg" class="plot-svg"></svg>
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
            <div v-if="tip.actions?.length" class="tip-actions">
              <button
                v-for="action in tip.actions"
                :key="action.label"
                type="button"
                class="pdw-btn tip-action"
                @click="action.run"
              >
                {{ action.label }}
              </button>
            </div>
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
import { useWidgetDataEngine } from "../../composables/useSharedDataEngine.js";
import { useKeepAliveGate } from "../../composables/useKeepAliveGate.js";
import {
  SIGNAL_MODES,
  readsPerMillion,
  formatSignal,
  mostOpenByPeak,
  peakKey,
} from "../shared/chromatinSignal.js";
import {
  CORRELATION_SCALE_MAX,
  LINK_TYPES,
  formatBp as formatLength,
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
  // Peak to zoom to (±5 kb), or null for the full region
  zoom: { type: Object, default: null },
  config: { type: Object, default: null },
});

const emit = defineEmits(["update:Vars", "select-peak", "zoom-peak"]);

const { runWhenActive, observeResize } = useKeepAliveGate();

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

const HEIGHT_OPTIONS = [
  { key: 34, label: "Compact", title: "Short tracks: see more cell types at once" },
  { key: 64, label: "Tall", title: "Taller tracks, for reading small peaks" },
];
const SCALE_OPTIONS = [
  {
    key: "links",
    label: "Fit links",
    title:
      "One scale for all tracks, fitted to the linked peaks shown. Taller peaks elsewhere are " +
      "cut off (marked with a dark cap).",
  },
  {
    key: "shared",
    label: "Fit all",
    title: "One scale for all tracks, fitted to the tallest peak in view",
  },
  {
    key: "track",
    label: "Per track",
    title: "Each track scaled to its own maximum (shown at right): best for seeing the shape",
  },
];
const groupChoices = GROUP_OPTIONS.filter((o) => o.available).length;
const ORDER_OPTIONS = [
  {
    value: "links",
    label: "Most open at links",
    title: "Cell types with the most signal at the linked peaks shown come first",
  },
  { value: "signal", label: "Most signal in view", title: "By each cell type's highest peak in view" },
  { value: "alpha", label: "A–Z", title: "Alphabetical" },
];
// Arcs to peaks (or a TSS) outside the view are drawn this far past the plot edge and
// fade out toward that edge, so they read as "continues off screen"
const OFFSCREEN_REACH = 40;
// "Zoom to peak" shows this much on each side of the peak's center
const ZOOM_FLANK = 5000;
const TIP_WIDTH = 290;
const TRACK_GAP = 4;
// The target gene's lane has room for the TSS arrow; other genes' lanes are shorter
const GENE_LANE_HEIGHT = 52;
const OTHER_LANE_HEIGHT = 40;
const LINK_ROW_HEIGHT = 64;
const MIN_ARC_WIDTH = 8;
// Top margin holds the upstream/downstream labels and the axis. The left margin holds the
// row labels and is sized to them on each draw (fitLeftMargin).
const MARGIN = { top: 50, right: 16, bottom: 12, left: 150 };
// The target gene and focused peak use the theme's primary color (--pdw-primary), read
// at draw time: SVG fill/stroke attributes can't reference CSS variables
const DEFAULT_ACCENT = "#667eea";
let accentColor = DEFAULT_ACCENT;
const OTHER_GENE_COLOR = "#94a3b8";
// Unique ids for SVG clip paths when several chromatin views are on a page
let instanceCount = 0;
const instanceId = ++instanceCount;
const clipId = `chromatin-links-clip-${instanceId}`;
const fadeId = `chromatin-links-fade-${instanceId}`;

const plotSvg = ref(null);
const headSvg = ref(null);
const plotContainer = ref(null);
const manager = shallowRef(null);

const loading = ref(true);
const loadingText = ref("Loading data...");
const error = ref(null);
const dataLoading = ref(false);
const message = ref("");

const available = ref({ tracks: false, geneCoords: false, links: false });
const groups = ref([]);
// Cells and reads in peaks per cell type (dataManager.getChromatinDepth()), or null
const depth = shallowRef(null);
const signalOptions = computed(() =>
  SIGNAL_MODES.map((m) => ({
    ...m,
    disabled: m.key !== "mean" && !depth.value,
    title: m.key !== "mean" && !depth.value ? `${m.title} (Not available: no read counts per cell.)` : m.title,
  }))
);

const geneSearch = ref(props.gene || "");
const selectedGene = ref(props.gene || "");
const geneSuggestions = ref([]);
const flank = ref(50000);
const groupBy = ref("cell_type");
const signalMode = ref("rpm");
const currentSignal = computed(() => SIGNAL_MODES.find((m) => m.key === signalMode.value));
// Track scale, shown in the legend line (set when the tracks are drawn)
const scaleNote = ref("");
const trackScale = ref("links");
const trackOrder = ref("links");
const trackHeight = ref(HEIGHT_OPTIONS[0].key);
// Mirrors the zoom prop, so zooming also works without the store
const zoomPeak = shallowRef(props.zoom);
const highlightLinks = ref(true);

// { gene, chrom, start, end, genes, signal, links }
const view = shallowRef(null);

// Hover card for arcs (and tracks): { x, y, title, lines }
const tip = shallowRef(null);

let searchTimeout = null;
let tipTimeout = null;
let guideFrame = null;
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
  () => props.zoom,
  (peak) => {
    // Our own zoom coming back through the store is already applied
    if (peak === zoomPeak.value || (peak && zoomPeak.value && samePeak(peak, zoomPeak.value))) return;
    zoomPeak.value = peak;
    if (view.value && manager.value) runWhenActive(loadRegion);
  }
);

watch(
  () => props.linkFilters,
  () => {
    if (view.value) runWhenActive(draw);
  },
  { deep: true }
);

// A new region size leaves the zoomed view
watch(flank, () => {
  if (zoomPeak.value) setZoom(null);
  else if (view.value) runWhenActive(loadRegion);
});

watch([signalMode, highlightLinks, groupBy, trackScale, trackHeight, trackOrder], () =>
  runWhenActive(draw)
);

async function initWithViewer(viewerInstance) {
  try {
    manager.value = viewerInstance;
    loadingText.value = "Loading chromatin data...";
    available.value = await viewerInstance.loadChromatin();

    if (available.value.tracks) {
      groups.value = sortGroups(await viewerInstance.getChromatinGroups());
      depth.value = viewerInstance.getChromatinDepth();
      if (!depth.value) signalMode.value = "mean";
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
  if (guideFrame) cancelAnimationFrame(guideFrame);
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

// The focused (selected) peak, if it belongs to this gene
function focusForGene(gene) {
  return peakForGene(props.focus, gene);
}

function peakForGene(peak, gene) {
  if (!peak || !gene || String(peak.gene).toUpperCase() !== gene.name.toUpperCase()) return null;
  const bare = (c) => String(c).replace(/^chr/i, "");
  return bare(peak.chrom) === bare(gene.chrom) ? peak : null;
}

// Zoom to a peak (±5 kb), or null to go back to the full region
function setZoom(peak) {
  hideTip();
  zoomPeak.value = peak;
  emit("zoom-peak", peak);
  runWhenActive(loadRegion);
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
    const zoomed = peakForGene(zoomPeak.value, gene);
    let { start, end } = zoomed
      ? { start: linkMid(zoomed) - ZOOM_FLANK, end: linkMid(zoomed) + ZOOM_FLANK }
      : regionAround(gene, links);
    start = Math.max(0, start);
    const [genes, signal] = await Promise.all([
      manager.value.getGenesInRegion(gene.chrom, start, end),
      manager.value.getChromatinSignal(gene.chrom, start, end),
    ]);
    if (seq !== loadSeq) return;
    view.value = { gene, chrom: gene.chrom, start, end, genes, signal, links, zoomed };
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
  const group = depth.value?.groups.get(d.group);
  if (signalMode.value === "rpm") return readsPerMillion(d.signal, group) ?? 0;
  if (signalMode.value === "total") return d.signal * (group?.cells || 0);
  return d.signal;
}

function draw() {
  const svgEl = plotSvg.value;
  const headEl = headSvg.value;
  if (!svgEl || !headEl) return;
  accentColor = getComputedStyle(svgEl).getPropertyValue("--pdw-primary").trim() || DEFAULT_ACCENT;
  const svg = d3.select(svgEl);
  const head = d3.select(headEl);
  svg.selectAll("*").remove();
  head.selectAll("*").remove();
  // The hovered element is gone, so its mouseleave will never fire
  hideTip();

  const v = view.value;
  if (!v) {
    svg.attr("height", 0);
    head.attr("height", 0);
    return;
  }

  const width = Math.max(300, plotContainer.value?.clientWidth || 0) - 2;
  fitLeftMargin(svgEl, width);
  const x = d3
    .scaleLinear()
    .domain([v.start, v.end])
    .range([MARGIN.left, width - MARGIN.right]);
  const clampX = (pos) => Math.max(MARGIN.left, Math.min(width - MARGIN.right, x(pos)));

  // Header: axis, genes and links
  const lanes = assignLanes(v.genes, clampX, v.gene.name);
  const geneRowHeight = laneTop(Math.max(1, lanes.length)) - MARGIN.top;
  const showLinks = highlightLinks.value && available.value.links;
  const linkRowTop = MARGIN.top + geneRowHeight + 4;
  const headHeight = linkRowTop + (showLinks ? LINK_ROW_HEIGHT : 0) + 4;
  head.attr("width", width).attr("height", headHeight);

  // Tracks, in their own scrolling svg
  const order = orderGroups(v);
  const tracksTop = 4;
  const tracksBottom = tracksTop + order.length * (trackHeight.value + TRACK_GAP);
  svg.attr("width", width).attr("height", tracksBottom + MARGIN.bottom);

  const span = v.end - v.start;
  const decimals = span < 20000 ? 3 : 2;
  head
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

  drawDirectionLabels(head, width, v);

  // Band through genes, links and tracks for the hovered link, under everything else
  const bands = [
    [head.append("g").attr("class", "hover-band"), MARGIN.top, headHeight],
    [svg.append("g").attr("class", "hover-band"), 0, tracksBottom],
  ];
  const showBand = (l) => {
    for (const [layer, top, bottom] of bands) {
      layer.selectAll("*").remove();
      if (!l || l.end < v.start || l.start > v.end) continue;
      layer
        .append("rect")
        .attr("x", clampX(l.start) - 2)
        .attr("width", Math.max(4, clampX(l.end) - clampX(l.start) + 4))
        .attr("y", top)
        .attr("height", bottom - top)
        .attr("fill", linkColor(l))
        .attr("opacity", 0.18);
    }
  };

  drawFocus(head, clampX, MARGIN.top, headHeight, v);
  drawFocus(svg, clampX, 0, tracksBottom, v);
  drawGeneModel(head, lanes, x, clampX, v);
  drawTracks(svg, x, tracksTop, width, v, order);
  drawHoverGuide(svg, x, tracksTop, tracksBottom, width, v, order);
  // Zoomed in, arcs of other peaks would only cross the view as flat lines
  const arcLinks = v.zoomed
    ? shownLinks.value.filter((l) => l.end >= v.start && l.start <= v.end)
    : shownLinks.value;
  if (showLinks) drawLinkArcs(head, x, linkRowTop, width, v, arcLinks, showBand);
}

// Track order: by signal at the linked peaks shown (the cell types the links are about),
// by the highest peak in view, or alphabetical. Ties fall back to alphabetical.
function orderGroups(v) {
  const alpha = groups.value;
  if (trackOrder.value === "alpha") return alpha;
  const score = new Map(alpha.map((g) => [g, 0]));
  if (trackOrder.value === "links" && shownLinks.value.length) {
    const linked = new Set(shownLinks.value.map((l) => `${l.start}-${l.end}`));
    for (const d of v.signal) {
      if (linked.has(`${d.start}-${d.end}`)) score.set(d.group, score.get(d.group) + signalValue(d));
    }
  }
  // No links (or none in view): fall back to the highest peak in view
  if (![...score.values()].some((s) => s > 0)) {
    for (const d of v.signal) score.set(d.group, Math.max(score.get(d.group) ?? 0, signalValue(d)));
  }
  return [...alpha].sort((a, b) => score.get(b) - score.get(a));
}

// Outline the selected linked peak
function drawFocus(svg, clampX, top, bottom, v) {
  const f = focusForGene(v.gene);
  if (!f || f.end < v.start || f.start > v.end) return;
  const x1 = clampX(f.start) - 3;
  const width = Math.max(6, clampX(f.end) - clampX(f.start) + 6);
  const g = svg.append("g").attr("class", "focus");
  g.append("rect")
    .attr("x", x1)
    .attr("width", width)
    .attr("y", top)
    .attr("height", bottom - top)
    .attr("fill", accentColor)
    .attr("fill-opacity", 0.08)
    .attr("stroke", accentColor)
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "4 3");
  g.append("title").text(`Selected peak\n${v.chrom}:${formatBp(f.start)}–${formatBp(f.end)}`);
}

// Pack genes (with their labels) into as few rows as possible. The target gene goes first,
// in the top row; each other gene takes the first row where it overlaps nothing.
function assignLanes(genes, clampX, targetName) {
  const sorted = [...genes].sort((a, b) =>
    a.name === targetName ? -1 : b.name === targetName ? 1 : a.start - b.start
  );
  const occupied = []; // per lane: [[left, right], ...]
  const lanes = [];
  for (const gene of sorted) {
    const x1 = clampX(gene.start);
    const x2 = clampX(gene.end);
    const half = labelWidth(gene.name) / 2;
    const left = Math.min(x1, (x1 + x2) / 2 - half) - 6;
    const right = Math.max(x2, (x1 + x2) / 2 + half) + 6;
    let lane = occupied.findIndex((spans) => spans.every(([l, r]) => right < l || left > r));
    if (lane === -1) {
      lane = occupied.length;
      occupied.push([]);
      lanes.push([]);
    }
    occupied[lane].push([left, right]);
    lanes[lane].push(gene);
  }
  return lanes;
}

// Top of gene lane i (lane 0 is the target gene's, taller for the TSS arrow)
function laneTop(i) {
  return MARGIN.top + (i > 0 ? GENE_LANE_HEIGHT + (i - 1) * OTHER_LANE_HEIGHT : 0);
}

// Vertical center of the gene line in lane i
function laneMid(i) {
  return laneTop(i) + (i === 0 ? 24 : 12);
}

// Left margin just wide enough for the longest row label (cell types, "Genes"), so the
// plot gets the rest of the width
let measureCtx = null;
function fitLeftMargin(svgEl, width) {
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  measureCtx.font = `14px ${getComputedStyle(svgEl).fontFamily}`;
  const labels = ["Genes", "Links", ...groups.value.map((g) => truncate(g, 18))];
  const widest = Math.max(...labels.map((t) => measureCtx.measureText(t).width));
  MARGIN.left = Math.round(Math.min(Math.max(widest + 20, 70), width * 0.3));
}

// Rough width of a 14px label, for lane packing
function labelWidth(text) {
  return text.length * 8;
}

// The axis isn't flipped for minus-strand genes, so say which side is upstream of the gene
function drawDirectionLabels(svg, width, v) {
  const minus = v.gene.strand === "-";
  const g = svg.append("g").attr("class", "direction");
  g.append("title").text(
    `Relative to ${v.gene.name}, which is transcribed ${minus ? "right to left" : "left to right"}`
  );
  [
    [MARGIN.left, "start", minus ? "← downstream" : "← upstream"],
    [width - MARGIN.right, "end", minus ? "upstream →" : "downstream →"],
  ].forEach(([x, anchor, text]) =>
    g
      .append("text")
      .attr("x", x)
      .attr("y", 16)
      .attr("text-anchor", anchor)
      .attr("font-size", 14)
      .attr("fill", "#64748b")
      .text(text)
  );
}

function strandNote(gene) {
  return gene.strand === "-" ? "− strand, reads right to left" : "+ strand, reads left to right";
}

// Bent arrow at the TSS pointing the way the gene is transcribed
function drawTssArrow(parent, gene, x, mid, color, v) {
  const tss = geneTss(gene);
  if (tss < v.start || tss > v.end) return;
  const g = parent.append("g").attr("class", "tss-arrow");
  const dir = gene.strand === "-" ? -1 : 1;
  const x0 = x(tss);
  const top = mid - 20;
  const tip = x0 + 16 * dir;
  g.append("path")
    .attr("d", `M${x0},${mid - 8} V${top} H${tip}`)
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", 2);
  g.append("path")
    .attr("d", `M${tip},${top - 5} L${tip + 7 * dir},${top} L${tip},${top + 5} Z`)
    .attr("fill", color);
  g.append("title").text(`${gene.name} TSS (transcription start), ${gene.chrom}:${formatBp(tss)}`);
}

function drawGeneModel(svg, lanes, x, clampX, v) {
  const g = svg.append("g").attr("class", "gene-model");
  if (!lanes.length) {
    g.append("text")
      .attr("x", MARGIN.left + 4)
      .attr("y", laneMid(0) + 5)
      .attr("font-size", 14)
      .attr("fill", "#94a3b8")
      .text("No genes in this window");
  }
  lanes.forEach((lane, i) => {
    // Room above the target gene for the TSS arrow, below each gene for its label
    const mid = laneMid(i);
    for (const gene of lane) {
      const isTarget = gene.name === v.gene.name;
      const color = isTarget ? accentColor : OTHER_GENE_COLOR;
      const x1 = clampX(gene.start);
      const x2 = clampX(gene.end);
      const geneG = g.append("g");
      const dir = gene.strand === "-" ? -1 : 1;

      // Intron line, with a wide invisible copy for hovering
      geneG
        .append("line")
        .attr("x1", x1)
        .attr("x2", x2)
        .attr("y1", mid)
        .attr("y2", mid)
        .attr("stroke", color)
        .attr("stroke-width", 1.5);

      // Strand chevrons along the introns (exons are drawn over them)
      for (let cx = x1 + 14; cx < x2 - 8; cx += 28) {
        geneG
          .append("path")
          .attr("d", `M${cx - 5 * dir},${mid - 5} L${cx},${mid} L${cx - 5 * dir},${mid + 5}`)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1.8);
      }

      geneG
        .append("line")
        .attr("x1", x1)
        .attr("x2", x2)
        .attr("y1", mid)
        .attr("y2", mid)
        .attr("stroke", "transparent")
        .attr("stroke-width", 14)
        .on("mouseenter", (event) => showTip(event, gene.name, geneTipLines(gene)))
        .on("mousemove", moveTip)
        .on("mouseleave", hideTipSoon);

      // Exons, much taller than the intron line. Numbered in transcription order, so on
      // the minus strand exon 1 is the rightmost.
      const total = gene.exons.length;
      geneG
        .selectAll("rect")
        .data(
          gene.exons
            .map(([start, end], idx) => ({ start, end, number: dir === 1 ? idx + 1 : total - idx }))
            .filter((e) => e.end >= v.start && e.start <= v.end)
        )
        .join("rect")
        .attr("x", (e) => clampX(e.start))
        .attr("width", (e) => Math.max(2, clampX(e.end) - clampX(e.start)))
        .attr("y", mid - 8)
        .attr("height", 16)
        .attr("fill", color)
        .on("mouseenter", (event, e) =>
          showTip(event, gene.name, [
            `Exon ${e.number} of ${total} (merged across all transcripts)`,
            `${gene.chrom}:${formatBp(e.start)}–${formatBp(e.end)}`,
            `${formatBp(e.end - e.start + 1)} bp`,
          ])
        )
        .on("mousemove", moveTip)
        .on("mouseleave", hideTipSoon);

      if (isTarget) drawTssArrow(geneG, gene, x, mid, color, v);

      // Label centered under the visible part of the gene
      geneG
        .append("text")
        .attr("x", (x1 + x2) / 2)
        .attr("y", mid + 26)
        .attr("text-anchor", "middle")
        .attr("font-size", 14)
        .attr("font-weight", isTarget ? 700 : 400)
        .attr("fill", isTarget ? accentColor : "#475569")
        .text(gene.name);
    }
  });

  svg
    .append("text")
    .attr("x", MARGIN.left - 10)
    .attr("y", laneMid(0) + 5)
    .attr("text-anchor", "end")
    .attr("font-size", 14)
    .attr("font-weight", 600)
    .attr("fill", "#1a202c")
    .text("Genes");
}

function geneTipLines(gene) {
  return [
    strandNote(gene),
    `${gene.chrom}:${formatBp(gene.start)}–${formatBp(gene.end)}`,
    `${gene.exons.length} exon${gene.exons.length === 1 ? "" : "s"} (merged across all transcripts)`,
  ];
}

function drawTracks(svg, x, top, width, v, order) {
  const height = trackHeight.value;
  const byGroup = d3.group(v.signal, (d) => d.group);
  const perTrack = trackScale.value === "track";
  const allMax = d3.max(v.signal, signalValue) || 1;
  // "Fit links": the tallest signal at a linked peak in view, so the linked peaks fill the
  // tracks instead of being dwarfed by unlinked ones (which are cut off and capped)
  const linked = new Set(shownLinks.value.map((l) => `${l.start}-${l.end}`));
  const linksMax = d3.max(
    v.signal.filter((d) => linked.has(`${d.start}-${d.end}`)),
    signalValue
  );
  const fitLinks = trackScale.value === "links" && linksMax > 0;
  const showingLinks = highlightLinks.value && available.value.links && linked.size > 0;
  const yMax = fitLinks ? linksMax : allMax;
  // Colors follow the cell type, not its position, so reordering keeps them
  const color = d3.scaleOrdinal(d3.schemeTableau10).domain(groups.value);
  const unit = SIGNAL_MODES.find((m) => m.key === signalMode.value).unit;

  // Row backgrounds go underneath everything so link and focus highlights stay visible
  const backgrounds = svg.insert("g", ":first-child").attr("class", "track-backgrounds");
  const g = svg.append("g").attr("class", "tracks");
  order.forEach((group, i) => {
    const trackTop = top + i * (height + TRACK_GAP);
    const baseline = trackTop + height;
    const row = g.append("g");
    const peaks = byGroup.get(group) || [];
    const groupMax = d3.max(peaks, signalValue) || 0;
    const y = d3
      .scaleLinear()
      .domain([0, perTrack ? groupMax || 1 : yMax])
      .range([0, height - 4]);

    backgrounds
      .append("rect")
      .attr("x", MARGIN.left)
      .attr("y", trackTop)
      .attr("width", width - MARGIN.left - MARGIN.right)
      .attr("height", height)
      .attr("fill", i % 2 ? "#f8fafc" : "#ffffff");

    row
      .append("line")
      .attr("x1", MARGIN.left)
      .attr("x2", width - MARGIN.right)
      .attr("y1", baseline)
      .attr("y2", baseline)
      .attr("stroke", "#cbd5e1");

    const cells = depth.value?.groups.get(group)?.cells;
    row
      .append("text")
      .attr("x", MARGIN.left - 10)
      .attr("y", trackTop + height / 2 + 6)
      .attr("text-anchor", "end")
      .attr("font-size", 14)
      .attr("fill", "#1a202c")
      .text(truncate(group, 18))
      .append("title")
      .text(cells ? `${group} (${cells.toLocaleString()} cells)` : group);

    row
      .selectAll("rect.peak")
      .data(peaks)
      .join("rect")
      .attr("class", "peak")
      .attr("x", (d) => x(Math.max(d.start, v.start)))
      .attr("width", (d) => Math.max(1.5, x(Math.min(d.end, v.end)) - x(Math.max(d.start, v.start))))
      .attr("y", (d) => baseline - Math.min(height - 4, y(signalValue(d))))
      .attr("height", (d) => Math.max(0.5, Math.min(height - 4, y(signalValue(d)))))
      .attr("fill", color(group))
      // With links on, peaks that aren't linked to the gene are faded so the linked ones stand out
      .attr("opacity", (d) => (!showingLinks || linked.has(`${d.start}-${d.end}`) ? 1 : 0.35));

    // Peaks taller than the scale are cut off; a dark cap says so
    if (fitLinks) {
      row
        .selectAll("rect.clipped")
        .data(peaks.filter((d) => signalValue(d) > yMax))
        .join("rect")
        .attr("class", "clipped")
        .attr("x", (d) => x(Math.max(d.start, v.start)))
        .attr("width", (d) => Math.max(1.5, x(Math.min(d.end, v.end)) - x(Math.max(d.start, v.start))))
        .attr("y", baseline - (height - 4) - 1)
        .attr("height", 3)
        .attr("fill", "#1e293b");
    }

    // Per-track scales differ, so each track says what its full height means
    if (perTrack) {
      row
        .append("text")
        .attr("x", width - MARGIN.right - 4)
        .attr("y", trackTop + 14)
        .attr("text-anchor", "end")
        .attr("font-size", 14)
        .attr("fill", "#475569")
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 3)
        .attr("paint-order", "stroke")
        .text(groupMax ? `max ${formatSignal(groupMax)}` : "no signal");
    }
  });

  if (perTrack) scaleNote.value = `Tracks: each scaled to its own max (${unit})`;
  else if (fitLinks) {
    scaleNote.value =
      `Tracks: 0–${formatSignal(yMax)} ${unit}, fitted to the linked peaks` +
      (allMax > yMax ? ` (taller peaks, up to ${formatSignal(allMax)}, are cut off at a dark cap)` : "");
  } else scaleNote.value = `Tracks: 0–${formatSignal(yMax)} ${unit}, same scale for all`;
}

// Vertical guide across the tracks; the hover card lists every track's value there
function drawHoverGuide(svg, x, top, bottom, width, v, order) {
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const byGroup = d3.group(v.signal, (d) => d.group);
  const unit = SIGNAL_MODES.find((m) => m.key === signalMode.value).unit;
  // Peaks narrower than a few pixels are still picked up near the pointer
  const tolerance = (3 * (v.end - v.start)) / (right - left);

  const guide = svg
    .append("line")
    .attr("y1", top)
    .attr("y2", bottom)
    .attr("stroke", "#334155")
    .attr("stroke-dasharray", "3 3")
    .style("pointer-events", "none")
    .style("display", "none");

  let lastEvent = null;
  const update = () => {
    guideFrame = null;
    const [mx] = d3.pointer(lastEvent, svg.node());
    const pos = x.invert(mx);
    guide.attr("x1", mx).attr("x2", mx).style("display", null);
    const lines = [];
    let peak = null;
    for (const group of order) {
      let best = null;
      for (const d of byGroup.get(group) || []) {
        if (d.start - tolerance <= pos && pos <= d.end + tolerance && (!best || d.signal > best.signal)) {
          best = d;
        }
      }
      if (best) {
        peak = peak || best;
        lines.push(`${group}: ${formatSignal(signalValue(best))}`);
      }
    }
    const title = `${v.chrom}:${formatBp(pos)}`;
    if (!peak) return showTip(lastEvent, title, ["No accessible peak here"]);
    showTip(lastEvent, title, [`Peak ${formatBp(peak.start)}–${formatBp(peak.end)} (${unit})`, ...lines]);
  };

  svg
    .append("rect")
    .attr("x", left)
    .attr("y", top)
    .attr("width", right - left)
    .attr("height", bottom - top)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      lastEvent = event;
      if (!guideFrame) guideFrame = requestAnimationFrame(update);
    })
    .on("mouseleave", () => {
      if (guideFrame) cancelAnimationFrame(guideFrame);
      guideFrame = null;
      guide.style("display", "none");
      hideTip();
    });
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

  g.append("text")
    .attr("x", left - 10)
    .attr("y", baseline - 4)
    .attr("text-anchor", "end")
    .attr("font-size", 14)
    .attr("font-weight", 600)
    .attr("fill", "#1a202c")
    .text("Links")
    .append("title")
    .text(
      `Arcs join each linked peak to ${v.gene.name}'s TSS. Thicker, darker arcs have a larger |r| (scale 0–${CORRELATION_SCALE_MAX}).`
    );

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

  // An end outside the view (a far peak, or the TSS when zoomed) is pulled in to just past
  // the edge, so the arc curves down out of view instead of crossing it as a flat line
  const reach = (px) => Math.max(left - OFFSCREEN_REACH, Math.min(right + OFFSCREEN_REACH, px));
  const offscreen = (l) => {
    const px = x(linkMid(l));
    return px < left || px > right || tssX < left || tssX > right;
  };
  const arcPath = (l) => {
    const x1 = reach(tssX);
    // Peaks at the TSS (promoters) still get a small visible arc
    const dx = reach(x(linkMid(l))) - x1;
    const x2 = x1 + (Math.abs(dx) < MIN_ARC_WIDTH ? Math.sign(dx || 1) * MIN_ARC_WIDTH : dx);
    const h = Math.min(LINK_ROW_HEIGHT - 16, 8 + Math.abs(x2 - x1) / 3);
    return `M${x1},${baseline} Q${(x1 + x2) / 2},${baseline - 2 * h} ${x2},${baseline}`;
  };

  // Off-screen arcs fade from their on-screen end to the plot edge, reading as a trail
  // toward the "N more" / TSS marker rather than a line across the view
  const defs = g.append("defs");
  const fadeStroke = (l, color, i) => {
    if (!offscreen(l)) return color;
    const px = x(linkMid(l));
    const peakOut = px < left || px > right;
    const from = peakOut ? tssX : px; // the end that's in view
    const to = (peakOut ? px : tssX) < left ? left : right;
    const id = `${fadeId}-${i}`;
    const grad = defs
      .append("linearGradient")
      .attr("id", id)
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", from)
      .attr("x2", to)
      .attr("y1", 0)
      .attr("y2", 0);
    grad.append("stop").attr("offset", 0).attr("stop-color", color).attr("stop-opacity", 1);
    grad.append("stop").attr("offset", 1).attr("stop-color", color).attr("stop-opacity", 0);
    return `url(#${id})`;
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
      .attr("stroke", fadeStroke(selected, accentColor, "selected"))
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
    .attr("stroke", (l, i) => fadeStroke(l, linkColor(l), i))
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
      showTip(event, `Linked peak · ${v.gene.name}`, linkTipLines(v, l), [
        { label: "Zoom to peak", run: () => setZoom(peakFor(v, l)) },
      ]);
    })
    // The card stays put so the pointer can reach its button
    .on("mouseleave", () => {
      visible.attr("stroke-width", arcWidth);
      showBand(null);
      hideTipSoon();
    })
    .on("click", (event, l) => selectPeak(v, l));

  if (v.zoomed) drawTssMarker(g, baseline, left, right, v);
  else drawEdgeMarkers(g, baseline, left, right, v, links);
}

// Zoomed in, the TSS is usually off-screen: point the way the arcs go to reach it
function drawTssMarker(g, baseline, left, right, v) {
  const tss = geneTss(v.gene);
  if (tss >= v.start && tss <= v.end) return;
  const toLeft = tss < v.start;
  const distance = formatLength(Math.abs(tss - linkMid(v.zoomed)));
  drawMarker(
    g,
    toLeft ? left + 4 : right - 4,
    baseline,
    toLeft ? "start" : "end",
    toLeft ? `◂ ${v.gene.name} TSS, ${distance}` : `${v.gene.name} TSS, ${distance} ▸`,
    () => setZoom(null),
    (event) =>
      showTip(event, `${v.gene.name} TSS is ${distance} to the ${toLeft ? "left" : "right"}`, [
        "The arc continues to the TSS outside this view.",
        "Click to go back to the full view",
      ])
  );
}

function drawMarker(g, x, baseline, anchor, label, onClick, onHover) {
  const marker = g.append("g").style("cursor", "pointer").on("click", onClick);
  const text = marker
    .append("text")
    .attr("x", x)
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
  marker.on("mouseenter", onHover).on("mousemove", moveTip).on("mouseleave", hideTipSoon);
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
    drawMarker(
      g,
      tx,
      baseline,
      anchor,
      side === "left" ? `◂ ${list.length} more` : `${list.length} more ▸`,
      () => {
        hideTip();
        flank.value = "links";
      },
      (event) =>
        showTip(event, `${list.length} linked peak${list.length === 1 ? "" : "s"} ${side} of this region`, [
          ...list
            .slice(0, 8)
            .map((l) => `${formatBp(l.start)} · r = ${formatR(l.correlation)} · ${formatDistance(l.distance)}`),
          ...(list.length > 8 ? [`…and ${list.length - 8} more`] : []),
          "Click to show all linked peaks",
        ])
    );
  }
}

function selectPeak(v, l) {
  emit("select-peak", isFocused(v, l) ? null : peakFor(v, l));
}

function peakFor(v, l) {
  return { gene: v.gene.name, chrom: l.chrom, start: l.start, end: l.end };
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
  lines.push(
    `r = ${formatR(l.correlation)} · p = ${formatPValue(l.pValue)}` +
      (l.zscore != null ? ` · z = ${l.zscore.toFixed(2)}` : "")
  );
  // Depth-normalized when the peak's signal is loaded (it's in view), else the processor's
  const best = mostOpenByPeak(
    v.signal.filter((d) => d.start === l.start && d.end === l.end),
    depth.value
  ).get(peakKey(l));
  if (best) {
    lines.push(`Most open in: ${best.group} (${formatSignal(best.rpm)} reads per million in peaks)`);
  } else if (l.topCellType) {
    lines.push(
      `Most open in: ${l.topCellType} (${formatSignal(l.topCellTypeSignal ?? 0)} mean counts per cell, not depth-normalized)`
    );
  }
  lines.push(isFocused(v, l) ? "Click to clear the selection" : "Click to select");
  return lines;
}

// ---- Hover card. It lingers briefly so the pointer can move onto it.

// Right of the pointer, or left of it near the right edge
function tipPosition(event) {
  const rect = plotContainer.value.getBoundingClientRect();
  const px = event.clientX - rect.left;
  const x = px + 14 + TIP_WIDTH + 8 > rect.width ? px - 14 - TIP_WIDTH : px + 14;
  return { x: Math.max(4, x), y: event.clientY - rect.top + 14 };
}

function showTip(event, title, lines, actions = []) {
  clearTimeout(tipTimeout);
  tip.value = { ...tipPosition(event), title, lines, actions };
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
  flex-direction: column;
  gap: 6px;
  padding: 6px 10px;
  background: var(--pdw-surface-muted);
  border: 1px solid var(--pdw-border);
  border-radius: 2px;
  flex-shrink: 0;
}

.control-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 10px;
  padding: 2px 10px 0;
  font-size: 14px;
  color: var(--pdw-text-muted);
  flex-shrink: 0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.swatch {
  display: inline-block;
  width: 16px;
  height: 3px;
  border-radius: 2px;
}

.legend-sep {
  color: var(--pdw-border);
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

.strand-note {
  margin-right: 6px;
  color: var(--pdw-text);
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
  flex-shrink: 0;
}

.calc-badge {
  display: inline-block;
  padding: 0 5px;
  border: 1px solid #c4b5fd;
  border-radius: 3px;
  background: #f5f3ff;
  color: #6d28d9;
  font-size: 14px;
  font-weight: 600;
  line-height: 18px;
  cursor: help;
}

.chart-tooltip {
  position: absolute;
  z-index: 20;
  width: max-content;
  max-width: 290px;
  box-sizing: border-box;
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
}

.tip-actions {
  margin-top: 6px;
}

.tip-action,
.back-btn {
  padding: 2px 10px;
}

.back-btn {
  margin-left: 8px;
}

.zoom-note {
  color: var(--pdw-text-muted);
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
