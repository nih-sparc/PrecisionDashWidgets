<template>
  <div class="pdw-theme umap-comparison-dashboard">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">Loading UMAP data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>⚠️ Error:</strong> {{ error }}
      <button type="button" class="pdw-btn retry-btn" @click="retryLoad">Retry</button>
    </div>

    <!-- Main Dashboard -->
    <div v-else class="dashboard">
      <div class="filter-placeholder">
        <!-- Filter will go here -->
      </div>
      <div class="both-pannels">
        <!-- Left Panel: Metadata UMAP -->
        <div class="panel">
          <div class="controls">
            <label class="field">
              <span class="control-label">Color by</span>
              <select
                v-model="selectedMetadataColumn"
                @change="renderMetadataUMAP"
                class="select"
              >
                <option v-for="col in metadataColumns" :key="col" :value="col">
                  {{ col }}
                </option>
              </select>
            </label>
            <!-- Cell map applies to both panels -->
            <span v-if="reductionOptions.length > 1" class="control-label">Map</span>
            <SegmentedToggle
              v-model="selectedReduction"
              hide-single
              aria-label="Cell map"
              :options="reductionOptions"
              class="cell-map-toggle"
              title="Cell map (applies to both panels)"
            />
          </div>

          <div class="canvas-container">
            <canvas ref="leftCanvas"></canvas>
            <!-- Cell type labels as text over the map: crisp at any zoom and screen density -->
            <div class="map-labels" aria-hidden="true">
              <span
                v-for="l in leftLabelPositions"
                :key="l.text"
                class="map-label"
                :style="{ left: `${l.x}px`, top: `${l.y}px`, fontSize: `${l.size}px` }"
                >{{ l.text }}</span
              >
            </div>
          </div>

          <!-- Always rendered so the canvas above is sized with the legend's space already taken -->
          <div
            class="legend"
            :class="{ 'legend-expanded': leftLegendExpanded }"
          >
            <div v-if="metadataLegend.length > 0" class="legend-header">
              <div class="legend-title">{{ formatLabel(selectedMetadataColumn) }}</div>
              <button
                type="button"
                class="legend-toggle"
                @click.stop="toggleLeftLegend"
                :aria-expanded="leftLegendExpanded.toString()"
              >
                {{ leftLegendExpanded ? "Show less" : "Show all" }}
              </button>
            </div>
            <div class="legend-items">
              <div
                v-for="(item, idx) in metadataLegend"
                :key="idx"
                class="legend-item"
              >
                <div
                  class="legend-color"
                  :class="{
                    'legend-color-hidden': !subsetCategories.has(item.label),
                  }"
                  :style="{
                    background: item.color,
                    borderColor: item.color,
                  }"
                  @click="toggleSubset(item.label)"
                >
                  <span
                    v-if="!subsetCategories.has(item.label)"
                    class="legend-x"
                    >✕</span
                  >
                </div>
                <a
                  v-if="getExternalLinkUrl(selectedMetadataColumn, item.label)"
                  class="legend-label legend-link"
                  :href="getExternalLinkUrl(selectedMetadataColumn, item.label)"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ item.label }}</a>
                <span v-else class="legend-label">{{ item.label }}</span>
              </div>
            </div>
          </div>

          <!-- Tooltip for Left Panel -->
          <div v-if="hoveredPoint" class="tooltip" :style="tooltipStyle">
            <div class="tooltip-header">Cell {{ hoveredPoint.cell_id }}</div>
            <div class="tooltip-rows">
              <template v-for="row in tooltipRows" :key="row.label">
                <span class="tooltip-label">{{ row.label }}</span>
                <span class="tooltip-value">{{ row.value }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- Right Panel: Gene Expression UMAP -->
        <div class="panel">
          <div class="controls">
            <label class="field">
              <span class="control-label" title="RNA assay (gene expression)">Gene</span>
              <input
                v-model="geneSearch"
                type="text"
                placeholder="Gene name (e.g., CDH9)"
                class="gene-input"
                list="gene-suggestions"
                @input="debouncedSearchGenes"
              />
            </label>
            <datalist id="gene-suggestions">
              <option
                v-for="gene in geneSuggestions"
                :key="gene"
                :value="gene"
              />
            </datalist>
            <button
              type="button"
              @click="handleGeneSelect"
              :disabled="!geneSearch.trim() || geneLoading"
              class="visualize-btn pdw-btn pdw-btn--primary"
            >
              {{ geneLoading ? "Loading..." : "Visualize" }}
            </button>
          </div>

          <div class="canvas-container">
            <div v-if="geneLoading" class="loading-overlay">
              <div class="small-spinner"></div>
              <p>Loading gene expression...</p>
            </div>
            <canvas ref="rightCanvas"></canvas>
          </div>

          <!-- Always rendered so the canvas above is sized with the legend's space already taken -->
          <div class="legend legend-gradient">
            <div v-if="selectedGene && !geneLoading" class="legend-title">{{ selectedGene }} expression (RNA)</div>
            <div v-if="selectedGene && !geneLoading" class="gradient-row">
              <div class="none-key">
                <span class="none-swatch" :style="{ background: EXPR_NONE_COLOR }"></span>
                <span>None</span>
              </div>
              <div class="gradient-bar">
                <div
                  class="gradient-fill"
                  :style="{ background: `linear-gradient(to right, ${EXPR_LOW_COLOR}, ${EXPR_HIGH_COLOR})` }"
                ></div>
                <div class="gradient-labels">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  shallowRef,
  computed,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import * as d3 from "d3";
import createRegl from "regl";
import { useDatasetActiveConfig, useWidgetDataEngine } from "../../composables/useSharedDataEngine.js";
import { useKeepAliveGate } from "../../composables/useKeepAliveGate.js";
import SegmentedToggle from "../shared/SegmentedToggle.vue";
import { getMetadataColumns, getCategoricalColumns, getExternalLink } from "../../config/datasetConfig.js";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
  metadataColumn: { type: String, default: null },
  gene: { type: String, default: null },
  config: { type: Object, default: null },
});
//EMITS
const emit = defineEmits(["update:Vars"]);

// Shared data engine + config (injected from ancestor)
const { runWhenActive, observeResize } = useKeepAliveGate();
const injectedConfig = useDatasetActiveConfig();
const activeConfig = computed(() => props.config || injectedConfig.value || {});

function getExternalLinkUrl(columnName, value) {
  return getExternalLink(activeConfig.value, columnName, value);
}
// Refs
const leftCanvas = ref(null);
const rightCanvas = ref(null);
const manager = shallowRef(null);
const leftRegl = ref(null);
const rightRegl = ref(null);
const sharedZoom = ref(d3.zoomIdentity); // Unified zoom state
const leftResizeObserver = ref(null);
const rightResizeObserver = ref(null);
const leftPointsData = shallowRef([]);
const rightPointsData = shallowRef([]);
const hoveredCellId = ref(null); // Shared hover state by cell_id
const hoveredFromLeft = ref(true); // Track which panel triggered the hover
const leftTooltipPos = ref({ x: 0, y: 0 });
const leftLegendExpanded = ref(false);
const isLegendAnimating = ref(false);

// State
const loading = ref(true);
const error = ref(null);
const umapData = shallowRef([]);
const reductionOptions = ref([]);
let stopReductionUpdates = null;
const selectedReduction = ref(null);

// Left panel (metadata)
const metadataColumns = ref([]);
const selectedMetadataColumn = ref(props.metadataColumn || "");
const metadataLegend = ref([]);
const subsetCategories = ref(new Set());

// Right panel (gene expression)
const geneSearch = ref("");
const selectedGene = ref(props.gene || "");
const geneSuggestions = ref([]);
const geneLoading = ref(false);

// Search timeout
let searchTimeout = null;

// Expression colors (map points and legend): neutral grey for cells with none, then a blue
// ramp for any expression, from a clear light blue to a bright mid blue, so expressing
// cells stand out from non-expressing ones even at low levels
const EXPR_NONE_COLOR = "#c8c8c8";
const EXPR_LOW_COLOR = "#90c4f2";
const EXPR_HIGH_COLOR = "#1e88e5";
const exprColor = d3.interpolateRgb(EXPR_LOW_COLOR, EXPR_HIGH_COLOR);

//WATCHES FOR REFS
watch(
  () => props.metadataColumn,
  (newVal) => {
    if (newVal && newVal !== selectedMetadataColumn.value) {
      selectedMetadataColumn.value = newVal;
      if (umapData.value.length > 0) {
        runWhenActive(renderMetadataUMAP);
      }
    }
  }
);

watch(
  () => props.gene,
  (newVal) => {
    if (newVal && newVal !== selectedGene.value) {
      selectedGene.value = newVal;
      geneSearch.value = newVal;
      if (umapData.value.length > 0) {
        runWhenActive(renderGeneUMAP);
      }
    }
  }
);
watch(selectedReduction, async (newVal, oldVal) => {
  // oldVal is null during init, which loads the data itself
  if (!oldVal || !manager.value) return;
  let data;
  try {
    data = await manager.value.getReductionData(newVal);
  } catch (err) {
    console.warn(`[SideBySide] Cell map "${newVal}" couldn't be shown:`, err.message);
    reductionOptions.value = manager.value.getReductionOptions();
    if (selectedReduction.value === newVal) selectedReduction.value = oldVal;
    return;
  }
  // A slow first load can finish after a newer pick; keep the newest
  if (selectedReduction.value !== newVal) return;
  umapData.value = data;
  // New coordinate space: reset the shared zoom on both panels
  sharedZoom.value = d3.zoomIdentity;
  for (const canvas of [leftCanvas.value, rightCanvas.value]) {
    if (canvas) d3.select(canvas).property("__zoom", d3.zoomIdentity);
  }
  runWhenActive(renderMetadataUMAP);
  runWhenActive(renderGeneUMAP);
});

watch(selectedMetadataColumn, (newVal) => {
  if (newVal) {
    emit("update:Vars", "selectedMetadataColumn", newVal);
  }
});

watch(selectedGene, (newVal) => {
  if (newVal) {
    emit("update:Vars", "selectedGene", newVal);
  }
});
// Helper function
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function cleanupLeftPanel() {
  // Clean up textures
  if (leftLabelTextures.length > 0) {
    leftLabelTextures.forEach((texture) => {
      try {
        texture.destroy();
      } catch (e) {
        console.warn("Error destroying texture:", e);
      }
    });
    leftLabelTextures = [];
  }

  // Remove event listeners
  if (leftCanvas.value && leftEventListeners.length > 0) {
    leftEventListeners.forEach(({ event, handler }) => {
      leftCanvas.value.removeEventListener(event, handler);
    });
    leftEventListeners = [];
  }

  // Clean up regl instance
  if (leftRegl.value) {
    try {
      leftRegl.value.destroy();
    } catch (e) {
      console.warn("Error destroying regl:", e);
    }
    leftRegl.value = null;
    leftReglInstance = null;
  }
}
function cleanupRightPanel() {
  // Remove event listeners
  if (rightCanvas.value && rightEventListeners.length > 0) {
    rightEventListeners.forEach(({ event, handler }) => {
      rightCanvas.value.removeEventListener(event, handler);
    });
    rightEventListeners = [];
  }

  // Clean up regl instance
  if (rightRegl.value) {
    try {
      rightRegl.value.destroy();
    } catch (e) {
      console.warn("Error destroying right regl:", e);
    }
    rightRegl.value = null;
    rightReglInstance = null;
  }
}
// Left panel render variables (shared across functions)
let leftRenderScheduled = false;
let leftDrawPoints = null;
let leftXScale = null;
let leftYScale = null;
let leftReglInstance = null;
let leftLabels = [];
let leftLabelTextures = [];
let leftEventListeners = [];

// Right panel render variables (shared across functions)
let rightRenderScheduled = false;
let rightDrawPoints = null;
let rightXScale = null;
let rightYScale = null;
let rightReglInstance = null;
let rightEventListeners = [];

//Computed
const hoveredPoint = computed(() => {
  if (!hoveredCellId.value) return null;
  //Try left then right
  let point = leftPointsData.value.find(
    (p) => p.cell_id === hoveredCellId.value
  );

  if (!point && rightPointsData.value.length > 0) {
    point = rightPointsData.value.find(
      (p) => p.cell_id === hoveredCellId.value
    );
  }

  return point;
});

// Initialize using shared viewer (injected) or fallback to creating own
async function initWithViewer(viewerInstance) {
  try {
    manager.value = viewerInstance;

    reductionOptions.value = manager.value.getReductionOptions();
    stopReductionUpdates?.();
    stopReductionUpdates?.(); // set up again on Retry
    stopReductionUpdates = manager.value.onReductionsChange?.(() => {
      reductionOptions.value = manager.value.getReductionOptions();
    });
    selectedReduction.value = manager.value.defaultReduction;
    const data = await manager.value.getReductionData(selectedReduction.value);
    umapData.value = data;

    // Extract metadata columns using config
    if (data.length > 0) {
      const sample = data[0];
      const cfg = activeConfig.value;
      const cols = getCategoricalColumns(data, getMetadataColumns(sample, cfg, cfg), cfg);
      metadataColumns.value = cols;

      if (cols.length > 0) {
        // Use prop if provided, otherwise config default, otherwise first column
        if (props.metadataColumn && cols.includes(props.metadataColumn)) {
          selectedMetadataColumn.value = props.metadataColumn;
        } else if (!selectedMetadataColumn.value) {
          const defaultCol = cfg?.defaultColorBy;
          selectedMetadataColumn.value =
            defaultCol && cols.includes(defaultCol) ? defaultCol : cols[0];
        }
      }
    }

    loading.value = false;

    await nextTick();
    setupResizeObservers();

    if (selectedMetadataColumn.value) {
      renderMetadataUMAP();
    }
    // Render gene if provided via prop
    if (props.gene) {
      selectedGene.value = props.gene;
      geneSearch.value = props.gene;
      await renderGeneUMAP();
    }
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
}

// Shared engine: the provider's, or one per data URL shared with the other widgets
const dataEngine = useWidgetDataEngine({
  dataPath: () => props.dataPath,
  config: () => props.config,
  onReady: initWithViewer,
  onError: (message) => {
    error.value = message;
    loading.value = false;
  },
});

// Retry after a failed load: the dataset itself if it never loaded, else this view's data
function retryLoad() {
  error.value = null;
  loading.value = true;
  if (manager.value) initWithViewer(manager.value);
  else dataEngine.retry();
}

onBeforeUnmount(() => {
  stopReductionUpdates?.();
  if (leftResizeObserver.value) leftResizeObserver.value.disconnect();
  if (rightResizeObserver.value) rightResizeObserver.value.disconnect();

  // Clean up both panels
  cleanupLeftPanel();
  cleanupRightPanel();
});
// Setup resize observers
function setupResizeObservers() {
  leftResizeObserver.value?.disconnect();
  rightResizeObserver.value?.disconnect();
  if (leftCanvas.value) {
    // Observe the panel instead of the canvas container
    leftResizeObserver.value = observeResize(leftCanvas.value.closest(".panel"), () => {
      // Ignore resize events during legend animation
      if (!isLegendAnimating.value && selectedMetadataColumn.value) {
        renderMetadataUMAP();
      }
    });
  }

  if (rightCanvas.value) {
    // Observe the panel instead of the canvas container
    rightResizeObserver.value = observeResize(rightCanvas.value.closest(".panel"), () => {
      if (selectedGene.value) renderGeneUMAP();
    });
  }
}

// Debounced gene search
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

// Handle gene selection
async function handleGeneSelect() {
  if (!geneSearch.value.trim()) return;
  selectedGene.value = geneSearch.value;
  await renderGeneUMAP();
}

// Calculate label positions for metadata categories
function calculateLabelPositions(points, column, colorScale) {
  // Group points by category
  const groups = new Map();

  points.forEach((p) => {
    const value = p[column];
    if (value == null) return;

    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(p);
  });

  const labels = [];

  groups.forEach((groupPoints, value) => {
    if (groupPoints.length === 0) return;

    // Calculate centroid
    const centroidX =
      groupPoints.reduce((sum, p) => sum + p.x, 0) / groupPoints.length;
    const centroidY =
      groupPoints.reduce((sum, p) => sum + p.y, 0) / groupPoints.length;

    labels.push({
      text: String(value),
      x: centroidX,
      y: centroidY,
      color: colorScale(value),
      count: groupPoints.length,
    });
  });

  // Simple label overlap prevention
  const minDistance = 0.3; // Minimum distance between labels in data coordinates

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const dx = labels[i].x - labels[j].x;
      const dy = labels[i].y - labels[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < minDistance && dist > 0) {
        // Push labels apart slightly
        const push = (minDistance - dist) / 2;
        const angle = Math.atan2(dy, dx);
        labels[i].x += Math.cos(angle) * push;
        labels[i].y += Math.sin(angle) * push;
        labels[j].x -= Math.cos(angle) * push;
        labels[j].y -= Math.sin(angle) * push;
      }
    }
  }
  return labels;
}
//subset
function initializeVisibleSubsets(values, targetSet) {
  targetSet.value = new Set(values);
}

// Add function to toggle category visibility
function toggleSubset(category) {
  const visibleSet = subsetCategories;

  if (visibleSet.value.has(category)) {
    visibleSet.value.delete(category);
  } else {
    visibleSet.value.add(category);
  }

  // Rebuild both panels
  rebuildLeftPoints();
  if (rightReglInstance && selectedGene.value) {
    rebuildRightPoints();
  }
}
function toggleLeftLegend() {
  isLegendAnimating.value = true;
  leftLegendExpanded.value = !leftLegendExpanded.value;

  // Wait for animation to complete (300ms from your CSS transition)
  setTimeout(() => {
    isLegendAnimating.value = false;
  }, 350);
}

function rebuildLeftPoints() {
  if (!leftReglInstance || !leftXScale || !leftYScale) return;

  const canvas = leftCanvas.value;
  if (!canvas) return;

  // Build points for ALL categories, but use grey for hidden ones
  const positions = [];
  const colors = [];
  leftPointsData.value.forEach((p) => {
    const categoryValue = String(p[selectedMetadataColumn.value]);
    positions.push(leftXScale(p.x), leftYScale(p.y));

    // Use grey color for hidden categories, original color for visible ones
    if (subsetCategories.value.has(categoryValue)) {
      const rgb = d3.color(p.color).rgb();
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
    } else {
      // Grey color for hidden categories
      colors.push(0.85, 0.85, 0.85, 0.3); // Light grey with low opacity
    }
  });

  // Recreate the draw command with all data
  leftDrawPoints = leftReglInstance({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float alpha = vColor.a * (1.0 - smoothstep(0.3, 0.5, d));
        gl_FragColor = vec4(vColor.rgb, alpha);
      }`,
    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      void main() {
        vec2 pos = position * scale + translate;
        gl_Position = vec4(pos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }`,
    attributes: { position: positions, color: colors },
    uniforms: {
      pointSize: leftReglInstance.prop("pointSize"),
      scale: leftReglInstance.prop("scale"),
      translate: leftReglInstance.prop("translate"),
    },
    count: positions.length / 2,
    primitive: "points",
    depth: { enable: false },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: "src alpha",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
      equation: "add",
    },
  });

  // Trigger re-render
  renderLeftPanel();
}
function rebuildRightPoints() {
  if (!rightReglInstance || !rightXScale || !rightYScale) return;

  const canvas = rightCanvas.value;
  if (!canvas) return;

  // Build points for ALL categories, but use grey for hidden ones
  const positions = [];
  const colors = [];
  rightPointsData.value.forEach((p) => {
    const categoryValue = String(p[selectedMetadataColumn.value]);
    positions.push(rightXScale(p.x), rightYScale(p.y));

    // Use grey color for hidden categories, original color for visible ones
    if (subsetCategories.value.has(categoryValue)) {
      const rgb = d3.color(p.color).rgb();
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 1);
    } else {
      // Grey color for hidden categories
      colors.push(0.85, 0.85, 0.85, 0.3); // Light grey with low opacity
    }
  });

  // Recreate the draw command with all data
  rightDrawPoints = rightReglInstance({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float alpha = vColor.a * (1.0 - smoothstep(0.42, 0.5, d)); // crisp edge: pale colors stay visible
        gl_FragColor = vec4(vColor.rgb, alpha);
      }`,
    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      void main() {
        vec2 pos = position * scale + translate;
        gl_Position = vec4(pos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }`,
    attributes: { position: positions, color: colors },
    uniforms: {
      pointSize: rightReglInstance.prop("pointSize"),
      scale: rightReglInstance.prop("scale"),
      translate: rightReglInstance.prop("translate"),
    },
    count: positions.length / 2,
    primitive: "points",
    depth: { enable: false },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: "src alpha",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
      equation: "add",
    },
  });

  // Trigger re-render
  renderRightPanel();
}
// Hovered-cell marker diameter in pixels; fixed, so zooming doesn't change it
const HOVER_MARKER_PX = 20;

// Positions of the cell type labels over the left map, in CSS pixels (drawn as HTML text)
const leftLabelPositions = shallowRef([]);

function drawLeftLabels(canvas, transform) {
  if (!canvas || !leftXScale || !leftYScale || leftLabels.length === 0) {
    leftLabelPositions.value = [];
    return;
  }
  const tr = transform || d3.zoomIdentity;
  // Canvas pixels → CSS pixels, in case the canvas is sized for the screen density
  const cssPerPx = canvas.clientWidth / canvas.width || 1;
  const tX = (2 * tr.x) / canvas.width;
  const tY = -(2 * tr.y) / canvas.height;
  // Grows with zoom, within limits
  const size = Math.round(Math.max(14, Math.min(20, 14 * tr.k)));
  const positions = [];
  for (const label of leftLabels) {
    if (!subsetCategories.value.has(label.text)) continue;
    const x = ((leftXScale(label.x) * tr.k + tX + 1) / 2) * canvas.width;
    const y = ((1 - (leftYScale(label.y) * tr.k + tY)) / 2) * canvas.height;
    if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) continue;
    // Offset by the canvas's place in its (centering) container
    positions.push({
      text: label.text,
      x: canvas.offsetLeft + x * cssPerPx,
      y: canvas.offsetTop + y * cssPerPx,
      size,
    });
  }
  leftLabelPositions.value = positions;
}

/**
 * Scales from map coordinates to the given output ranges, using the same units per pixel on
 * both axes (distances on a cell map are meaningful, so it mustn't be stretched to fill a
 * wide box). The map is centered, with a small margin around the outermost cells.
 * Both panels have the same canvas size, so they get the same scales and the shared zoom
 * lines up.
 */
function equalAspectScales(points, width, height, xRange, yRange) {
  const MARGIN = 0.02;
  const [x0, x1] = d3.extent(points, (d) => d.x);
  const [y0, y1] = d3.extent(points, (d) => d.y);
  const dx = (x1 - x0 || 1) * (1 + 2 * MARGIN);
  const dy = (y1 - y0 || 1) * (1 + 2 * MARGIN);
  // Fraction of each axis the map fills; the tighter axis fills it all
  const pxPerUnit = Math.min(width / dx, height / dy);
  const fx = (dx * pxPerUnit) / width;
  const fy = (dy * pxPerUnit) / height;
  const squeeze = ([a, b], f) => [(a + b) / 2 - ((b - a) * f) / 2, (a + b) / 2 + ((b - a) * f) / 2];
  const xMid = (x0 + x1) / 2;
  const yMid = (y0 + y1) / 2;
  return {
    xScale: d3.scaleLinear().domain([xMid - dx / 2, xMid + dx / 2]).range(squeeze(xRange, fx)),
    yScale: d3.scaleLinear().domain([yMid - dy / 2, yMid + dy / 2]).range(squeeze(yRange, fy)),
  };
}

// Render metadata UMAP
async function renderMetadataUMAP() {
  await nextTick();
  const canvas = leftCanvas.value;
  if (!canvas || !umapData.value.length) return;

  // Clean up previous instance before creating new one
  cleanupLeftPanel();

  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  canvas.width = width;
  canvas.height = height;

  // Get unique values for the selected column
  const values = [
    ...new Set(
      umapData.value
        .map((d) => d[selectedMetadataColumn.value])
        .filter((v) => v != null)
    ),
  ];
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(values);

  // Build legend
  metadataLegend.value = values.map((v) => ({
    label: String(v),
    color: colorScale(v),
  }));

  // Always initialize all categories as visible when rendering/changing metadata
  initializeVisibleSubsets(
    values.map((v) => String(v)),
    subsetCategories
  );

  // Prepare points
  const [xCol, yCol] = manager.value.getReductionAxes(selectedReduction.value);
  const points = umapData.value.map((d) => ({
    ...d,
    x: d[xCol],
    y: d[yCol],
    color: colorScale(d[selectedMetadataColumn.value]) || "#cccccc",
    opacity: 0.8,
  }));

  // Store points for hover detection
  leftPointsData.value = points;

  // Calculate label positions
  const labelPositions = calculateLabelPositions(
    points,
    selectedMetadataColumn.value,
    colorScale
  );
  leftLabels = labelPositions;

  try {
    leftRegl.value = createRegl(canvas);
  } catch (err) {
    console.error("WebGL not supported:", err);
    return;
  }

  const regl = leftRegl.value;
  leftReglInstance = regl;

  // Scales -> NDC, with one scale for both axes so the map isn't stretched
  const { xScale, yScale } = equalAspectScales(points, width, height, [-1, 1], [-1, 1]);
  // Store scales for highlight function
  leftXScale = xScale;
  leftYScale = yScale;

  const positions = [];
  const colors = [];
  points.forEach((p) => {
    const categoryValue = String(p[selectedMetadataColumn.value]);
    positions.push(xScale(p.x), yScale(p.y));

    if (subsetCategories.value.has(categoryValue)) {
      const rgb = d3.color(p.color).rgb();
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
    } else {
      colors.push(0.85, 0.85, 0.85, 0.3);
    }
  });

  const drawPoints = regl({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float alpha = vColor.a * (1.0 - smoothstep(0.3, 0.5, d));
        gl_FragColor = vec4(vColor.rgb, alpha);
      }`,
    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      void main() {
        vec2 pos = position * scale + translate;
        gl_Position = vec4(pos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }`,
    attributes: { position: positions, color: colors },
    uniforms: {
      pointSize: regl.prop("pointSize"),
      scale: regl.prop("scale"),
      translate: regl.prop("translate"),
    },
    count: positions.length / 2,
    primitive: "points",
    depth: { enable: false },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: "src alpha",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
      equation: "add",
    },
  });
  // Store for external access
  leftDrawPoints = drawPoints;

  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 10])
    .filter((event) => event.type !== "wheel")
    .on("zoom", (event) => {
      if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
        sharedZoom.value = event.transform;
        renderLeftPanel();
        // Also trigger right panel render if it exists
        if (rightRegl.value && selectedGene.value) {
          renderRightPanel();
        }
      }
    });

  d3.select(canvas).call(zoom);

  // Track event listeners for cleanup
  let hoverRafId = null;

  const wheelHandler = (event) => {
    event.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;
    const tr = sharedZoom.value || d3.zoomIdentity;

    const ndcX = (mx / canvas.width) * 2 - 1;
    const ndcY = -((my / canvas.height) * 2 - 1);

    const tX = (2 * tr.x) / canvas.width;
    const tY = -(2 * tr.y) / canvas.height;

    const dataX = (ndcX - tX) / tr.k;
    const dataY = (ndcY - tY) / tr.k;

    const delta = -event.deltaY * 0.002;
    const kNew = Math.max(0.5, Math.min(10, tr.k * Math.pow(2, delta)));

    const newTranslateX = ndcX - dataX * kNew;
    const newTranslateY = ndcY - dataY * kNew;

    const xNew = (newTranslateX * canvas.width) / 2;
    const yNew = -(newTranslateY * canvas.height) / 2;

    const newTransform = d3.zoomIdentity.translate(xNew, yNew).scale(kNew);
    sharedZoom.value = newTransform;
    renderLeftPanel();
    d3.select(canvas).property("__zoom", newTransform);

    // Also update right panel
    if (rightCanvas.value && rightRegl.value && selectedGene.value) {
      d3.select(rightCanvas.value).property("__zoom", newTransform);
      renderRightPanel();
    }
  };

  const mouseMoveHandler = (event) => {
    if (hoverRafId) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = null;
      const r = canvas.getBoundingClientRect();
      const mx = event.clientX - r.left;
      const my = event.clientY - r.top;
      const tr = sharedZoom.value || d3.zoomIdentity;

      const ndcX = (mx / canvas.width) * 2 - 1;
      const ndcY = -((my / canvas.height) * 2 - 1);

      const hoverRadiusSq = 0.02 * 0.02;
      let closestPoint = null;
      let closestDist = hoverRadiusSq;
      let closestIndex = -1;

      const points = leftPointsData.value;
      const tX = (2 * tr.x) / canvas.width;
      const tY = -(2 * tr.y) / canvas.height;
      for (let i = 0, len = points.length; i < len; i++) {
        const p = points[i];
        const tx = xScale(p.x) * tr.k + tX;
        const ty = yScale(p.y) * tr.k + tY;
        const dx = tx - ndcX;
        const dy = ty - ndcY;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestPoint = p;
          closestIndex = i;
        }
      }

      if (closestPoint) {
        hoveredCellId.value = closestPoint.cell_id;
        hoveredFromLeft.value = true;

        const px = xScale(closestPoint.x);
        const py = yScale(closestPoint.y);
        const screenX = ((px * tr.k + tX + 1) / 2) * canvas.width;
        const screenY = ((1 - (py * tr.k + tY)) / 2) * canvas.height;

        const canvasRect = canvas.getBoundingClientRect();
        leftTooltipPos.value = {
          x: canvasRect.left + screenX + 15,
          y: canvasRect.top + screenY - 10,
        };
      } else {
        hoveredCellId.value = null;
      }

      renderLeftPanel();
      if (rightRegl.value && selectedGene.value) {
        renderRightPanel();
      }
    });
  };

  const mouseLeaveHandler = () => {
    hoveredCellId.value = null;
    renderLeftPanel();
    if (rightRegl.value && selectedGene.value) {
      renderRightPanel();
    }
  };

  // Add event listeners
  canvas.addEventListener("wheel", wheelHandler, { passive: false });
  canvas.addEventListener("mousemove", mouseMoveHandler);
  canvas.addEventListener("mouseleave", mouseLeaveHandler);

  // Track for cleanup
  leftEventListeners = [
    { event: "wheel", handler: wheelHandler },
    { event: "mousemove", handler: mouseMoveHandler },
    { event: "mouseleave", handler: mouseLeaveHandler },
  ];

  renderLeftPanel();
}

function renderRightPanel() {
  if (!rightCanvas.value || !rightReglInstance || rightRenderScheduled) return;
  rightRenderScheduled = true;
  requestAnimationFrame(() => {
    rightRenderScheduled = false;
    const canvas = rightCanvas.value;
    if (!canvas || !rightReglInstance) return;
    rightReglInstance.clear({ color: [1, 1, 1, 1], depth: 1 });

    let scale = 1,
      translate = [0, 0],
      pointSize = 3;
    if (sharedZoom.value) {
      const { k, x, y } = sharedZoom.value;
      scale = k;
      translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
      pointSize = Math.max(2, 3 * k);
    }

    rightDrawPoints({ scale, translate, pointSize });

    // Draw highlight if there's a hovered cell
    if (hoveredCellId.value) {
      const idx = rightPointsData.value.findIndex(
        (p) => p.cell_id === hoveredCellId.value
      );
      if (idx !== -1) {
        const point = rightPointsData.value[idx];
        // Only draw highlight if the category is visible
        const categoryValue = String(point[selectedMetadataColumn.value]);
        if (subsetCategories.value.has(categoryValue)) {
          drawRightHighlightedPoint(idx, sharedZoom.value);

          // Update tooltip position
          const p = rightPointsData.value[idx];
          const px = rightXScale(p.x);
          const py = rightYScale(p.y);
          const tr = sharedZoom.value;
          const tX = (2 * tr.x) / canvas.width;
          const tY = -(2 * tr.y) / canvas.height;
          const screenX = ((px * tr.k + tX + 1) / 2) * canvas.width;
          const screenY = ((1 - (py * tr.k + tY)) / 2) * canvas.height;

          const canvasRect = canvas.getBoundingClientRect();
        }
      }
    }

    rightRenderScheduled = false;
  });
}

function drawRightHighlightedPoint(idx, tr) {
  if (!rightCanvas.value || !rightReglInstance || !rightXScale || !rightYScale)
    return;

  const canvas = rightCanvas.value;
  const p = rightPointsData.value[idx];
  const px = rightXScale(p.x);
  const py = rightYScale(p.y);

  const highlightDraw = rightReglInstance({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      uniform float pointSize;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        // Hovered cell: dark outer ring, white ring, then the cell's color at full strength,
        // so it stands out on empty space and on dense clusters alike. Ring widths in pixels.
        float r = d * pointSize;
        float edge = pointSize * 0.5;
        if (r > edge - 2.5) gl_FragColor = vec4(0.1, 0.13, 0.17, 1.0);
        else if (r > edge - 4.5) gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        else gl_FragColor = vec4(vColor.rgb, 1.0);
      }`,
    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      void main() {
        vec2 pos = position * scale + translate;
        gl_Position = vec4(pos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }`,
    attributes: {
      position: [px, py],
      color: (() => {
        if (p.color.startsWith("#")) {
          const rgb = hexToRgb(p.color);
          return [...rgb, p.opacity];
        }
        const m = p.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        return m
          ? [
              parseInt(m[1]) / 255,
              parseInt(m[2]) / 255,
              parseInt(m[3]) / 255,
              p.opacity,
            ]
          : [0.8, 0.8, 0.8, p.opacity];
      })(),
    },
    uniforms: {
      pointSize: HOVER_MARKER_PX, // same size at every zoom
      scale: tr.k,
      translate: [(2 * tr.x) / canvas.width, -(2 * tr.y) / canvas.height],
    },
    count: 1,
    primitive: "points",
    depth: { enable: false },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: "src alpha",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
      equation: "add",
    },
  });
  highlightDraw();
}

function renderLeftPanel() {
  if (!leftCanvas.value || !leftReglInstance || leftRenderScheduled) return;
  leftRenderScheduled = true;

  requestAnimationFrame(() => {
    const canvas = leftCanvas.value;
    leftReglInstance.clear({ color: [1, 1, 1, 1], depth: 1 });

    let scale = 1,
      translate = [0, 0],
      pointSize = 3;
    if (sharedZoom.value) {
      const { k, x, y } = sharedZoom.value;
      scale = k;
      translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
      pointSize = Math.max(2, 3 * k);
    }

    leftDrawPoints({ scale, translate, pointSize });

    // Draw labels only for visible categories
    drawLeftLabels(canvas, sharedZoom.value);

    // Draw highlight if there's a hovered cell
    if (hoveredCellId.value) {
      const idx = leftPointsData.value.findIndex(
        (p) => p.cell_id === hoveredCellId.value
      );
      if (idx !== -1) {
        const point = leftPointsData.value[idx];
        // Only draw highlight if the category is visible
        const categoryValue = String(point[selectedMetadataColumn.value]);
        if (subsetCategories.value.has(categoryValue)) {
          drawLeftHighlightedPoint(idx, sharedZoom.value);

          // Update tooltip position
          const p = leftPointsData.value[idx];
          const px = leftXScale(p.x);
          const py = leftYScale(p.y);
          const tr = sharedZoom.value;
          const tX = (2 * tr.x) / canvas.width;
          const tY = -(2 * tr.y) / canvas.height;
          const screenX = ((px * tr.k + tX + 1) / 2) * canvas.width;
          const screenY = ((1 - (py * tr.k + tY)) / 2) * canvas.height;

          const canvasRect = canvas.getBoundingClientRect();
          leftTooltipPos.value = {
            x: canvasRect.left + screenX + 15,
            y: canvasRect.top + screenY - 10,
          };
        }
      }
    }

    leftRenderScheduled = false;
  });
}

function drawLeftHighlightedPoint(idx, tr) {
  if (!leftCanvas.value || !leftReglInstance || !leftXScale || !leftYScale)
    return;

  const canvas = leftCanvas.value;
  const p = leftPointsData.value[idx];
  const px = leftXScale(p.x);
  const py = leftYScale(p.y);

  const highlightDraw = leftReglInstance({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      uniform float pointSize;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        // Hovered cell: dark outer ring, white ring, then the cell's color at full strength,
        // so it stands out on empty space and on dense clusters alike. Ring widths in pixels.
        float r = d * pointSize;
        float edge = pointSize * 0.5;
        if (r > edge - 2.5) gl_FragColor = vec4(0.1, 0.13, 0.17, 1.0);
        else if (r > edge - 4.5) gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
        else gl_FragColor = vec4(vColor.rgb, 1.0);
      }`,
    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      void main() {
        vec2 pos = position * scale + translate;
        gl_Position = vec4(pos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }`,
    attributes: {
      position: [px, py],
      color: (() => {
        if (p.color.startsWith("#")) {
          const rgb = hexToRgb(p.color);
          return [...rgb, p.opacity];
        }
        const m = p.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        return m
          ? [
              parseInt(m[1]) / 255,
              parseInt(m[2]) / 255,
              parseInt(m[3]) / 255,
              p.opacity,
            ]
          : [0.8, 0.8, 0.8, p.opacity];
      })(),
    },
    uniforms: {
      pointSize: HOVER_MARKER_PX, // same size at every zoom
      scale: tr.k,
      translate: [(2 * tr.x) / canvas.width, -(2 * tr.y) / canvas.height],
    },
    count: 1,
    primitive: "points",
    depth: { enable: false },
    blend: {
      enable: true,
      func: {
        srcRGB: "src alpha",
        srcAlpha: "src alpha",
        dstRGB: "one minus src alpha",
        dstAlpha: "one minus src alpha",
      },
      equation: "add",
    },
  });
  highlightDraw();
}

// Render gene expression UMAP
async function renderGeneUMAP() {
  if (!selectedGene.value) return;

  await nextTick();
  const canvas = rightCanvas.value;
  if (!canvas || !umapData.value.length) return;

  cleanupRightPanel();

  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  canvas.width = width;
  canvas.height = height;

  // Initialize subsetCategories if empty
  if (subsetCategories.value.size === 0 && selectedMetadataColumn.value) {
    const values = [
      ...new Set(
        umapData.value
          .map((d) => d[selectedMetadataColumn.value])
          .filter((v) => v != null)
      ),
    ];
    initializeVisibleSubsets(
      values.map((v) => String(v)),
      subsetCategories
    );
  }

  try {
    geneLoading.value = true;
    const geneData = await manager.value.getGeneExpression(selectedGene.value);
    geneLoading.value = false;

    const exprMap = new Map(geneData.map((d) => [d.cell_id, d.expression]));
    const allExpr = geneData.map((d) => d.expression);
    const maxExpr = Math.max(...allExpr);

    const [xCol, yCol] = manager.value.getReductionAxes(selectedReduction.value);
    const points = umapData.value.map((d) => {
      const expr = exprMap.get(d.cell_id) || 0;
      const norm = maxExpr > 0 ? Math.min(expr / maxExpr, 1) : 0;

      // Same colors as the legend: grey for none, light → bright blue for any expression
      const { r, g, b } = d3.rgb(expr > 0 ? exprColor(norm) : EXPR_NONE_COLOR);

      return {
        ...d,
        x: d[xCol],
        y: d[yCol],
        expr,
        norm,
        color: `rgb(${r}, ${g}, ${b})`,
        originalColor: `rgb(${r}, ${g}, ${b})`, // Store original color
        opacity: 1,
      };
    });

    // Sort by expression so high expression is on top
    points.sort((a, b) => a.norm - b.norm);

    // Store points for hover detection
    rightPointsData.value = points;

    try {
      if (rightRegl.value) {
        rightRegl.value.destroy();
      }
      rightRegl.value = createRegl(canvas);
    } catch (err) {
      console.error("WebGL not supported:", err);
      return;
    }

    const regl = rightRegl.value;
    rightReglInstance = regl;

    // Scales -> NDC, with one scale for both axes so the map isn't stretched
    const { xScale, yScale } = equalAspectScales(points, width, height, [-1, 1], [-1, 1]);

    // Store scales for highlight function
    rightXScale = xScale;
    rightYScale = yScale;

    const positions = [];
    const colors = [];

    points.forEach((p) => {
      const categoryValue = String(p[selectedMetadataColumn.value]);
      positions.push(xScale(p.x), yScale(p.y));

      // Use grey color for hidden categories, original color for visible ones
      if (subsetCategories.value.has(categoryValue)) {
        const rgb = d3.color(p.color).rgb();
        colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
      } else {
        // Grey color for hidden categories
        colors.push(0.85, 0.85, 0.85, 0.3);
      }
    });

    const drawPoints = regl({
      frag: `
        precision mediump float;
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float alpha = vColor.a * (1.0 - smoothstep(0.42, 0.5, d)); // crisp edge: pale colors stay visible
          gl_FragColor = vec4(vColor.rgb, alpha);
        }`,
      vert: `
        precision mediump float;
        attribute vec2 position;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float pointSize;
        uniform float scale;
        uniform vec2 translate;
        void main() {
          vec2 pos = position * scale + translate;
          gl_Position = vec4(pos, 0, 1);
          gl_PointSize = pointSize;
          vColor = color;
        }`,
      attributes: { position: positions, color: colors },
      uniforms: {
        pointSize: regl.prop("pointSize"),
        scale: regl.prop("scale"),
        translate: regl.prop("translate"),
      },
      count: positions.length / 2,
      primitive: "points",
      depth: { enable: false },
      blend: {
        enable: true,
        func: {
          srcRGB: "src alpha",
          srcAlpha: "src alpha",
          dstRGB: "one minus src alpha",
          dstAlpha: "one minus src alpha",
        },
        equation: "add",
      },
    });

    // Store for external access
    rightDrawPoints = drawPoints;

    const zoom = d3
      .zoom()
      .scaleExtent([0.5, 10])
      .filter((event) => event.type !== "wheel")
      .on("zoom", (event) => {
        if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
          sharedZoom.value = event.transform;
          renderRightPanel();
          // Also trigger left panel render
          if (leftRegl.value && selectedMetadataColumn.value) {
            d3.select(leftCanvas.value).property("__zoom", event.transform);
            renderLeftPanel();
          }
        }
      });

    d3.select(canvas).call(zoom);
    // After d3.select(canvas).call(zoom);

    // Track event listeners for cleanup
    let rightHoverRafId = null;

    const wheelHandler = (event) => {
      event.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = event.clientX - r.left;
      const my = event.clientY - r.top;
      const tr = sharedZoom.value || d3.zoomIdentity;

      const ndcX = (mx / canvas.width) * 2 - 1;
      const ndcY = -((my / canvas.height) * 2 - 1);

      const tX = (2 * tr.x) / canvas.width;
      const tY = -(2 * tr.y) / canvas.height;

      const dataX = (ndcX - tX) / tr.k;
      const dataY = (ndcY - tY) / tr.k;

      const delta = -event.deltaY * 0.002;
      const kNew = Math.max(0.5, Math.min(10, tr.k * Math.pow(2, delta)));

      const newTranslateX = ndcX - dataX * kNew;
      const newTranslateY = ndcY - dataY * kNew;

      const xNew = (newTranslateX * canvas.width) / 2;
      const yNew = -(newTranslateY * canvas.height) / 2;

      const newTransform = d3.zoomIdentity.translate(xNew, yNew).scale(kNew);
      sharedZoom.value = newTransform;
      renderRightPanel();
      d3.select(canvas).property("__zoom", newTransform);

      // Also update left panel
      if (leftCanvas.value && leftRegl.value && selectedMetadataColumn.value) {
        d3.select(leftCanvas.value).property("__zoom", newTransform);
        renderLeftPanel();
      }
    };

    const mouseMoveHandler = (event) => {
      if (rightHoverRafId) return;
      rightHoverRafId = requestAnimationFrame(() => {
        rightHoverRafId = null;
        const r = canvas.getBoundingClientRect();
        const mx = event.clientX - r.left;
        const my = event.clientY - r.top;
        const tr = sharedZoom.value || d3.zoomIdentity;

        const ndcX = (mx / canvas.width) * 2 - 1;
        const ndcY = -((my / canvas.height) * 2 - 1);

        const hoverRadiusSq = 0.02 * 0.02;
        let closestPoint = null;
        let closestDist = hoverRadiusSq;
        let closestIndex = -1;

        const points = rightPointsData.value;
        const tX = (2 * tr.x) / canvas.width;
        const tY = -(2 * tr.y) / canvas.height;
        for (let i = 0, len = points.length; i < len; i++) {
          const p = points[i];
          const tx = xScale(p.x) * tr.k + tX;
          const ty = yScale(p.y) * tr.k + tY;
          const dx = tx - ndcX;
          const dy = ty - ndcY;
          const dist = dx * dx + dy * dy;
          if (dist < closestDist) {
            closestDist = dist;
            closestPoint = p;
            closestIndex = i;
          }
        }

        if (closestPoint) {
          hoveredCellId.value = closestPoint.cell_id;
          hoveredFromLeft.value = false;
        } else {
          hoveredCellId.value = null;
        }

        renderRightPanel();
        if (leftRegl.value && selectedMetadataColumn.value) {
          renderLeftPanel();
        }
      });
    };

    const mouseLeaveHandler = () => {
      hoveredCellId.value = null;
      renderRightPanel();
      if (leftRegl.value && selectedMetadataColumn.value) {
        renderLeftPanel();
      }
    };

    // Add event listeners
    canvas.addEventListener("wheel", wheelHandler, { passive: false });
    canvas.addEventListener("mousemove", mouseMoveHandler);
    canvas.addEventListener("mouseleave", mouseLeaveHandler);

    // Track for cleanup
    rightEventListeners = [
      { event: "wheel", handler: wheelHandler },
      { event: "mousemove", handler: mouseMoveHandler },
      { event: "mouseleave", handler: mouseLeaveHandler },
    ];

    renderRightPanel();
  } catch (err) {
    console.error("Failed to render gene UMAP:", err);
    geneLoading.value = false;
  }
}

// Tooltip helpers
// Hover card: the few things a researcher reads first about a cell, not every metadata
// column. Each row takes the first of its columns the dataset has; at most 8 rows.
const TOOLTIP_MAX_ROWS = 8;
const TOOLTIP_FIELDS = [
  { label: "Donor", keys: ["Donor", "donor_ID", "donor_id", "donor"] },
  { label: "Sample", keys: ["Sample_name", "sample_name", "sample", "orig.ident"] },
  { label: "Source study", keys: ["Dataset", "dataset"] },
  { label: "Sex", keys: ["Sex", "sex"] },
  { label: "Age", keys: ["Age", "age"] },
  { label: "Spinal region", keys: ["SpinalRegion", "spinal_region"] },
  { label: "Genes detected", keys: ["nFeature_RNA"], format: "int" },
  { label: "RNA counts", keys: ["nCount_RNA"], format: "int" },
  { label: "Mito %", keys: ["percent.mt"], format: "pct" },
  { label: "ATAC fragments", keys: ["nCount_ATAC"], format: "int" },
];

function formatField(value, format) {
  if (typeof value !== "number") return String(value);
  if (format === "int") return Math.round(value).toLocaleString();
  if (format === "pct") return `${value.toFixed(1)}%`;
  return formatValue("", value);
}

const tooltipRows = computed(() => {
  const point = hoveredPoint.value;
  if (!point) return [];
  const rows = [];
  const present = (v) => v !== null && v !== undefined && v !== "";

  // What the cell is: the dataset's cell type, and the color-by column if it's another one
  const cellTypeCol = activeConfig.value.cellTypeColumn;
  if (cellTypeCol && present(point[cellTypeCol])) {
    rows.push({ label: "Cell type", value: String(point[cellTypeCol]) });
  }
  const colorBy = selectedMetadataColumn.value;
  if (colorBy && colorBy !== cellTypeCol && present(point[colorBy])) {
    rows.push({ label: formatLabel(colorBy), value: String(point[colorBy]) });
  }

  // The selected gene's expression in this cell
  if (selectedGene.value && rightPointsData.value.length) {
    const r = rightPointsData.value.find((p) => p.cell_id === point.cell_id);
    if (r) {
      rows.push({
        label: `${selectedGene.value} (RNA)`,
        value: r.expr > 0 ? formatValue("", r.expr) : "Not detected",
      });
    }
  }

  for (const field of TOOLTIP_FIELDS) {
    if (rows.length >= TOOLTIP_MAX_ROWS) break;
    const key = field.keys.find((k) => present(point[k]));
    if (key) rows.push({ label: field.label, value: formatField(point[key], field.format) });
  }
  return rows.slice(0, TOOLTIP_MAX_ROWS);
});

// Next to the cursor, flipped left / up near the window's edges so it stays on screen
const TOOLTIP_WIDTH = 320;
const TOOLTIP_HEIGHT_ESTIMATE = 260;
const tooltipStyle = computed(() => {
  const { x, y } = leftTooltipPos.value;
  const flipX = x + TOOLTIP_WIDTH > window.innerWidth - 8;
  const flipY = y + TOOLTIP_HEIGHT_ESTIMATE > window.innerHeight - 8;
  return {
    left: `${flipX ? x - TOOLTIP_WIDTH - 30 : x}px`,
    top: `${flipY ? Math.max(8, y - TOOLTIP_HEIGHT_ESTIMATE) : y}px`,
  };
});

function formatLabel(key) {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function formatValue(key, value) {
  if (typeof value === "number") {
    if (key === selectedGene.value || key === selectedMetadataColumn.value)
      return value.toFixed(3);
    if (value < 0.01 && value > 0) return value.toExponential(2);
    if (Math.abs(value) > 1000) return value.toLocaleString();
    return value.toFixed(2);
  }
  return value;
}
</script>

<style scoped>
.umap-comparison-dashboard {
  height: 100%;
}
/* The widget card is the frame: the two halves have no borders or backgrounds of their own,
   just one divider between them */
.both-pannels {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  width: 100%;
}
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 8px 16px 16px;
  box-sizing: border-box;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  width: 50%;
  box-sizing: border-box;
  overflow: hidden;
  position: relative;
}
.panel:first-child {
  padding-right: 16px;
  border-right: 1px solid var(--pdw-border);
}
.panel + .panel {
  padding-left: 16px;
}


.filter-placeholder {
  height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pdw-text-muted);
  font-size: 14px;
  font-style: italic;
  width: 100%;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.control-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--pdw-text-muted);
  white-space: nowrap;
}

.select {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  font-size: 14px;
  background: var(--pdw-surface);
  color: var(--pdw-text);
  cursor: pointer;
  transition: border-color 0.15s;
}

.select:hover {
  border-color: var(--pdw-text-muted);
}

.select:focus {
  outline: none;
  border-color: var(--pdw-primary);
}

.gene-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  font-size: 14px;
  background: var(--pdw-surface);
  color: var(--pdw-text);
  transition: border-color 0.15s;
  min-width: 0;
  box-sizing: border-box;
}

.gene-input::placeholder {
  font-size: 14px;
}

.gene-input:hover {
  border-color: var(--pdw-text-muted);
}

.gene-input:focus {
  outline: none;
  border-color: var(--pdw-primary);
}

.visualize-btn {
  align-self: stretch;
  flex-shrink: 0;
}

.cell-map-toggle {
  align-self: stretch;
  flex-shrink: 0;
}
.cell-map-toggle :deep(button) {
  padding: 0 14px;
  font-size: 14px;
}


/* No frame or padding: the map uses all of its space */
.canvas-container {
  flex: 1;
  position: relative;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.canvas-container canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  cursor: pointer;
}

.canvas-container canvas:active {
  cursor: grabbing;
}

/* Fixed height, and the same in both panels, so the two maps are the same size (the shared
   zoom relies on that) and the legend appearing never changes the canvas area */
/* A rule above each legend separates it from its map; both are the same height so the
   rules line up across the two halves */
.legend {
  padding: 8px;
  border-top: 1px solid var(--pdw-border);
  height: 112px;
  flex-shrink: 0;
  overflow-y: auto;
  position: relative;
  z-index: 5;
  box-sizing: border-box;
  background: var(--pdw-surface);
}

/* Expanded: lies over the bottom of the map, separated by a rule rather than a shadow */
.legend-expanded {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 16px;
  height: 60%;
  max-height: calc(100% - 200px);
  border-top: 1px solid var(--pdw-border);
  z-index: 10;
}

.legend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.legend-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pdw-text-muted);
  margin: 0 0 6px;
}
.legend-header .legend-title {
  margin: 0;
}

.legend-toggle {
  background: transparent;
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  padding: 2px 8px;
  cursor: pointer;
  color: var(--pdw-text-muted);
  font-size: 14px;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.legend-toggle:hover {
  border-color: var(--pdw-text-muted);
  color: var(--pdw-text);
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--pdw-text);
  cursor: pointer;
}

/* Flat square swatches; click to show/hide that category */
.legend-color {
  width: 16px;
  height: 16px;
  border: 1px solid;
  box-sizing: border-box;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.legend-color-hidden {
  background: var(--pdw-surface) !important;
  border-color: var(--pdw-text-muted) !important;
}

.legend-x {
  color: var(--pdw-text-muted);
  font-size: 12px;
  line-height: 1;
}

.legend-link {
  color: inherit;
  text-decoration: none;
}

.legend-link:hover {
  text-decoration: underline;
}

.tooltip {
  position: fixed;
  background: var(--pdw-surface);
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  padding: 8px;
  pointer-events: none;
  z-index: 10000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  width: 320px;
  box-sizing: border-box;
  font-size: 14px;
  backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.98);
  line-height: 1.2;
}

.tooltip-header {
  font-weight: 600;
  font-size: 14px;
  color: var(--pdw-text-muted);
  overflow-wrap: anywhere;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--pdw-border);
}

/* Label column sized to the longest label; values wrap inside the card */
.tooltip-rows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
}

.tooltip-label {
  font-weight: 600;
  color: var(--pdw-text-muted);
  margin: 0;
}

.tooltip-value {
  font-weight: 500;
  color: var(--pdw-text);
  text-align: right;
  overflow-wrap: anywhere;
}

/* Expression scale: centered under its map, two-thirds of its width */
.legend-gradient {
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* "None" swatch, then the Low → High bar; together two-thirds of the width */
.gradient-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 66%;
}
.none-key {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 16px;
  font-size: 14px;
  color: var(--pdw-text-muted);
  flex-shrink: 0;
}
.none-swatch {
  width: 16px;
  height: 16px;
}
.gradient-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.map-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
/* Centered on the cluster, with a halo in the background color so it reads over points */
.map-label {
  position: absolute;
  transform: translate(-50%, -50%);
  font-weight: 600;
  color: var(--pdw-text);
  white-space: nowrap;
  line-height: 1;
  text-shadow:
    0 0 2px var(--pdw-surface),
    0 0 2px var(--pdw-surface),
    0 0 3px var(--pdw-surface),
    0 0 4px var(--pdw-surface);
}

/* Background set inline from the same colors as the map points */
.gradient-fill {
  height: 16px;
}

.gradient-labels {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  color: var(--pdw-text-muted);
}

.loading-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: rgba(255, 255, 255, 0.95);
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
  margin-top: 16px;
  font-size: 14px;
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
  height: 100vh;
  background: #fff3cd;
  border: 1px solid #ffc107;
  padding: 16px;
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

.retry-btn {
  margin-left: 8px;
}
</style>
../dataManager
