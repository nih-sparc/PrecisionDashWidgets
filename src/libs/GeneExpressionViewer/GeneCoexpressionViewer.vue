<template>
  <div class="gene-coexpression-viewer">
    <!-- LEFT PANE: controls + stats -->
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

            <div class="vs-separator"><span>vs</span></div>

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
            <span v-if="loading"
              ><span class="btn-spinner"></span>Loading...</span
            >
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

      <!-- Loading State (initialization only) -->
      <div v-if="loading && !viewer" class="loading-overlay">
        <div class="spinner"></div>
        <p>{{ loadingMessage }}</p>
      </div>

      <!-- Error -->
      <div v-if="error" class="error-panel">
        <strong>⚠️ Error:</strong> {{ error }}
        <button @click="error = null" class="dismiss-btn">Dismiss</button>
      </div>

      <!-- Stats -->
      <div v-if="showStats" class="stats-panel">
        <div class="stat-item">
          <span class="stat-label">Total cells:</span>
          <span class="stat-value">{{
            stats.totalCells.toLocaleString()
          }}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: gene1Color }"
            >{{ gene1 }} expressing:</span
          >
          <span class="stat-value"
            >{{ stats.gene1Expressing.toLocaleString() }} ({{
              stats.gene1Pct
            }}%)</span
          >
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: gene2Color }"
            >{{ gene2 }} expressing:</span
          >
          <span class="stat-value"
            >{{ stats.gene2Expressing.toLocaleString() }} ({{
              stats.gene2Pct
            }}%)</span
          >
        </div>
        <div class="stat-item">
          <span class="stat-label" :style="{ color: coexpressColor }"
            >Co-expressing:</span
          >
          <span class="stat-value"
            >{{ stats.coexpressing.toLocaleString() }} ({{
              stats.coexpressPct
            }}%)</span
          >
        </div>
      </div>
    </div>

    <!-- RIGHT PANE: chart + legend + gradient -->
    <div class="viewer-right">
      <div v-if="showChart || (loading && viewer)" class="chart-container">
        <div v-if="loading && viewer" class="chart-loading">
          <div class="small-spinner"></div>
          <p>{{ loadingMessage }}</p>
        </div>

        <div v-else style="position: relative; width: 100%; height: 100%">
          <canvas ref="chartCanvas"></canvas>

          <!-- Floating Color Mixer Toggle (collapsed) -->
          <!-- Replace your current floating-mixer-toggle button with this -->
          <button
            v-if="showChart || (loading && viewer)"
            class="floating-mixer-toggle"
            @click="gradientExpanded = !gradientExpanded"
            :title="
              gradientExpanded
                ? 'Hide Color Mixing Guide'
                : 'Open Color Mixing Guide'
            "
            :aria-expanded="gradientExpanded.toString()"
          >
            <!-- Chevron Up (collapsed) -->
            <svg
              v-if="!gradientExpanded"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 15l-6-6-6 6"></path>
            </svg>

            <!-- Chevron Down (expanded) -->
            <svg
              v-else
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M6 9l6 6 6-6"></path>
            </svg>
          </button>

          <!-- Floating Color Mixer Panel (expanded) -->
          <div
            v-if="gradientExpanded && (showChart || (loading && viewer))"
            class="floating-mixer-panel"
          >
            <div class="floating-mixer-header">
              <span>Color Mixing Guide</span>
              <!-- <button
                class="floating-mixer-close"
                @click="gradientExpanded = false"
                title="Close Color Mixing Guide"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button> -->
            </div>

            <div class="floating-gradient-container">
              <div>
                <canvas
                  ref="gradientCanvas"
                  class="gradient-canvas"
                  width="150"
                  height="150"
                  @click="renderGradientLegend"
                ></canvas>
                <div class="gradient-labels">
                  <div class="y-axis-label">
                    {{ gene2 || "Gene 2" }} Expression
                  </div>
                  <div class="x-axis-label">
                    {{ gene1 || "Gene 1" }} Expression
                  </div>
                  <div class="axis-arrow x-arrow-right">→</div>
                  <div class="axis-arrow y-arrow-top">↑</div>
                </div>
              </div>

              <div class="boost-control">
                <label for="boost-slider" class="boost-label">Boost</label>
                <input
                  id="boost-slider"
                  type="range"
                  v-model.number="coexpressionBoostFactor"
                  min="0.1"
                  max="100"
                  step="0.1"
                  @input="updateVisualization"
                  class="boost-slider-vertical"
                  orient="vertical"
                />
              </div>
            </div>
          </div>

          <!-- Tooltip -->
          <div
            v-if="hoveredPoint"
            class="tooltip"
            :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
          >
            <div class="tooltip-header">ID: {{ hoveredPoint.cell_id }}</div>
            <div
              v-for="(value, key) in getTooltipData(hoveredPoint)"
              :key="key"
              class="tooltip-row"
            >
              <span class="tooltip-label" :style="getTooltipLabelStyle(key)"
                >{{ formatLabel(key) }}:</span
              >
              <span class="tooltip-value">{{ formatValue(key, value) }}</span>
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
            <span>None</span>
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
          <div class="legend-item">
            <input
              type="color"
              v-model="coexpressColor"
              class="color-picker"
              @change="updateVisualization"
              title="Choose color for co-expression"
            />
            <span>Both</span>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="!showChart && !loading && !error" class="empty-state">
        <div class="empty-icon">🔬</div>
        <h3>Ready to visualize gene co-expression</h3>
        <p>Select two genes and a dimension reduction method to get started</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import * as d3 from "d3";
import createRegl from "regl";
import { UMAPGeneViewer } from "./dataManager";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
  gene1: { type: [String, null], default: null },
  gene2: { type: [String, null], default: null },
});

// Emits
const emit = defineEmits(["update:Vars"]);

// Refs
const chartCanvas = ref(null);
const gradientCanvas = ref(null);
const reglInstance = ref(null);
const viewer = ref(null);
const currentZoom = ref(null);
const hoveredPoint = ref(null);
const tooltipPos = ref({ x: 0, y: 0 });
const pointsData = ref([]);
const resizeObserver = ref(null);
const lastCanvasSize = ref({ w: 0, h: 0 });

// State
const loading = ref(true);
const loadingMessage = ref("Initializing data viewer...");
const error = ref(null);
const selectedReduction = ref("umap");
const hasTsne = ref(false);
const gradientExpanded = ref(false);

// Gene selection - internal state
const gene1Search = ref(props.gene1 || "");
const gene2Search = ref(props.gene2 || "");
const gene1 = ref(props.gene1 || "");
const gene2 = ref(props.gene2 || "");
const gene1Suggestions = ref([]);
const gene2Suggestions = ref([]);

// Data
const reductionData = ref([]);
const gene1Data = ref(null);
const gene2Data = ref(null);

// Colors
const gene1Color = ref("#ff0000");
const gene2Color = ref("#0000ff");
const coexpressColor = ref("#FF00FF");
const noExpressionColor = ref("#CCCCCC");

// Co-expression boost factor
const coexpressionBoostFactor = ref(1);

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

// Watch props and update internal state
watch(
  () => props.gene1,
  (newVal) => {
    const value = newVal || "";
    if (value !== gene1.value && value !== gene1Search.value) {
      gene1Search.value = value;
      gene1.value = value;
      if (value && gene2.value && reductionData.value.length > 0) {
        visualize();
      }
    }
  }
);

watch(
  () => props.gene2,
  (newVal) => {
    const value = newVal || "";
    if (value !== gene2.value && value !== gene2Search.value) {
      gene2Search.value = value;
      gene2.value = value;
      if (value && gene1.value && reductionData.value.length > 0) {
        visualize();
      }
    }
  }
);

// Watch internal state and emit changes
watch(gene1, (newVal) => {
  if (newVal && newVal !== props.gene1) {
    emit("update:Vars", "selectedGene1", newVal);
  }
});

watch(gene2, (newVal) => {
  if (newVal && newVal !== props.gene2) {
    emit("update:Vars", "selectedGene2", newVal);
  }
});

// Computed
const canVisualize = computed(
  () =>
    gene1Search.value.trim() &&
    gene2Search.value.trim() &&
    gene1Search.value.trim() !== gene2Search.value.trim()
);
const showStats = computed(() => stats.value.totalCells > 0);
const showChart = computed(() => showStats.value);

// Debounced search
let searchTimeout = null;
const debouncedSearchGenes = (geneNumber) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchGenes(geneNumber), 300);
};

// Init
onMounted(async () => {
  try {
    loadingMessage.value = "Loading data manager...";
    viewer.value = new UMAPGeneViewer(props.dataPath);
    await viewer.value.initialize();
    hasTsne.value = viewer.value.hasTsne();
    await loadReductionData();
    loading.value = false;
    loadingMessage.value = "";

    // Responsive sizing (no fixed size)
    setupResizeObserver();

    // If both genes provided via props, visualize automatically
    if (props.gene1 && props.gene2) {
      gene1.value = props.gene1;
      gene2.value = props.gene2;
      gene1Search.value = props.gene1;
      gene2Search.value = props.gene2;
      await visualize();
    }
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}. Please check that your data files are in the correct location.`;
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (resizeObserver.value) resizeObserver.value.disconnect();
  if (reglInstance.value) reglInstance.value.destroy();
});

// Reactivity
watch(selectedReduction, async () => {
  if (!loading.value && reductionData.value.length > 0 && canVisualize.value) {
    await loadReductionData();
    await visualize();
  }
});

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
    (geneNumber === 1 ? gene1Suggestions : gene2Suggestions).value = [];
    return;
  }
  try {
    const results = await viewer.value.searchGenes(searchTerm);
    const suggestions = results.map((r) => r.gene_name).slice(0, 20);
    (geneNumber === 1 ? gene1Suggestions : gene2Suggestions).value =
      suggestions;
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

    gene1.value = gene1Search.value;
    gene2.value = gene2Search.value;

    loadingMessage.value = `Loading ${gene1.value} expression...`;
    gene1Data.value = await viewer.value.getGeneExpression(gene1.value);

    loadingMessage.value = `Loading ${gene2.value} expression...`;
    gene2Data.value = await viewer.value.getGeneExpression(gene2.value);

    loadingMessage.value = "Rendering visualization...";
    loading.value = false;
    loadingMessage.value = "";

    await nextTick();
    await renderChart();
  } catch (err) {
    console.error("Visualization failed:", err);
    error.value = `Failed to visualize: ${err.message}`;
    loading.value = false;
  }
}

// Helpers
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

// Responsive sizing via ResizeObserver
function setupResizeObserver() {
  const container = chartCanvas.value?.parentElement?.parentElement; // chart-container -> inner wrapper -> canvas
  if (!container) return;
  resizeObserver.value = new ResizeObserver(async () => {
    if (!chartCanvas.value || !showChart.value) return;
    await renderChart(); // re-render on container size change
  });
  resizeObserver.value.observe(container);
}

async function renderChart() {
  await nextTick();
  if (!chartCanvas.value) throw new Error("Chart canvas is not available");

  // Expression maps
  const gene1ExprMap = new Map(
    gene1Data.value.map((d) => [d.cell_id, d.expression])
  );
  const gene2ExprMap = new Map(
    gene2Data.value.map((d) => [d.cell_id, d.expression])
  );

  // Ranges
  const allExpr1 = gene1Data.value.map((d) => d.expression);
  const allExpr2 = gene2Data.value.map((d) => d.expression);
  const maxExpr1 = Math.max(...allExpr1);
  const maxExpr2 = Math.max(...allExpr2);

  const threshold = 0.1;

  // rgb guard 0–255
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const rgb256 = (arr) => {
    const max = Math.max(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0);
    const scaled = max <= 1 ? arr.map((c) => c * 255) : arr;
    return scaled.map(clamp255);
  };

  const points = reductionData.value.map((cell) => {
    const expr1 = gene1ExprMap.get(cell.cell_id) || 0;
    const expr2 = gene2ExprMap.get(cell.cell_id) || 0;

    const norm1 = maxExpr1 > 0 ? Math.min(expr1 / maxExpr1, 1) : 0;
    const norm2 = maxExpr2 > 0 ? Math.min(expr2 / maxExpr2, 1) : 0;

    const hasGene1 = expr1 > threshold;
    const hasGene2 = expr2 > threshold;

    const [rBase, gBase, bBase] = rgb256(hexToRgb(noExpressionColor.value));
    const [rG1, gG1, bG1] = rgb256(hexToRgb(gene1Color.value));
    const [rG2, gG2, bG2] = rgb256(hexToRgb(gene2Color.value));
    const [rCo, gCo, bCo] = rgb256(hexToRgb(coexpressColor.value));

    let mixedR = rBase * (1 - norm1) * (1 - norm2);
    let mixedG = gBase * (1 - norm1) * (1 - norm2);
    let mixedB = bBase * (1 - norm1) * (1 - norm2);

    mixedR += rG1 * norm1 * (1 - norm2);
    mixedG += gG1 * norm1 * (1 - norm2);
    mixedB += bG1 * norm1 * (1 - norm2);

    mixedR += rG2 * (1 - norm1) * norm2;
    mixedG += gG2 * (1 - norm1) * norm2;
    mixedB += bG2 * (1 - norm1) * norm2;

    if (norm1 > 0 && norm2 > 0) {
      const blendWeight = norm1 * norm2;
      const blendR = (rG1 + rG2) / 2;
      const blendG = (gG1 + gG2) / 2;
      const blendB = (bG1 + bG2) / 2;
      mixedR += blendR * blendWeight;
      mixedG += blendG * blendWeight;
      mixedB += blendB * blendWeight;

      const coexpressWeight =
        Math.pow(blendWeight, 2) * coexpressionBoostFactor.value;
      const newTotal = 1 + coexpressWeight;
      mixedR = (mixedR + rCo * coexpressWeight) / newTotal;
      mixedG = (mixedG + gCo * coexpressWeight) / newTotal;
      mixedB = (mixedB + bCo * coexpressWeight) / newTotal;
    }

    let zIndex = 0,
      opacity = 1;
    if (hasGene1 && hasGene2) {
      zIndex = 3;
      opacity = 0.9;
    } else if (hasGene1) {
      zIndex = 2;
      opacity = 0.8;
    } else if (hasGene2) {
      zIndex = 1;
      opacity = 0.8;
    }

    const color = `rgb(${clamp255(mixedR)}, ${clamp255(mixedG)}, ${clamp255(
      mixedB
    )})`;

    return {
      ...cell,
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

  points.sort((a, b) => a.zIndex - b.zIndex);
  pointsData.value = points;

  // Stats
  const g1Only = points.filter(
    (p) => p.expr1 > threshold && p.expr2 <= threshold
  ).length;
  const g2Only = points.filter(
    (p) => p.expr2 > threshold && p.expr1 <= threshold
  ).length;
  const coexp = points.filter(
    (p) => p.expr1 > threshold && p.expr2 > threshold
  ).length;
  stats.value = {
    totalCells: points.length,
    gene1Expressing: g1Only,
    gene1Pct: ((g1Only / points.length) * 100).toFixed(1),
    gene2Expressing: g2Only,
    gene2Pct: ((g2Only / points.length) * 100).toFixed(1),
    coexpressing: coexp,
    coexpressPct: ((coexp / points.length) * 100).toFixed(1),
  };

  // Sizing: fill container (no fixed size)
  const canvas = chartCanvas.value;
  const container = canvas.parentElement; // inner wrapper
  const rect = container.getBoundingClientRect();
  const pad = 0; // padding already in outer container
  const width = Math.max(1, Math.floor(rect.width - pad));
  const height = Math.max(1, Math.floor(rect.height - pad));
  const sizeChanged =
    width !== lastCanvasSize.value.w || height !== lastCanvasSize.value.h;

  if (sizeChanged) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    lastCanvasSize.value = { w: width, h: height };
    // Recreate REGL on size change to keep viewport correct
    if (reglInstance.value) {
      try {
        reglInstance.value.destroy();
      } catch {}
      reglInstance.value = null;
    }
  }

  // REGL setup
  try {
    if (!reglInstance.value) reglInstance.value = createRegl(canvas);
  } catch (err) {
    console.error("WebGL not supported, fallback to 2D:", err);
    renderChart2D(points);
    return;
  }

  const regl = reglInstance.value;

  // Scales -> NDC
  const xExtent = d3.extent(points, (d) => d.x);
  const yExtent = d3.extent(points, (d) => d.y);
  const xPad = (xExtent[1] - xExtent[0]) * 0.05;
  const yPad = (yExtent[1] - yExtent[0]) * 0.05;
  xExtent[0] -= xPad;
  xExtent[1] += xPad;
  yExtent[0] -= yPad;
  yExtent[1] += yPad;

  const xScale = d3.scaleLinear().domain(xExtent).range([-1, 1]);
  const yScale = d3.scaleLinear().domain(yExtent).range([-1, 1]);

  // Buffers
  const positions = [];
  const colors = [];
  points.forEach((p) => {
    positions.push(xScale(p.x), yScale(p.y));
    if (p.color.startsWith("#")) {
      const rgb = hexToRgb(p.color);
      colors.push(...rgb, p.opacity);
    } else {
      const m = p.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (m)
        colors.push(
          parseInt(m[1]) / 255,
          parseInt(m[2]) / 255,
          parseInt(m[3]) / 255,
          p.opacity
        );
      else colors.push(0.8, 0.8, 0.8, p.opacity);
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
    count: points.length,
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

  // Zoom: pan via d3.zoom; wheel = custom zoom-at-cursor
  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 10])
    .filter((event) => event.type !== "wheel")
    .on("zoom", (event) => {
      if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
        currentZoom.value = event.transform;
        render();
      }
    });

  d3.select(canvas).call(zoom);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = event.clientX - r.left;
      const my = event.clientY - r.top;
      const tr = currentZoom.value || d3.zoomIdentity;

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
      currentZoom.value = newTransform;
      render();
      d3.select(canvas).property("__zoom", newTransform);
    },
    { passive: false }
  );

  canvas.addEventListener("mousemove", (event) => {
    const r = canvas.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;
    const tr = currentZoom.value || d3.zoomIdentity;

    const ndcX = (mx / canvas.width) * 2 - 1;
    const ndcY = -((my / canvas.height) * 2 - 1);

    const hoverRadius = 10 / tr.k;
    let closestPoint = null;
    let closestDist = hoverRadius;
    let closestIndex = -1;

    pointsData.value.forEach((p, i) => {
      const px = xScale(p.x);
      const py = yScale(p.y);
      const tX = (2 * tr.x) / canvas.width;
      const tY = -(2 * tr.y) / canvas.height;
      const tx = px * tr.k + tX;
      const ty = py * tr.k + tY;
      const dx = tx - ndcX;
      const dy = ty - ndcY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closestPoint = p;
        closestIndex = i;
      }
    });

    if (closestPoint) {
      hoveredPoint.value = closestPoint;
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 };
      drawHighlightedPoint(closestIndex, tr);
    } else {
      hoveredPoint.value = null;
      render();
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredPoint.value = null;
    render();
  });

  function render() {
    regl.clear({ color: [1, 1, 1, 1], depth: 1 });
    let scale = 1,
      translate = [0, 0],
      pointSize = 3;
    if (currentZoom.value) {
      const { k, x, y } = currentZoom.value;
      scale = k;
      translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
      pointSize = Math.max(2, 3 * k);
    }
    drawPoints({ scale, translate, pointSize });
  }

  function drawHighlightedPoint(idx, tr) {
    render();
    const p = pointsData.value[idx];
    const px = xScale(p.x);
    const py = yScale(p.y);

    const highlightDraw = regl({
      frag: `
        precision mediump float;
        varying vec4 vColor;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          if (d > 0.35) gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
          else {
            float a = vColor.a * (1.0 - smoothstep(0.2, 0.35, d));
            gl_FragColor = vec4(vColor.rgb, a);
          }
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
        pointSize: Math.max(12, 8 * tr.k),
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

  // First render
  render();

  // Legend
  await nextTick();
  renderGradientLegend();
}

// 2D fallback
function renderChart2D(points) {
  const canvas = chartCanvas.value;
  const ctx = canvas.getContext("2d");
  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();

  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(300, Math.floor(rect.height));

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

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  points.forEach((p) => {
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.opacity;
    ctx.beginPath();
    ctx.arc(xScale(p.x), yScale(p.y), 2, 0, 2 * Math.PI);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// Gradient legend (merged model with boost + guards)
function renderGradientLegend() {
  if (!gradientCanvas.value) return;
  const canvas = gradientCanvas.value;
  const ctx = canvas.getContext("2d");
  const size = Math.max(canvas.width || 150, canvas.height || 150);
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;

  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const rgb256 = (arr) => {
    const max = Math.max(arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0);
    const scaled = max <= 1 ? arr.map((c) => c * 255) : arr;
    return scaled.map(clamp255);
  };

  const baseRgb = rgb256(hexToRgb(noExpressionColor.value));
  const gene1Rgb = rgb256(hexToRgb(gene1Color.value));
  const gene2Rgb = rgb256(hexToRgb(gene2Color.value));
  const coexpressRgb = rgb256(hexToRgb(coexpressColor.value));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const norm1 = x / (size - 1);
      const norm2 = (size - 1 - y) / (size - 1);

      let mixedR = baseRgb[0] * (1 - norm1) * (1 - norm2);
      let mixedG = baseRgb[1] * (1 - norm1) * (1 - norm2);
      let mixedB = baseRgb[2] * (1 - norm1) * (1 - norm2);

      mixedR += gene1Rgb[0] * norm1 * (1 - norm2);
      mixedG += gene1Rgb[1] * norm1 * (1 - norm2);
      mixedB += gene1Rgb[2] * norm1 * (1 - norm2);

      mixedR += gene2Rgb[0] * (1 - norm1) * norm2;
      mixedG += gene2Rgb[1] * (1 - norm1) * norm2;
      mixedB += gene2Rgb[2] * (1 - norm1) * norm2;

      if (norm1 > 0 && norm2 > 0) {
        const blendWeight = norm1 * norm2;
        const blendR = (gene1Rgb[0] + gene2Rgb[0]) / 2;
        const blendG = (gene1Rgb[1] + gene2Rgb[1]) / 2;
        const blendB = (gene1Rgb[2] + gene2Rgb[2]) / 2;
        mixedR += blendR * blendWeight;
        mixedG += blendG * blendWeight;
        mixedB += blendB * blendWeight;

        const coexpressWeight =
          Math.pow(blendWeight, 2) * coexpressionBoostFactor.value;
        const newTotal = 1 + coexpressWeight;
        mixedR = (mixedR + coexpressRgb[0] * coexpressWeight) / newTotal;
        mixedG = (mixedG + coexpressRgb[1] * coexpressWeight) / newTotal;
        mixedB = (mixedB + coexpressRgb[2] * coexpressWeight) / newTotal;
      }

      const idx = (y * size + x) * 4;
      data[idx] = clamp255(mixedR);
      data[idx + 1] = clamp255(mixedG);
      data[idx + 2] = clamp255(mixedB);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

// Tooltip helpers
function getTooltipData(point) {
  const data = {};
  if (point.cell_type) data.cell_type = point.cell_type;
  data[gene1.value] = point.expr1;
  data[gene2.value] = point.expr2;
  const exclude = new Set([
    "cell_id",
    "umap_1",
    "umap_2",
    "tsne_1",
    "tsne_2",
    "x",
    "y",
    "color",
    "zIndex",
    "opacity",
    "expr1",
    "expr2",
    "norm1",
    "norm2",
  ]);
  Object.keys(point).forEach((k) => {
    if (!exclude.has(k) && point[k] !== null && point[k] !== undefined)
      data[k] = point[k];
  });
  return data;
}
function getTooltipLabelStyle(key) {
  if (key === gene1.value) return { color: gene1Color.value };
  if (key === gene2.value) return { color: gene2Color.value };
  return {};
}
function formatLabel(key) {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function formatValue(key, value) {
  if (typeof value === "number") {
    if (key === gene1.value || key === gene2.value) return value.toFixed(3);
    if (value < 0.01 && value > 0) return value.toExponential(2);
    if (Math.abs(value) > 1000) return value.toLocaleString();
    return value.toFixed(2);
  }
  return value;
}

// Update on palette / boost changes
async function updateVisualization() {
  if (showChart.value) await renderChart();
  await nextTick();
  if (gradientExpanded.value) renderGradientLegend();
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
  display: grid;
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

.loading-overlay {
  position: fixed;
  inset: 0;
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
    transform: rotate(0);
  }
  100% {
    transform: rotate(360deg);
  }
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
  position: relative;
}
.chart-container canvas {
  width: auto;
  height: auto;
  display: block;
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

.tooltip {
  position: fixed;
  background: white;
  border: 2px solid #667eea;
  border-radius: 6px;
  padding: 12px;
  pointer-events: none;
  z-index: 10000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 200px;
  max-width: 300px;
  font-size: 13px;
  backdrop-filter: blur(8px);
  background: rgba(255, 255, 255, 0.98);
  line-height: 1.2;
}
.tooltip-header {
  font-weight: 700;
  font-size: 14px;
  color: #1a202c;
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e2e8f0;
}
.tooltip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
  gap: 8px;
}
.tooltip-label {
  font-weight: 600;
  color: #64748b;
  margin: 0;
}
.tooltip-value {
  font-weight: 500;
  color: #1a202c;
}

.legend-container {
  flex-direction: column;
  align-items: center;
}
.legend {
  flex-direction: row;
  align-items: flex-start;
  min-width: unset;
  width: 100%;
  display: flex;
  gap: 12px;
  background: white;
  border: 1px solid var(--border-color);
  border-radius: 2px;
  padding: 16px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  font-weight: 500;
  flex-shrink: 0;
  min-width: 0;
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
  transition: all 0.2s;
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

/* Floating Color Mixer */
.floating-mixer-toggle {
  position: absolute;
  bottom: 16px;
  right: 16px;
  width: 48px;
  height: 48px;
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: 10;
  color: #64748b;
}
.floating-mixer-toggle:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #1a202c;
  transform: translateY(-2px);
}

.floating-mixer-panel {
  position: absolute;
  bottom: 51px;
  right: 16px;
  background: white;
  border: 2px solid #e2e8f0;
  z-index: 10;
  min-width: 250px;
  overflow: hidden;
}
.floating-mixer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-bottom: 1px solid #e2e8f0;
  font-size: 14px;
  font-weight: 600;
  color: #1a202c;
}
.floating-mixer-close {
  background: none;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: #64748b;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.floating-mixer-close:hover {
  background: rgba(100, 116, 139, 0.1);
  color: #1a202c;
}

.floating-gradient-container {
  position: relative;
  display: inline-flex;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
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
  left: -38px;
  bottom: 60px;
  transform: rotate(-90deg);
  transform-origin: center;
  white-space: nowrap;
  z-index: 10;
  background: white;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 9px;
}
.x-axis-label {
  position: absolute;
  bottom: 5px;
  left: 60px;
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 10;
  background: white;
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 9px;
}
.axis-arrow {
  position: absolute;
  font-size: 12px;
  font-weight: bold;
  color: #94a3b8;
  z-index: 5;
}
.x-arrow-right {
  bottom: 5px;
  right: 60px;
}
.y-arrow-top {
  left: 5px;
  top: 20px;
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
  .controls-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    padding: 16px 20px;
  }
  .genes-input-group {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .vs-separator {
    order: 2;
    padding: 8px 0;
  }
  .genes-section {
    padding: 20px;
  }
}
</style>
