<template>
  <div class="pp-container">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">Loading data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>Error:</strong> {{ error }}
    </div>

    <!-- Main Dashboard -->
    <div v-else class="dashboard">
      <div class="header">
        <h3 class="title">Proportion Plot</h3>
      </div>

      <div class="content-layout">
        <!-- Controls -->
        <div class="controls">
          <label class="label">
            X-axis (group):
            <select
              v-model="xCol"
              @change="plot"
              class="select"
              :disabled="isLoading || metadataColumns.length === 0"
            >
              <option disabled value="">-- choose --</option>
              <option v-for="col in metadataColumns" :key="col" :value="col">
                {{ col }}
              </option>
            </select>
          </label>

          <label class="label">
            Y-axis (category):
            <select
              v-model="yCol"
              @change="plot"
              class="select"
              :disabled="isLoading || metadataColumns.length === 0"
            >
              <option disabled value="">-- choose --</option>
              <option v-for="col in metadataColumns" :key="col + '-y'" :value="col">
                {{ col }}
              </option>
            </select>
          </label>

          <button
            class="visualize-btn"
            :disabled="!xCol || !yCol || isLoading"
            @click="plot"
          >
            {{ isLoading ? "Working..." : "Plot" }}
          </button>

          <div class="pp-message" v-if="message">{{ message }}</div>
        </div>

        <!-- Plot + Legend -->
        <div class="plot-and-legend">
          <div class="plot-container">
            <div v-if="isLoading" class="loading-overlay">
              <div class="small-spinner"></div>
              <p>Computing proportions...</p>
            </div>
            <svg ref="plotSvg" class="plot-svg"></svg>
            <div
              v-if="tooltipData"
              class="pp-tooltip"
              :style="{ left: tooltipPos.x + 'px', top: tooltipPos.y + 'px' }"
            >
              <div class="pp-tooltip-header">{{ tooltipData.x }}</div>
              <div
                v-for="row in tooltipData.rows"
                :key="row.label"
                class="pp-tooltip-row"
              >
                <span class="legend-swatch" :style="{ background: row.color }"></span>
                <span class="pp-tooltip-label">{{ row.label }}</span>
                <span class="pp-tooltip-value">{{ row.pct }}</span>
              </div>
            </div>
          </div>
          <div v-if="legendItems.length" class="legend">
            <span
              v-for="item in legendItems"
              :key="item.label"
              class="legend-item"
            >
              <span class="legend-swatch" :style="{ background: item.color }"></span>
              {{ item.label }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import * as d3 from "d3";
import { UMAPGeneViewer } from "../dataManager";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
});

// Emits
const emit = defineEmits(["update:Vars"]);

// Refs
const plotSvg = ref(null);
const manager = ref(null);

// State
const loading = ref(true);
const error = ref(null);
const isLoading = ref(false);
const message = ref("");
const umapData = ref([]);

const metadataColumns = ref([]);
const xCol = ref("");
const yCol = ref("");

const MAX_X_GROUPS = 100;
const MAX_Y_CATS = 12;
const OTHER_LABEL = "(other)";

// Handle window resize
let resizeTimeout = null;
const handleResize = () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (proportionData.value.length > 0) {
      drawPlot(proportionData.value);
    }
  }, 100);
};

const proportionData = ref([]);
const legendItems = ref([]);
const tooltipData = ref(null);
const tooltipPos = ref({ x: 0, y: 0 });

// Initialize
onMounted(async () => {
  window.addEventListener("resize", handleResize);

  try {
    manager.value = new UMAPGeneViewer(props.dataPath);
    await manager.value.initialize();

    const data = await manager.value.getReductionData("umap");
    umapData.value = data;

    // Extract metadata columns (exclude coordinate columns)
    if (data.length > 0) {
      const sample = data[0];
      const cols = Object.keys(sample).filter(
        (key) =>
          !["cell_id", "umap_1", "umap_2", "tsne_1", "tsne_2"].includes(key)
      );
      metadataColumns.value = cols;

      if (cols.length >= 2) {
        xCol.value = cols.includes("Atlas_annotation")
          ? "Atlas_annotation"
          : cols[0];
        yCol.value = cols[1] !== xCol.value ? cols[1] : cols[0];
      } else if (cols.length === 1) {
        xCol.value = cols[0];
        yCol.value = cols[0];
      }
    }

    loading.value = false;

    await nextTick();

    // Auto-plot if we have columns
    if (xCol.value && yCol.value) {
      await plot();
    }
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  clearTimeout(resizeTimeout);
  window.removeEventListener("resize", handleResize);
});

// Compute proportions from the in-memory umapData
async function plot() {
  if (!xCol.value || !yCol.value || umapData.value.length === 0) return;

  isLoading.value = true;
  message.value = "Computing proportions...";

  try {
    await nextTick();

    const data = umapData.value;

    // Count occurrences per (x, y) group
    const counts = new Map();
    const xCounts = new Map();
    const yCounts = new Map();

    for (const row of data) {
      const x = String(row[xCol.value] ?? "(missing)");
      const y = String(row[yCol.value] ?? "(missing)");

      const key = `${x}\0${y}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      xCounts.set(x, (xCounts.get(x) || 0) + 1);
      yCounts.set(y, (yCounts.get(y) || 0) + 1);
    }

    // Limit x groups to top N
    const topX = Array.from(xCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_X_GROUPS)
      .map(([k]) => k);
    const topXSet = new Set(topX);

    // Limit y categories to top N, bucket rest as OTHER
    const topY = Array.from(yCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_Y_CATS)
      .map(([k]) => k);
    const topYSet = new Set(topY);

    // Rebuild counts with limits applied
    const filteredCounts = new Map();
    const filteredXTotals = new Map();

    for (const row of data) {
      const x = String(row[xCol.value] ?? "(missing)");
      if (!topXSet.has(x)) continue;

      let y = String(row[yCol.value] ?? "(missing)");
      if (!topYSet.has(y)) y = OTHER_LABEL;

      const key = `${x}\0${y}`;
      filteredCounts.set(key, (filteredCounts.get(key) || 0) + 1);
      filteredXTotals.set(x, (filteredXTotals.get(x) || 0) + 1);
    }

    // Compute proportions
    const rows = [];
    const yLevelsSet = new Set();
    for (const [key, n] of filteredCounts) {
      const [x, y] = key.split("\0");
      const total = filteredXTotals.get(x) || 1;
      rows.push({ x, y, p: n / total });
      yLevelsSet.add(y);
    }

    if (rows.length === 0) {
      message.value = "No data to plot.";
      return;
    }

    const xLevels = topX.filter((x) => filteredXTotals.has(x));
    const yLevels = Array.from(yLevelsSet);

    proportionData.value = { rows, xLevels, yLevels };
    await nextTick();
    drawPlot(proportionData.value);

    const trimmedNote =
      (xLevels.length >= MAX_X_GROUPS
        ? ` Limited to top ${MAX_X_GROUPS} ${xCol.value}.`
        : "") +
      (yLevels.includes(OTHER_LABEL)
        ? ` Limited to top ${MAX_Y_CATS} ${yCol.value} (+ ${OTHER_LABEL}).`
        : "");

    message.value = `Plotted ${yLevels.length} categories across ${xLevels.length} groups.${trimmedNote}`;
  } catch (err) {
    console.error("Failed to compute proportions:", err);
    message.value = `Error: ${err.message}`;
  } finally {
    isLoading.value = false;
  }
}

// Draw stacked bar chart using D3
function drawPlot({ rows, xLevels, yLevels }) {
  const svg = d3.select(plotSvg.value);
  svg.selectAll("*").remove();

  if (!rows || rows.length === 0) return;

  const node = svg.node();
  if (!node || !node.parentElement) return;

  const container = node.parentElement;
  const rect = container.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const maxLabelLength = Math.max(...xLevels.map((x) => x.length));
  const estimatedLabelHeight = Math.min(maxLabelLength * 5.5, 200) + 40;
  const margin = {
    top: 48,
    right: 16,
    bottom: Math.max(80, estimatedLabelHeight),
    left: 56,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  svg.attr("width", width).attr("height", height);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Build a lookup
  const lut = new Map();
  for (const r of rows) lut.set(`${r.x}\0${r.y}`, r.p);

  // X scale
  const xScale = d3
    .scaleBand()
    .domain(xLevels)
    .range([0, innerWidth])
    .padding(0.15);

  // Y scale (0 to 1 for proportions)
  const yScale = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);

  // Color scale
  const colorScale = d3
    .scaleOrdinal()
    .domain(yLevels)
    .range(d3.schemeCategory10);

  // Stack the data
  xLevels.forEach((xv) => {
    let cumulative = 0;
    yLevels.forEach((yv) => {
      const p = lut.get(`${xv}\0${yv}`) || 0;
      g.append("rect")
        .attr("x", xScale(xv))
        .attr("y", yScale(cumulative + p))
        .attr("width", xScale.bandwidth())
        .attr("height", yScale(cumulative) - yScale(cumulative + p))
        .attr("fill", colorScale(yv))
        .attr("opacity", 0.85)
        .style("cursor", "pointer")
        .on("mouseenter", (event) => {
          tooltipData.value = {
            x: xv,
            rows: yLevels
              .map((y) => ({
                label: y,
                color: colorScale(y),
                pct: ((lut.get(`${xv}\0${y}`) || 0) * 100).toFixed(1) + "%",
              }))
              .filter((r) => r.pct !== "0.0%"),
          };
        })
        .on("mousemove", (event) => {
          tooltipPos.value = { x: event.clientX + 12, y: event.clientY - 10 };
        })
        .on("mouseleave", () => {
          tooltipData.value = null;
        });
      cumulative += p;
    });
  });

  // X axis
  const xAxisGroup = g
    .append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale));

  const isAtlasAnnotation = xCol.value.toLowerCase() === 'atlas_annotation';

  if (isAtlasAnnotation) {
    // Wrap each tick text in an SVG <a> element linking to nervosensus
    xAxisGroup.selectAll(".tick").each(function () {
      const tick = d3.select(this);
      const textEl = tick.select("text");
      const label = textEl.text();
      const href = `https://nervosensus.netlify.app/?view=cards&atlasannotation=${label}`;

      const link = tick.append("a")
        .attr("href", href)
        .attr("target", "_blank");

      link.node().appendChild(textEl.node());

      textEl
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end")
        .style("font-size", "12px")
        .style("fill", "#667eea")
        .style("cursor", "pointer");
    });
  } else {
    xAxisGroup
      .selectAll("text")
      .attr("transform", "rotate(-45)")
      .style("text-anchor", "end")
      .style("font-size", "12px");
  }

  // Y axis
  g.append("g")
    .call(d3.axisLeft(yScale).tickFormat(d3.format(".0%")))
    .selectAll("text")
    .style("font-size", "12px");

  // Y axis label
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerHeight / 2)
    .attr("y", -margin.left + 16)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "600")
    .text("Proportion");

  // X axis label
  g.append("text")
    .attr("x", innerWidth / 2)
    .attr("y", innerHeight + margin.bottom - 10)
    .attr("text-anchor", "middle")
    .style("font-size", "14px")
    .style("font-weight", "600")
    .text(xCol.value);

  // Title
  svg
    .append("text")
    .attr("x", width / 2)
    .attr("y", 24)
    .attr("text-anchor", "middle")
    .style("font-size", "16px")
    .style("font-weight", "700")
    .text(`${yCol.value} proportions within ${xCol.value}`);

  // Populate HTML legend
  legendItems.value = yLevels.map((yv) => ({
    label: yv,
    color: colorScale(yv),
  }));
}
</script>

<style scoped>
.pp-container {
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
  gap: 12px;
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
}

.pp-message {
  font-size: 13px;
  color: #4b5563;
}

.pp-tooltip {
  position: fixed;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 10px 12px;
  pointer-events: none;
  z-index: 20;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  font-size: 13px;
  max-width: 260px;
}

.pp-tooltip-header {
  font-weight: 700;
  font-size: 13px;
  color: #1a202c;
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid #e2e8f0;
}

.pp-tooltip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}

.pp-tooltip-label {
  flex: 1;
  color: #4b5563;
}

.pp-tooltip-value {
  font-weight: 600;
  color: #1a202c;
}

.plot-and-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.plot-container {
  flex: 1;
  position: relative;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-top: none;
  border-radius: 0 0 2px 2px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #374151;
}

.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}

.plot-svg {
  width: 100%;
  height: 100%;
  display: block;
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
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
