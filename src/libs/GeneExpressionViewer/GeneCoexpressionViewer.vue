<template>
  <div class="gene-coexpression-viewer">
    <!-- Controls -->
    <div class="viewer-left">
      <div class="controls-panel">
        <div class="controls-header">
          <h3>Gene Co-expression Analysis</h3>
          <div class="reduction-selector">
            <label for="reduction-select">Visualization:</label>
            <select
              id="reduction-select"
              v-model="selectedReduction"
              :disabled="loading"
            >
              <option value="umap">UMAP</option>
              <option value="tsne" :disabled="!hasTsne">
                tSNE {{ !hasTsne ? "(not available)" : "" }}
              </option>
            </select>
          </div>
        </div>

        <div class="genes-section">
          <div class="genes-input-group">
            <div class="gene-input-wrapper">
              <label for="gene1-select">
                <span class="gene-number">Gene 1</span>
                <span
                  v-if="gene1"
                  class="selected-gene"
                  :style="{ color: gene1Color }"
                  >{{ gene1 }}</span
                >
              </label>
              <input
                id="gene1-select"
                v-model="gene1Search"
                type="text"
                placeholder="Enter gene name (e.g., CDH9)"
                @input="debouncedSearchGenes(1)"
                :disabled="loading"
                list="gene1-list"
                autocomplete="off"
                class="gene-input"
              />
              <datalist id="gene1-list">
                <option
                  v-for="gene in gene1Suggestions"
                  :key="gene"
                  :value="gene"
                />
              </datalist>
            </div>
            <div class="vs-separator">
              <span>vs</span>
            </div>

            <div class="gene-input-wrapper">
              <label for="gene2-select">
                <span class="gene-number">Gene 2</span>
                <span
                  v-if="gene2"
                  class="selected-gene"
                  :style="{ color: gene2Color }"
                  >{{ gene2 }}</span
                >
              </label>
              <input
                id="gene2-select"
                v-model="gene2Search"
                type="text"
                placeholder="Enter gene name (e.g., TAC1)"
                @input="debouncedSearchGenes(2)"
                :disabled="loading"
                list="gene2-list"
                autocomplete="off"
                class="gene-input"
              />
              <datalist id="gene2-list">
                <option
                  v-for="gene in gene2Suggestions"
                  :key="gene"
                  :value="gene"
                />
              </datalist>
            </div>
          </div>
          <button
            @click="visualize"
            :disabled="!canVisualize || loading"
            class="visualize-btn"
          >
            <span v-if="loading">
              <span class="btn-spinner"></span>
              Loading...
            </span>
            <span v-else>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                style="margin-right: 8px; vertical-align: -2px"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <path d="m21 21-4.35-4.35"></path>
              </svg>
              Visualize Co-expression
            </span>
          </button>
        </div>
      </div>

      <!-- Loading State - only during initialization -->
      <div v-if="loading && !viewer" class="loading-overlay">
        <div class="spinner"></div>
        <p>{{ loadingMessage }}</p>
      </div>

      <!-- Error State -->
      <div v-if="error" class="error-panel">
        <strong>⚠️ Error:</strong> {{ error }}
        <button @click="error = null" class="dismiss-btn">Dismiss</button>
      </div>

      <!-- Stats Panel -->
      <div v-if="showStats" class="stats-panel">
        <div class="stat-item">
          <span class="stat-label">Total cells:</span>
          <span class="stat-value">{{
            stats.totalCells.toLocaleString()
          }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: gene1Color }">
            {{ gene1 }} expressing:
          </span>
          <span class="stat-value">
            {{ stats.gene1Expressing.toLocaleString() }} ({{ stats.gene1Pct }}%)
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: gene2Color }">
            {{ gene2 }} expressing:
          </span>
          <span class="stat-value">
            {{ stats.gene2Expressing.toLocaleString() }} ({{ stats.gene2Pct }}%)
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: coexpressColor }">
            Co-expressing:
          </span>
          <span class="stat-value">
            {{ stats.coexpressing.toLocaleString() }} ({{
              stats.coexpressPct
            }}%)
          </span>
        </div>
      </div>
    </div>
    <div class="viewer-right">
      <!-- Chart -->
      <div v-if="showChart || (loading && viewer)" class="chart-container">
        <div v-if="loading && viewer" class="chart-loading">
          <div class="small-spinner"></div>
          <p>{{ loadingMessage }}</p>
        </div>
        <div v-else style="position: relative; width: 100%; height: 100%">
          <canvas ref="chartCanvas"></canvas>
          <div
            v-if="hoveredPoint"
            class="tooltip"
            :style="{
              left: tooltipPos.x + 'px',
              top: tooltipPos.y + 'px',
            }"
          >
            <div class="tooltip-header">{{ hoveredPoint.cell_id }}</div>
            <div class="tooltip-row">
              <span class="tooltip-label">Cell Type:</span>
              <span class="tooltip-value">{{ hoveredPoint.cell_type }}</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label" :style="{ color: gene1Color }"
                >{{ gene1 }}:</span
              >
              <span class="tooltip-value">{{
                hoveredPoint.expr1.toFixed(3)
              }}</span>
            </div>
            <div class="tooltip-row">
              <span class="tooltip-label" :style="{ color: gene2Color }"
                >{{ gene2 }}:</span
              >
              <span class="tooltip-value">{{
                hoveredPoint.expr2.toFixed(3)
              }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div v-if="showStats" class="legend-container">
        <div class="legend">
          <div class="legend-item">
            <input
              type="color"
              v-model="noExpressionColor"
              class="color-picker"
              @change="updateVisualization"
              title="Choose color for no expression"
            />
            <span>No expression</span>
          </div>
          <div class="legend-item">
            <input
              type="color"
              v-model="gene1Color"
              class="color-picker"
              @change="updateVisualization"
              :title="`Choose color for ${gene1} only`"
            />
            <span>{{ gene1 }} only</span>
          </div>
          <div class="legend-item">
            <input
              type="color"
              v-model="gene2Color"
              class="color-picker"
              @change="updateVisualization"
              :title="`Choose color for ${gene2} only`"
            />
            <span>{{ gene2 }} only</span>
          </div>
        </div>

        <!-- Color Mixing Gradient Legend -->
        <div class="gradient-legend">
          <div
            class="gradient-header"
            @click="gradientExpanded = !gradientExpanded"
          >
            <h4>Color Mixing Guide</h4>
            <button class="toggle-btn" :class="{ expanded: gradientExpanded }">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
              >
                <polyline points="6,9 12,15 18,9"></polyline>
              </svg>
            </button>
          </div>
          <div v-if="gradientExpanded" class="gradient-container">
            <canvas
              ref="gradientCanvas"
              class="gradient-canvas"
              width="150"
              height="150"
              @click="renderGradientLegend"
            ></canvas>
            <div class="gradient-labels">
              <div class="y-axis-label">{{ gene2 }} Expression</div>
              <div class="x-axis-label">{{ gene1 }} Expression</div>
              <div class="axis-arrow x-arrow-right">→</div>
              <div class="axis-arrow y-arrow-top">↑</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Initial State -->
      <div v-if="!showChart && !loading && !error" class="empty-state">
        <div class="empty-icon">🔬</div>
        <h3>Ready to visualize gene co-expression</h3>
        <p>Select two genes and a dimension reduction method to get started</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import * as d3 from "d3";
import createRegl from "regl";
import { UMAPGeneViewer } from "./dataManager";

// Props
const props = defineProps({
  dataPath: {
    type: String,
    default: "/data",
  },
});

// Refs
const chartCanvas = ref(null);
const gradientCanvas = ref(null);
const reglInstance = ref(null);
const viewer = ref(null);
const currentZoom = ref(null);
const hoveredPoint = ref(null);
const tooltipPos = ref({ x: 0, y: 0 });
const pointsData = ref([]);

// State
const loading = ref(true);
const loadingMessage = ref("Initializing data viewer...");
const error = ref(null);
const selectedReduction = ref("umap");
const hasTsne = ref(false);
const gradientExpanded = ref(false);

// Gene selection
const gene1Search = ref("");
const gene2Search = ref("");
const gene1 = ref("");
const gene2 = ref("");
const gene1Suggestions = ref([]);
const gene2Suggestions = ref([]);

// Data
const reductionData = ref([]);
const gene1Data = ref(null);
const gene2Data = ref(null);

// Colors (reactive)
const gene1Color = ref("#ff0000"); // Red
const gene2Color = ref("#0000ff"); // Blue
const coexpressColor = ref("#F18F01"); // Professional orange
const noExpressionColor = ref("#CCCCCC"); // Light grey for background context

// Stats
const stats = ref({
  totalCells: 0,
  gene1Expressing: 0,
  gene1Pct: 0,
  gene2Expressing: 0,
  gene2Pct: 0,
  coexpressing: 0,
  coexpressPct: 0,
});

// Computed
const canVisualize = computed(() => {
  return (
    gene1Search.value.trim() &&
    gene2Search.value.trim() &&
    gene1Search.value.trim() !== gene2Search.value.trim()
  );
});

const showStats = computed(() => {
  return stats.value.totalCells > 0;
});

const showChart = computed(() => {
  return showStats.value;
});

// Debounce for gene search
let searchTimeout = null;
const debouncedSearchGenes = (geneNumber) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    searchGenes(geneNumber);
  }, 300);
};

// Initialize
onMounted(async () => {
  try {
    loadingMessage.value = "Loading data manager...";
    viewer.value = new UMAPGeneViewer(props.dataPath);
    await viewer.value.initialize();

    // Check if tSNE is available
    hasTsne.value = viewer.value.hasTsne();

    // Load initial reduction data
    await loadReductionData();

    loading.value = false;
    loadingMessage.value = "";
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}. Please check that your data files are in the correct location.`;
    loading.value = false;
  }
});

// Watch for reduction change
watch(selectedReduction, async (newReduction) => {
  if (!loading.value && reductionData.value.length > 0 && canVisualize.value) {
    await loadReductionData();
    await visualize();
  }
});

// Watch for gradient expansion to render canvas when shown
watch(gradientExpanded, async (isExpanded) => {
  if (isExpanded && showChart.value) {
    await nextTick();
    renderGradientLegend();
  }
});

// Methods
async function loadReductionData() {
  try {
    const data = await viewer.value.getReductionData(selectedReduction.value);
    reductionData.value = data;
    stats.value.totalCells = data.length;
  } catch (err) {
    console.error("Failed to load reduction data:", err);
    error.value = `Failed to load ${selectedReduction.value.toUpperCase()} data: ${
      err.message
    }`;
  }
}

async function searchGenes(geneNumber) {
  const searchTerm = geneNumber === 1 ? gene1Search.value : gene2Search.value;

  if (searchTerm.length < 2) {
    if (geneNumber === 1) {
      gene1Suggestions.value = [];
    } else {
      gene2Suggestions.value = [];
    }
    return;
  }

  try {
    const results = await viewer.value.searchGenes(searchTerm);
    const suggestions = results.map((r) => r.gene_name).slice(0, 20);

    if (geneNumber === 1) {
      gene1Suggestions.value = suggestions;
    } else {
      gene2Suggestions.value = suggestions;
    }
  } catch (err) {
    console.error("Gene search failed:", err);
  }
}

async function visualize() {
  if (!canVisualize.value) {
    error.value = "Please select two different genes";
    return;
  }

  try {
    loading.value = true;
    error.value = null;

    // Set selected genes from search
    gene1.value = gene1Search.value;
    gene2.value = gene2Search.value;

    // Load gene expression data
    loadingMessage.value = `Loading ${gene1.value} expression...`;
    gene1Data.value = await viewer.value.getGeneExpression(gene1.value);

    loadingMessage.value = `Loading ${gene2.value} expression...`;
    gene2Data.value = await viewer.value.getGeneExpression(gene2.value);

    // Merge data and render
    loadingMessage.value = "Rendering visualization...";

    // Set loading to false first so canvas becomes available
    loading.value = false;
    loadingMessage.value = "";

    // Wait for DOM update before rendering
    await nextTick();
    await renderChart();
  } catch (err) {
    console.error("Visualization failed:", err);
    error.value = `Failed to visualize: ${err.message}`;
    loading.value = false;
  }
}

// Helper functions for WebGL rendering
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

async function renderChart() {
  // Wait for next tick to ensure canvas is mounted
  await nextTick();

  // Ensure canvas is available
  if (!chartCanvas.value) {
    console.error("Canvas element not found");
    throw new Error("Chart canvas is not available");
  }

  // Create expression lookup maps
  const gene1ExprMap = new Map(
    gene1Data.value.map((d) => [d.cell_id, d.expression])
  );
  const gene2ExprMap = new Map(
    gene2Data.value.map((d) => [d.cell_id, d.expression])
  );

  // Calculate expression ranges for gradient scaling
  const allExpr1 = gene1Data.value.map((d) => d.expression);
  const allExpr2 = gene2Data.value.map((d) => d.expression);
  const maxExpr1 = Math.max(...allExpr1);
  const maxExpr2 = Math.max(...allExpr2);

  // Helper function to interpolate between two colors
  function interpolateColor(baseColor, targetColor, intensity) {
    const base = hexToRgb(baseColor);
    const target = hexToRgb(targetColor);

    const r = Math.round(
      base[0] * 255 + (target[0] * 255 - base[0] * 255) * intensity
    );
    const g = Math.round(
      base[1] * 255 + (target[1] * 255 - base[1] * 255) * intensity
    );
    const b = Math.round(
      base[2] * 255 + (target[2] * 255 - base[2] * 255) * intensity
    );

    return `rgb(${r}, ${g}, ${b})`;
  }

  // Helper function to blend two RGB colors
  function blendColors(color1, color2, weight1, weight2) {
    // Parse RGB colors
    const parseRgb = (color) => {
      if (color.startsWith("#")) return hexToRgb(color).map((c) => c * 255);
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      return match
        ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]
        : [128, 128, 128];
    };

    const rgb1 = parseRgb(color1);
    const rgb2 = parseRgb(color2);

    // Weighted average
    const r = Math.round(rgb1[0] * weight1 + rgb2[0] * weight2);
    const g = Math.round(rgb1[1] * weight1 + rgb2[1] * weight2);
    const b = Math.round(rgb1[2] * weight1 + rgb2[2] * weight2);

    return `rgb(${r}, ${g}, ${b})`;
  }

  // Prepare data points with gradient colors
  const threshold = 0.1; // Minimum threshold for expression
  const points = reductionData.value.map((cell) => {
    const expr1 = gene1ExprMap.get(cell.cell_id) || 0;
    const expr2 = gene2ExprMap.get(cell.cell_id) || 0;

    // Normalize expression values (0-1)
    const norm1 = maxExpr1 > 0 ? Math.min(expr1 / maxExpr1, 1.0) : 0;
    const norm2 = maxExpr2 > 0 ? Math.min(expr2 / maxExpr2, 1.0) : 0;

    let color = noExpressionColor.value;
    let zIndex = 0;
    let opacity = 1.0;

    const hasGene1 = expr1 > threshold;
    const hasGene2 = expr2 > threshold;

    if (hasGene1 && hasGene2) {
      // Co-expression: blend the two gene colors based on their relative expression
      // First interpolate each gene color from grey
      const gene1Contribution = interpolateColor(
        noExpressionColor.value,
        gene1Color.value,
        norm1
      );
      const gene2Contribution = interpolateColor(
        noExpressionColor.value,
        gene2Color.value,
        norm2
      );

      // Then blend the two colored contributions together
      const gene1Weight = norm1 / (norm1 + norm2);
      const gene2Weight = norm2 / (norm1 + norm2);

      color = blendColors(
        gene1Contribution,
        gene2Contribution,
        gene1Weight,
        gene2Weight
      );
      zIndex = 3;
      opacity = 0.9;
    } else if (hasGene1) {
      // Gene1 only: gradient from grey to gene1 color
      color = interpolateColor(
        noExpressionColor.value,
        gene1Color.value,
        norm1
      );
      zIndex = 2;
      opacity = 0.8;
    } else if (hasGene2) {
      // Gene2 only: gradient from grey to gene2 color
      color = interpolateColor(
        noExpressionColor.value,
        gene2Color.value,
        norm2
      );
      zIndex = 1;
      opacity = 0.8;
    }

    return {
      x: selectedReduction.value === "umap" ? cell.umap_1 : cell.tsne_1,
      y: selectedReduction.value === "umap" ? cell.umap_2 : cell.tsne_2,
      color,
      zIndex,
      opacity,
      expr1,
      expr2,
      norm1,
      norm2,
      cell_id: cell.cell_id,
      cell_type: cell.cell_type || "Unknown",
    };
  });

  // Sort by zIndex so important points render on top
  // Lower zIndex renders first (at bottom), higher zIndex renders last (on top)
  points.sort((a, b) => a.zIndex - b.zIndex);
  // Store points data for hover detection
  pointsData.value = points;
  // Debug: Check the distribution after sorting
  const zIndexCounts = {};
  const opacityCounts = {};
  const colorCounts = {};

  points.forEach((p) => {
    zIndexCounts[p.zIndex] = (zIndexCounts[p.zIndex] || 0) + 1;
    opacityCounts[p.opacity] = (opacityCounts[p.opacity] || 0) + 1;
    colorCounts[p.color] = (colorCounts[p.color] || 0) + 1;
  });

  console.log("Z-index distribution after sorting:", zIndexCounts);
  console.log("Opacity distribution:", opacityCounts);
  console.log("Color distribution:", colorCounts);
  console.log("Total points:", points.length);
  console.log(
    "First 10 points:",
    points.slice(0, 10).map((p) => ({
      zIndex: p.zIndex,
      opacity: p.opacity,
      color: p.color,
      expr1: p.expr1,
      expr2: p.expr2,
    }))
  );
  console.log(
    "Last 10 points:",
    points.slice(-10).map((p) => ({
      zIndex: p.zIndex,
      opacity: p.opacity,
      color: p.color,
      expr1: p.expr1,
      expr2: p.expr2,
    }))
  );

  // Calculate statistics
  const gene1Only = points.filter(
    (p) => p.expr1 > threshold && p.expr2 <= threshold
  ).length;
  const gene2Only = points.filter(
    (p) => p.expr2 > threshold && p.expr1 <= threshold
  ).length;
  const coexpressCount = points.filter(
    (p) => p.expr1 > threshold && p.expr2 > threshold
  ).length;

  stats.value = {
    totalCells: points.length,
    gene1Expressing: gene1Only,
    gene1Pct: ((gene1Only / points.length) * 100).toFixed(1),
    gene2Expressing: gene2Only,
    gene2Pct: ((gene2Only / points.length) * 100).toFixed(1),
    coexpressing: coexpressCount,
    coexpressPct: ((coexpressCount / points.length) * 100).toFixed(1),
  };

  // Debug the color assignments
  console.log("Color assignments check:");
  console.log("gene1Color.value:", gene1Color.value);
  console.log("gene2Color.value:", gene2Color.value);
  console.log("coexpressColor.value:", coexpressColor.value);
  console.log(
    "Sample points with gene1 only:",
    points
      .filter((p) => p.expr1 > threshold && p.expr2 <= threshold)
      .slice(0, 3)
      .map((p) => ({ color: p.color, expr1: p.expr1, expr2: p.expr2 }))
  );
  console.log(
    "Sample points with gene2 only:",
    points
      .filter((p) => p.expr2 > threshold && p.expr1 <= threshold)
      .slice(0, 3)
      .map((p) => ({ color: p.color, expr1: p.expr1, expr2: p.expr2 }))
  );
  console.log(
    "Sample points with coexpression:",
    points
      .filter((p) => p.expr1 > threshold && p.expr2 > threshold)
      .slice(0, 3)
      .map((p) => ({ color: p.color, expr1: p.expr1, expr2: p.expr2 }))
  );

  // Setup canvas and WebGL
  const canvas = chartCanvas.value;
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  // Set canvas size to container size
  canvas.width = rect.width - 48; // Account for padding
  canvas.height = rect.width - 48;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;

  // Create REGL instance
  try {
    if (reglInstance.value) {
      reglInstance.value.destroy();
    }
    reglInstance.value = createRegl(canvas);
  } catch (err) {
    console.error("WebGL not supported, falling back to canvas 2D");
    renderChart2D(points);
    return;
  }

  const regl = reglInstance.value;

  // Data bounds
  const xExtent = d3.extent(points, (d) => d.x);
  const yExtent = d3.extent(points, (d) => d.y);

  // Add padding
  const xPadding = (xExtent[1] - xExtent[0]) * 0.05;
  const yPadding = (yExtent[1] - yExtent[0]) * 0.05;
  xExtent[0] -= xPadding;
  xExtent[1] += xPadding;
  yExtent[0] -= yPadding;
  yExtent[1] += yPadding;

  // Create scales
  const xScale = d3.scaleLinear().domain(xExtent).range([-1, 1]);

  const yScale = d3.scaleLinear().domain(yExtent).range([-1, 1]);

  // Prepare WebGL data arrays
  const positions = [];
  const colors = [];

  points.forEach((point) => {
    positions.push(xScale(point.x), yScale(point.y));
    // Handle both hex and rgb color formats
    if (point.color.startsWith("#")) {
      const rgb = hexToRgb(point.color);
      colors.push(...rgb, point.opacity);
    } else {
      // Parse rgb() format
      const match = point.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        colors.push(
          parseInt(match[1]) / 255,
          parseInt(match[2]) / 255,
          parseInt(match[3]) / 255,
          point.opacity
        );
      } else {
        // Fallback to grey
        colors.push(0.8, 0.8, 0.8, point.opacity);
      }
    }
  });

  // Create WebGL draw command
  const drawPoints = regl({
    frag: `
      precision mediump float;
      varying vec4 vColor;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;
        
        float alpha = vColor.a * (1.0 - smoothstep(0.3, 0.5, dist));
        gl_FragColor = vec4(vColor.rgb, alpha);
      }
    `,

    vert: `
      precision mediump float;
      attribute vec2 position;
      attribute vec4 color;
      varying vec4 vColor;
      uniform float pointSize;
      uniform float scale;
      uniform vec2 translate;
      
      void main() {
        vec2 scaledPos = position * scale;
        vec2 translatedPos = scaledPos + translate;
        gl_Position = vec4(translatedPos, 0, 1);
        gl_PointSize = pointSize;
        vColor = color;
      }
    `,

    attributes: {
      position: positions,
      color: colors,
    },

    uniforms: {
      pointSize: regl.prop("pointSize"),
      scale: regl.prop("scale"),
      translate: regl.prop("translate"),
    },

    count: points.length,
    primitive: "points",

    // Disable depth testing - we want painter's algorithm (last drawn = on top)
    depth: {
      enable: false,
    },

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

  // Set up zoom behavior (disable wheel, we'll handle manually)
  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 10])
    .filter((event) => {
      // Prevent default zoom on wheel events
      return event.type !== "wheel";
    })
    .on("zoom", (event) => {
      // Handle pan events from d3
      if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
        currentZoom.value = event.transform;
        render();
      }
    });

  // Apply zoom for panning
  d3.select(canvas).call(zoom);

  // Custom wheel zoom anchored to cursor
  canvas.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;

      // Get current transform
      const transform = currentZoom.value || d3.zoomIdentity;

      // 1) Convert mouse position to NDC space (-1 to 1)
      const ndcX = (mx / canvas.width) * 2 - 1;
      const ndcY = -((my / canvas.height) * 2 - 1); // Flip Y for WebGL

      // 2) Convert NDC to data space using current transform
      // In your render, you do: scaledPos = position * scale; translatedPos = scaledPos + translate
      // So to reverse: dataPos = (ndcPos - translate) / scale
      const currentTranslateX = (2 * transform.x) / canvas.width;
      const currentTranslateY = -(2 * transform.y) / canvas.height;

      const dataX = (ndcX - currentTranslateX) / transform.k;
      const dataY = (ndcY - currentTranslateY) / transform.k;

      // 3) Calculate new scale
      const delta = -event.deltaY * 0.002;
      const kFactor = Math.pow(2, delta);
      let kNew = transform.k * kFactor;
      kNew = Math.max(0.5, Math.min(10, kNew));

      // 4) Calculate new translate in NDC space
      // We want: ndcX = dataX * kNew + newTranslateX
      const newTranslateX = ndcX - dataX * kNew;
      const newTranslateY = ndcY - dataY * kNew;

      // 5) Convert NDC translate back to pixel space for d3.zoomIdentity
      const xNew = (newTranslateX * canvas.width) / 2;
      const yNew = -(newTranslateY * canvas.height) / 2;

      // Create and apply new transform
      const newTransform = d3.zoomIdentity.translate(xNew, yNew).scale(kNew);

      currentZoom.value = newTransform;
      render();

      // Update d3 zoom state
      d3.select(canvas).property("__zoom", newTransform);
    },
    { passive: false }
  );

  // Add mousemove handler for hover detection
  canvas.addEventListener("mousemove", function (event) {
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    // Get current transform
    const transform = currentZoom.value || d3.zoomIdentity;

    // Convert mouse to NDC space
    const ndcX = (mx / canvas.width) * 2 - 1;
    const ndcY = -((my / canvas.height) * 2 - 1);

    // Find closest point within hover radius
    const hoverRadius = 10 / transform.k; // Adjust radius based on zoom
    let closestPoint = null;
    let closestDist = hoverRadius;
    let closestIndex = -1;

    pointsData.value.forEach((point, index) => {
      // Get point's NDC position (same as in vertex shader)
      const pointNDC = xScale(point.x);
      const pointNDCY = yScale(point.y);

      // Apply current transform
      const currentTranslateX = (2 * transform.x) / canvas.width;
      const currentTranslateY = -(2 * transform.y) / canvas.height;

      const transformedX = pointNDC * transform.k + currentTranslateX;
      const transformedY = pointNDCY * transform.k + currentTranslateY;

      // Calculate distance in NDC space
      const dx = transformedX - ndcX;
      const dy = transformedY - ndcY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestPoint = point;
        closestIndex = index;
      }
    });

    if (closestPoint) {
      hoveredPoint.value = closestPoint;
      tooltipPos.value = {
        x: mx + 15,
        y: my - 10,
      };

      // Draw enlarged point
      drawHighlightedPoint(closestIndex, transform);
    } else {
      hoveredPoint.value = null;
      // Re-render without highlight
      render();
    }
  });

  // Add mouseleave handler
  canvas.addEventListener("mouseleave", function () {
    hoveredPoint.value = null;
    render(); // Re-render to remove highlight
  });

  // Add mouseleave handler
  canvas.addEventListener("mouseleave", function () {
    hoveredPoint.value = null;
  });

  // Render function
  function render() {
    regl.clear({
      color: [1, 1, 1, 1],
      depth: 1,
    });

    let scale, translate, pointSize;

    if (currentZoom.value) {
      const { k, x, y } = currentZoom.value;
      scale = k;
      translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
      pointSize = Math.max(2, 3 * k); // Scale point size with zoom
    } else {
      scale = 1;
      translate = [0, 0];
      pointSize = 3;
    }

    drawPoints({
      scale,
      translate,
      pointSize,
    });
  }
  // Function to draw highlighted/enlarged point
  function drawHighlightedPoint(pointIndex, transform) {
    // First render all normal points
    render();

    // Then draw the highlighted point on top
    const point = pointsData.value[pointIndex];
    const pointNDC = xScale(point.x);
    const pointNDCY = yScale(point.y);

    // Create a single-point draw command for the highlighted point
    const highlightDraw = regl({
      frag: `
        precision mediump float;
        varying vec4 vColor;
        void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          if (dist > 0.5) discard;
          
          // Add a white border
          if (dist > 0.35) {
            gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
          } else {
            float alpha = vColor.a * (1.0 - smoothstep(0.2, 0.35, dist));
            gl_FragColor = vec4(vColor.rgb, alpha);
          }
        }
      `,

      vert: `
        precision mediump float;
        attribute vec2 position;
        attribute vec4 color;
        varying vec4 vColor;
        uniform float pointSize;
        uniform float scale;
        uniform vec2 translate;
        
        void main() {
          vec2 scaledPos = position * scale;
          vec2 translatedPos = scaledPos + translate;
          gl_Position = vec4(translatedPos, 0, 1);
          gl_PointSize = pointSize;
          vColor = color;
        }
      `,

      attributes: {
        position: [pointNDC, pointNDCY],
        color: (() => {
          if (point.color.startsWith("#")) {
            const rgb = hexToRgb(point.color);
            return [...rgb, point.opacity];
          } else {
            const match = point.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
              return [
                parseInt(match[1]) / 255,
                parseInt(match[2]) / 255,
                parseInt(match[3]) / 255,
                point.opacity,
              ];
            }
            return [0.8, 0.8, 0.8, point.opacity];
          }
        })(),
      },

      uniforms: {
        pointSize: Math.max(12, 8 * transform.k), // Enlarged size
        scale: transform.k,
        translate: [
          (2 * transform.x) / canvas.width,
          -(2 * transform.y) / canvas.height,
        ],
      },

      count: 1,
      primitive: "points",

      depth: {
        enable: false,
      },

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
  // Initial render
  render();

  // Render the gradient legend
  await nextTick();
  renderGradientLegend();
}

// Fallback 2D canvas rendering for browsers without WebGL
function renderChart2D(points) {
  const canvas = chartCanvas.value;
  const ctx = canvas.getContext("2d");
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  canvas.width = rect.width - 48;
  canvas.height = 600;

  const xExtent = d3.extent(points, (d) => d.x);
  const yExtent = d3.extent(points, (d) => d.y);

  const xScale = d3
    .scaleLinear()
    .domain(xExtent)
    .range([20, canvas.width - 20]);

  const yScale = d3
    .scaleLinear()
    .domain(yExtent)
    .range([canvas.height - 20, 20]);

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw points
  points.forEach((point) => {
    ctx.fillStyle = point.color;
    ctx.globalAlpha = point.opacity; // Use individual point opacity
    ctx.beginPath();
    ctx.arc(xScale(point.x), yScale(point.y), 2, 0, 2 * Math.PI);
    ctx.fill();
  });

  ctx.globalAlpha = 1;
}

// Function to render the color mixing gradient legend
function renderGradientLegend() {
  if (!gradientCanvas.value) return;

  const canvas = gradientCanvas.value;
  const ctx = canvas.getContext("2d");
  const size = 150;

  // Create image data for the gradient
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  // Helper function to interpolate between two colors
  function interpolateColor(baseColor, targetColor, intensity) {
    const base = hexToRgb(baseColor);
    const target = hexToRgb(targetColor);

    const r = Math.round(
      base[0] * 255 + (target[0] * 255 - base[0] * 255) * intensity
    );
    const g = Math.round(
      base[1] * 255 + (target[1] * 255 - base[1] * 255) * intensity
    );
    const b = Math.round(
      base[2] * 255 + (target[2] * 255 - base[2] * 255) * intensity
    );

    return [r, g, b];
  }

  // Helper function to blend two RGB colors
  function blendRGB(rgb1, rgb2, weight1, weight2) {
    const r = Math.round(rgb1[0] * weight1 + rgb2[0] * weight2);
    const g = Math.round(rgb1[1] * weight1 + rgb2[1] * weight2);
    const b = Math.round(rgb1[2] * weight1 + rgb2[2] * weight2);
    return [r, g, b];
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Normalize coordinates (0-1), with y flipped so bottom is 0
      const norm1 = x / (size - 1); // Gene 1 expression (x-axis)
      const norm2 = (size - 1 - y) / (size - 1); // Gene 2 expression (y-axis, flipped)

      let rgb;

      // Always apply gradual blending - no hard thresholds for smooth transitions
      if (norm1 > 0 && norm2 > 0) {
        // Both genes have some expression: blend the two gene colors
        const gene1Contribution = interpolateColor(
          noExpressionColor.value,
          gene1Color.value,
          norm1
        );
        const gene2Contribution = interpolateColor(
          noExpressionColor.value,
          gene2Color.value,
          norm2
        );

        const gene1Weight = norm1 / (norm1 + norm2);
        const gene2Weight = norm2 / (norm1 + norm2);

        rgb = blendRGB(
          gene1Contribution,
          gene2Contribution,
          gene1Weight,
          gene2Weight
        );
      } else if (norm1 > 0) {
        // Gene1 only: smooth gradient from grey to gene1 color
        rgb = interpolateColor(
          noExpressionColor.value,
          gene1Color.value,
          norm1
        );
      } else if (norm2 > 0) {
        // Gene2 only: smooth gradient from grey to gene2 color
        rgb = interpolateColor(
          noExpressionColor.value,
          gene2Color.value,
          norm2
        );
      } else {
        // No expression
        rgb = hexToRgb(noExpressionColor.value).map((c) => c * 255);
      }

      const index = (y * size + x) * 4;
      data[index] = rgb[0]; // Red
      data[index + 1] = rgb[1]; // Green
      data[index + 2] = rgb[2]; // Blue
      data[index + 3] = 255; // Alpha
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// Function to update visualization when colors change
async function updateVisualization() {
  if (showChart.value) {
    await renderChart();
  }
  // Also update the gradient legend
  await nextTick();
  renderGradientLegend();
}
</script>

<style scoped>
.gene-coexpression-viewer {
  display: flex;
  flex-direction: row;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0;
  height: 100%;
  gap: 16px;
}
.viewer-left {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  flex: 0 0 auto;
  gap: 16px;
}
.viewer-right {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 16px;
  flex: 1;
}
.controls-panel {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 0;
  flex: 1 1 50%;
}
.stats-panel {
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.05) 0%,
    rgba(118, 75, 162, 0.05) 100%
  );
  border: 1px solid var(--border-color);
  border-radius: 2px;
  padding: 24px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  flex: 1 1 50%;
}
.controls-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(180deg, #fafbfc 0%, #ffffff 100%);
}

.controls-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.reduction-selector {
  display: flex;
  align-items: center;
  gap: 12px;
}

.reduction-selector label {
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
}

.reduction-selector select {
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  font-size: 13px;
  background: white;
  color: #1a202c;
  cursor: pointer;
  transition: all 0.2s;
}

.reduction-selector select:hover {
  border-color: #cbd5e1;
}

.reduction-selector select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.genes-section {
  padding: 24px;
}

.genes-input-group {
  grid-template-columns: 1fr auto 1fr;
  display: Grid;
  align-items: end;
  gap: 16px;
  margin-bottom: 20px;
}

.gene-input-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gene-input-wrapper label {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  min-height: 20px;
}

.gene-number {
  font-weight: 600;
  color: #1a202c;
}

.selected-gene {
  font-weight: 600;
  font-size: 14px;
}

.gene-input {
  padding: 10px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 14px;
  transition: all 0.2s;
  background: white;
  color: #1a202c;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  min-height: 20px;
}

.gene-input:hover {
  border-color: #cbd5e1;
}

.gene-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.gene-input:disabled {
  background-color: #f8fafc;
  cursor: not-allowed;
  opacity: 0.6;
}

.gene-input::placeholder {
  color: #94a3b8;
}

.vs-separator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  flex-shrink: 0;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.visualize-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 2px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 44px;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);
}

.visualize-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);
}

.visualize-btn:disabled {
  background: #94a3b8;
  cursor: not-allowed;
  transform: none;
  opacity: 0.7;
  box-shadow: none;
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top: 2px solid white;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-right: 8px;
}

@media (max-width: 768px) {
  .controls-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    padding: 16px 20px;
  }

  .genes-input-group {
    flex-direction: column;
    gap: 16px;
  }

  .vs-separator {
    order: 2;
    padding-top: 0;
    padding: 8px 0;
  }

  .gene-input-wrapper:first-child {
    order: 1;
  }

  .gene-input-wrapper:last-child {
    order: 3;
  }

  .genes-section {
    padding: 20px;
  }
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(4px);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.spinner {
  width: 60px;
  height: 60px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid var(--primary-color);
  border-radius: 2px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.loading-overlay p {
  margin-top: 24px;
  font-size: 16px;
  color: var(--text-primary);
  font-weight: 500;
}

.error-panel {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 2px;
  padding: 16px;
  margin-bottom: 20px;
  color: #856404;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dismiss-btn {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #856404;
  border-radius: 2px;
  color: #856404;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.dismiss-btn:hover {
  background: #856404;
  color: white;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  background: white;
  border-radius: 2px;
}

.stat-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
}

.chart-container {
  min-height: 0;
  display: flex;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  padding: 24px;
  flex: 1;
}

.chart-container canvas {
  width: 100%;
  height: 100%;
}

.chart-loading {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 400px;
  color: var(--text-secondary);
}

.small-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

.chart-loading p {
  font-size: 14px;
  margin: 0;
}
.tooltip {
  position: absolute;
  background: white;
  border: 2px solid #667eea;
  border-radius: 6px;
  padding: 12px;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  font-size: 13px;
}

.tooltip-header {
  font-weight: 700;
  font-size: 14px;
  color: #1a202c;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #e2e8f0;
}

.tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  gap: 16px;
}

.tooltip-label {
  font-weight: 600;
  color: #64748b;
}

.tooltip-value {
  font-weight: 500;
  color: #1a202c;
}
.legend-container {
  display: flex;
  gap: 40px;
  align-items: flex-start;
  justify-content: center;
  flex-wrap: wrap;
}
.legend {
  display: flex;
  justify-content: center;
  gap: 32px;
  flex-wrap: wrap;
  padding: 20px;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.05) 0%,
    rgba(118, 75, 162, 0.05) 100%
  );
  border: 1px solid var(--border-color);
  border-radius: 2px;
  flex: 0 0 auto;
  align-items: center;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 500;
}
.color-picker {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-radius: 2px;
  cursor: pointer;
  padding: 0;
  background: none;
  outline: none;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.color-picker:hover {
  transform: scale(1.05);
  border-color: rgba(0, 0, 0, 0.2);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.color-picker:focus {
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.gradient-legend {
  position: relative;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  padding: 20px;
  text-align: center;
  min-width: 200px;
  min-height: 70px;
}

.gradient-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;
  padding: 2px 8px;
  border-radius: 2px;
}

.gradient-header:hover {
  background-color: #f8fafc;
}

.gradient-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #1a202c;
}

.toggle-btn {
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  border-radius: 2px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: rotate(0deg);
}

.toggle-btn:hover {
  background-color: #e2e8f0;
  color: #1a202c;
}

.toggle-btn.expanded {
  transform: rotate(180deg);
}

.toggle-btn svg {
  transition: transform 0.2s;
}

.gradient-container {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 10px;
  z-index: 100;
  display: inline-block;
}

.gradient-canvas {
  border: 2px solid #e2e8f0;
  border-radius: 2px;
}

.gradient-labels {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  font-size: 10px;
  font-weight: 500;
  color: #64748b;
}

.y-axis-label {
  position: absolute;
  left: -55px;
  top: 90%;
  transform: rotate(-90deg) translateX(50%);
  transform-origin: center;
  white-space: nowrap;
  z-index: 10;
  background: white;
  padding: 2px 4px;
  border-radius: 2px;
}

.x-axis-label {
  position: absolute;
  bottom: -15px;
  left: 30%;
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 10;
  background: white;
  padding: 2px 4px;
  border-radius: 2px;
}

.axis-arrow {
  position: absolute;
  font-size: 12px;
  font-weight: bold;
  color: #94a3b8;
  z-index: 5;
}

.x-arrow-left {
  bottom: -15px;
  left: -8px;
}

.x-arrow-right {
  bottom: -15px;
  right: 0px;
}

.y-arrow-bottom {
  left: -8px;
  bottom: -8px;
}

.y-arrow-top {
  left: -15px;
  top: 0px;
}
.empty-state {
  text-align: center;
  padding: 80px 20px;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 20px;
  opacity: 0.5;
}

.empty-state h3 {
  font-size: 24px;
  margin-bottom: 12px;
  color: var(--text-primary);
}

.empty-state p {
  font-size: 16px;
}

@media (max-width: 768px) {
  .controls-panel {
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .stats-panel {
    grid-template-columns: 1fr;
    padding: 16px;
  }

  .legend {
    flex-direction: column;
    align-items: flex-start;
  }

  .chart-container {
    padding: 16px;
  }

  .stat-value {
    font-size: 24px;
  }
}
</style>
