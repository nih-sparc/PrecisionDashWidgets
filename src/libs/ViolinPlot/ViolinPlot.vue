<template>
  <div class="violin-plot-container">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">Loading data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>� Error:</strong> {{ error }}
    </div>

    <!-- Main Dashboard -->
    <div v-else class="dashboard">
      <div class="header">
        <h3 class="title">Gene Expression Distribution</h3>
      </div>

      <div class="content-layout">
        <!-- Controls -->
        <div class="controls">
          <label class="label">
            X-axis (Metadata):
            <select
              v-model="selectedMetadataColumn"
              @change="updateViolin"
              class="select"
            >
              <option v-for="col in metadataColumns" :key="col" :value="col">
                {{ col }}
              </option>
            </select>
          </label>

          <label class="label gene-expression-label">
            Gene Expression
            <div class="gene-input-wrapper">
              <input
                v-model="geneSearch"
                type="text"
                placeholder="Enter gene name (e.g., CDH9)"
                class="gene-input"
                list="gene-suggestions"
                @input="debouncedSearchGenes"
              />
              <datalist id="gene-suggestions">
                <option
                  v-for="gene in geneSuggestions"
                  :key="gene"
                  :value="gene"
                />
              </datalist>
              <button
                @click="handleGeneSelect"
                :disabled="!geneSearch.trim() || dataLoading"
                class="visualize-btn"
              >
                {{ dataLoading ? "Loading..." : "Visualize" }}
              </button>
            </div>
          </label>

          <label class="label">
            Plot Type:
            <div class="plot-type-toggle">
              <button
                @click="plotType = 'violin'"
                :class="{ active: plotType === 'violin' }"
                class="toggle-btn"
              >
                Violin
              </button>
              <button
                @click="plotType = 'box'"
                :class="{ active: plotType === 'box' }"
                class="toggle-btn"
              >
                Box
              </button>
            </div>
          </label>

          <label class="checkbox-label">
            <input
              v-model="showDataPoints"
              type="checkbox"
              class="checkbox"
              @change="updateDataPoints"
            />
            Show data points
          </label>
        </div>

        <!-- Violin Plot Canvas -->
        <div class="plot-container">
          <div v-if="dataLoading" class="loading-overlay">
            <div class="small-spinner"></div>
            <p>Loading data...</p>
          </div>
          <svg ref="violinSvg" class="violin-svg"></svg>
          <canvas ref="dataPointsCanvas" class="data-points-canvas"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import * as d3 from "d3";
import { UMAPGeneViewer } from "../dataManager";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
  metadataColumn: { type: String, default: null },
  gene: { type: String, default: null },
});

// Emits
const emit = defineEmits(["update:Vars"]);

// Refs
const violinSvg = ref(null);
const dataPointsCanvas = ref(null);
const manager = ref(null);

// State
const loading = ref(true);
const error = ref(null);
const dataLoading = ref(false);
const umapData = ref([]);

// X-axis (metadata)
const metadataColumns = ref([]);
const selectedMetadataColumn = ref(props.metadataColumn || "");

// Y-axis (cell info)
const yAxisType = ref("gene");
const geneSearch = ref(props.gene || "");
const selectedGene = ref(props.gene || "");
const geneSuggestions = ref([]);

// Plot options
const plotType = ref("violin"); // 'violin' or 'box'
const showDataPoints = ref(false);

// Plot data
const violinData = ref([]);

// Search timeout
let searchTimeout = null;

// Watches
watch(
  () => props.metadataColumn,
  (newVal) => {
    if (newVal && newVal !== selectedMetadataColumn.value) {
      selectedMetadataColumn.value = newVal;
      if (umapData.value.length > 0) {
        updateViolin();
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
        renderViolinPlot();
      }
    }
  }
);

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

watch(plotType, () => {
  if (violinData.value.length > 0) {
    drawViolinPlot(violinData.value);
    if (showDataPoints.value) {
      drawDataPoints(violinData.value);
    }
  }
});

// Handle window resize for both SVG and canvas
let resizeTimeout = null;
const handleResize = () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (violinData.value.length > 0) {
      drawViolinPlot(violinData.value);
      if (showDataPoints.value) {
        drawDataPoints(violinData.value);
      }
    }
  }, 100);
};

// Initialize
onMounted(async () => {
  // Add resize listener for canvas
  window.addEventListener("resize", handleResize);

  try {
    manager.value = new UMAPGeneViewer(props.dataPath);
    await manager.value.initialize();

    const data = await manager.value.getReductionData("umap");
    umapData.value = data;

    // Extract metadata columns
    if (data.length > 0) {
      const sample = data[0];
      const cols = Object.keys(sample).filter(
        (key) =>
          !["cell_id", "umap_1", "umap_2", "tsne_1", "tsne_2"].includes(key)
      );
      metadataColumns.value = cols;

      if (cols.length > 0) {
        // Use prop if provided, otherwise default logic
        if (props.metadataColumn && cols.includes(props.metadataColumn)) {
          selectedMetadataColumn.value = props.metadataColumn;
        } else if (!selectedMetadataColumn.value) {
          // Default to Atlas_annotations if available
          selectedMetadataColumn.value = cols.includes("Atlas_annotation")
            ? "Atlas_annotation"
            : cols[0];
        }
      }
    }

    loading.value = false;

    await nextTick();

    // Render if gene is provided via prop
    if (props.gene) {
      selectedGene.value = props.gene;
      geneSearch.value = props.gene;
      yAxisType.value = "gene";
      await renderViolinPlot();
    }
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (resizeTimeout) clearTimeout(resizeTimeout);

  window.removeEventListener("resize", handleResize);

  // Clear canvas
  const canvas = dataPointsCanvas.value;
  if (canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

// Debounced gene search
function debouncedSearchGenes() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    if (geneSearch.value.length < 2) {
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
  selectedGene.value = geneSearch.value.trim().toUpperCase();
  await renderViolinPlot();
}

// Update violin plot
async function updateViolin() {
  if (selectedGene.value) {
    await renderViolinPlot();
  }
}

// Render violin plot for gene expression
async function renderViolinPlot() {
  if (!selectedGene.value || !selectedMetadataColumn.value) return;

  try {
    dataLoading.value = true;
    const geneData = await manager.value.getGeneExpression(selectedGene.value);
    dataLoading.value = false;

    // Create expression map
    const exprMap = new Map(geneData.map((d) => [d.cell_id, d.expression]));

    // Group data by metadata category
    const grouped = new Map();
    umapData.value.forEach((cell) => {
      const category = cell[selectedMetadataColumn.value];
      const expression = exprMap.get(cell.cell_id) || 0;

      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category).push(expression);
    });

    // Convert to array format
    const data = Array.from(grouped.entries()).map(([category, values]) => ({
      category: String(category),
      values: values,
    }));

    violinData.value = data;
    await nextTick();
    drawViolinPlot(data);
    if (showDataPoints.value) {
      drawDataPoints(data);
    }
  } catch (err) {
    console.error("Failed to render violin plot:", err);
    error.value = `Failed to load gene data: ${err.message}`;
    dataLoading.value = false;
  }
}

// Draw violin plot using D3
function drawViolinPlot(data) {
  const svg = d3.select(violinSvg.value);
  svg.selectAll("*").remove(); // Clear previous plot

  if (!data || data.length === 0) return;

  // Get actual container dimensions
  const container = svg.node().parentElement;
  const rect = container.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const margin = { top: 40, right: 40, bottom: 80, left: 80 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  // Remove viewBox, set explicit dimensions
  svg
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", null)
    .attr("preserveAspectRatio", null);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // X scale - categorical
  const xScale = d3
    .scaleBand()
    .domain(data.map((d) => d.category))
    .range([0, innerWidth])
    .padding(0.2);

  // Y scale - numeric (expression values)
  const allValues = data.flatMap((d) => d.values);
  const yExtent = d3.extent(allValues);
  const yScale = d3
    .scaleLinear()
    .domain(yExtent)
    .range([innerHeight, 0])
    .nice();

  // Color scale
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  // Kernel density estimator
  function kernelDensityEstimator(kernel, thresholds) {
    return function (values) {
      return thresholds.map((t) => [t, d3.mean(values, (v) => kernel(t - v))]);
    };
  }

  function kernelEpanechnikov(bandwidth) {
    return function (v) {
      return Math.abs((v /= bandwidth)) <= 1
        ? (0.75 * (1 - v * v)) / bandwidth
        : 0;
    };
  }

  // Draw plots for each category
  data.forEach((d) => {
    const category = d.category;
    const values = d.values.filter((v) => v != null && !isNaN(v));

    if (values.length === 0) return;

    const sortedValues = values.slice().sort(d3.ascending);
    const median = d3.median(sortedValues);
    const q1 = d3.quantile(sortedValues, 0.25);
    const q3 = d3.quantile(sortedValues, 0.75);
    const iqr = q3 - q1;
    const min = d3.min(sortedValues);
    const max = d3.max(sortedValues);
    const x1 = xScale(category) + xScale.bandwidth() / 2;

    if (plotType.value === "violin") {
      // Calculate bandwidth using Silverman's rule of thumb
      const std = d3.deviation(values);
      const n = values.length;
      const bandwidth = 1.06 * std * Math.pow(n, -1 / 5);

      // Generate density estimate
      const thresholds = yScale.ticks(50);
      const density = kernelDensityEstimator(
        kernelEpanechnikov(bandwidth),
        thresholds
      )(values);

      // Scale for violin width
      const maxDensity = d3.max(density, (d) => d[1]);
      const xNum = d3
        .scaleLinear()
        .domain([0, maxDensity])
        .range([0, xScale.bandwidth() / 2]);

      // Store scales on svg for later use by data points
      svg.property("__scales__", { xScale, yScale, margin, width, height });

      // Draw violin shape
      const area = d3
        .area()
        .x0((d) => xScale(category) + xScale.bandwidth() / 2 - xNum(d[1]))
        .x1((d) => xScale(category) + xScale.bandwidth() / 2 + xNum(d[1]))
        .y((d) => yScale(d[0]))
        .curve(d3.curveCatmullRom);

      g.append("path")
        .datum(density)
        .attr("d", area)
        .attr("fill", colorScale(category))
        .attr("opacity", 0.7)
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 1.5);

      // Draw median line
      g.append("line")
        .attr("x1", x1 - 5)
        .attr("x2", x1 + 5)
        .attr("y1", yScale(median))
        .attr("y2", yScale(median))
        .attr("stroke", "white")
        .attr("stroke-width", 3);

      // Draw box plot elements (quartiles)
      g.append("rect")
        .attr("x", x1 - 3)
        .attr("y", yScale(q3))
        .attr("width", 6)
        .attr("height", yScale(q1) - yScale(q3))
        .attr("fill", "white")
        .attr("stroke", "#333")
        .attr("stroke-width", 1);
    } else {
      // Box plot mode
      const boxWidth = Math.min(xScale.bandwidth() * 0.6, 80);
      const whiskerWidth = boxWidth * 0.5;

      // Store scales on svg
      svg.property("__scales__", { xScale, yScale, margin, width, height });

      // Draw whiskers (min to Q1, Q3 to max)
      g.append("line")
        .attr("x1", x1)
        .attr("x2", x1)
        .attr("y1", yScale(min))
        .attr("y2", yScale(q1))
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 2);

      g.append("line")
        .attr("x1", x1)
        .attr("x2", x1)
        .attr("y1", yScale(q3))
        .attr("y2", yScale(max))
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 2);

      // Draw whisker caps
      g.append("line")
        .attr("x1", x1 - whiskerWidth / 2)
        .attr("x2", x1 + whiskerWidth / 2)
        .attr("y1", yScale(min))
        .attr("y2", yScale(min))
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 2);

      g.append("line")
        .attr("x1", x1 - whiskerWidth / 2)
        .attr("x2", x1 + whiskerWidth / 2)
        .attr("y1", yScale(max))
        .attr("y2", yScale(max))
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 2);

      // Draw box (Q1 to Q3)
      g.append("rect")
        .attr("x", x1 - boxWidth / 2)
        .attr("y", yScale(q3))
        .attr("width", boxWidth)
        .attr("height", yScale(q1) - yScale(q3))
        .attr("fill", colorScale(category))
        .attr("opacity", 0.7)
        .attr("stroke", colorScale(category))
        .attr("stroke-width", 2);

      // Draw median line
      g.append("line")
        .attr("x1", x1 - boxWidth / 2)
        .attr("x2", x1 + boxWidth / 2)
        .attr("y1", yScale(median))
        .attr("y2", yScale(median))
        .attr("stroke", "white")
        .attr("stroke-width", 2.5);
    }
  });

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale))
    .selectAll("text")
    .attr("transform", "rotate(-45)")
    .style("text-anchor", "end")
    .style("font-size", "12px");

  // Y axis
  g.append("g")
    .call(d3.axisLeft(yScale))
    .selectAll("text")
    .style("font-size", "12px");

  // X axis label
  g.append("text")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + margin.bottom - 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "600")
    .text(selectedMetadataColumn.value);

  // Y axis label
  const yLabel = `${selectedGene.value} Expression`;

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -margin.left + 20)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "600")
    .text(yLabel);

  // Title
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "700")
    .text(`Violin Plot: ${yLabel} by ${selectedMetadataColumn.value}`);
}

// Draw data points as canvas overlay for better performance
function drawDataPoints(data) {
  if (!data || data.length === 0) return;

  const canvas = dataPointsCanvas.value;
  if (!canvas) return;

  const svg = d3.select(violinSvg.value);
  const scales = svg.property("__scales__");
  if (!scales) {
    console.warn("Scales not found on SVG");
    return;
  }

  const { xScale, yScale, margin, width, height } = scales;

  // Set canvas size to match SVG
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Apply transform to account for margins (no scaling needed now)
  ctx.save();
  ctx.translate(margin.left, margin.top);

  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  // Draw all points
  data.forEach((d) => {
    const category = d.category;
    const values = d.values.filter((v) => v != null && !isNaN(v));
    if (values.length === 0) return;

    const x1 = xScale(category) + xScale.bandwidth() / 2;
    const jitterWidth = xScale.bandwidth() * 0.35;
    const color = colorScale(category);

    ctx.fillStyle = color;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 0.3;
    ctx.globalAlpha = 0.4;

    values.forEach((value) => {
      const x = x1 + (Math.random() - 0.5) * jitterWidth;
      const y = yScale(value);

      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  });

  ctx.restore();
}
//Data Points
// Update data points display
function updateDataPoints() {
  if (violinData.value.length > 0) {
    if (showDataPoints.value) {
      drawDataPoints(violinData.value);
    } else {
      // Clear canvas
      const canvas = dataPointsCanvas.value;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }
}
</script>

<style scoped>
.violin-plot-container {
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
}

.header {
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
}

.controls {
  width: 20%;
  min-width: 250px;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  flex-shrink: 0;
  overflow-y: auto;
}

.label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  flex: 1;
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
  transition: all 0.2s;
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
  flex-direction: column;
  gap: 12px;
}

.gene-input {
  flex: 1;
  padding: 10px 14px;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 14px;
  background: white;
  color: #1a202c;
  transition: all 0.2s;
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
  padding: 10px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 2px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.2);
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
  gap: 8px;
}

.toggle-btn {
  flex: 1;
  padding: 8px 16px;
  background: white;
  border: 2px solid #e2e8f0;
  border-radius: 2px;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.toggle-btn:hover {
  border-color: #cbd5e1;
  background: #f8fafc;
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
  color: #64748b;
  cursor: pointer;
}

.checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #667eea;
}

.plot-container {
  flex: 1;
  width: 80%;
  position: relative;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.violin-svg {
  width: 100%;
  height: 100%;
  display: block;
}

.data-points-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.loading-container {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  background: rgba(255, 255, 255, 0.95);
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
../dataManager
