<template>
  <div class="umap-comparison-dashboard">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p class="loading-text">Loading UMAP data...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <strong>⚠️ Error:</strong> {{ error }}
    </div>

    <!-- Main Dashboard -->
    <div v-else class="dashboard">
      <!-- Left Panel: Metadata UMAP -->
      <div class="panel">
        <div class="header">
          <h3 class="title">Cell Metadata</h3>
          <div class="filter-placeholder">
            <!-- Filter will go here -->
          </div>
        </div>

        <div class="controls">
          <label class="label">
            Select metadata:
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
        </div>

        <div class="canvas-container">
          <canvas ref="leftCanvas"></canvas>
        </div>

        <div v-if="metadataLegend.length > 0" class="legend">
          <div class="legend-title">Legend</div>
          <div class="legend-items">
            <div
              v-for="(item, idx) in metadataLegend"
              :key="idx"
              class="legend-item"
            >
              <div
                class="legend-color"
                :style="{ background: item.color }"
              ></div>
              <span class="legend-label">{{ item.label }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Gene Expression UMAP -->
      <div class="panel">
        <div class="header">
          <h3 class="title">Assay RNA (Gene Expression)</h3>
          <div class="filter-placeholder">
            <!-- Filter will go here -->
          </div>
        </div>

        <div class="controls">
          <label class="label">
            Select gene:
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
                :disabled="!geneSearch.trim() || geneLoading"
                class="visualize-btn"
              >
                {{ geneLoading ? "Loading..." : "Visualize" }}
              </button>
            </div>
          </label>
        </div>

        <div class="canvas-container">
          <div v-if="geneLoading" class="loading-overlay">
            <div class="small-spinner"></div>
            <p>Loading gene expression...</p>
          </div>
          <canvas ref="rightCanvas"></canvas>
        </div>

        <div v-if="selectedGene && !geneLoading" class="legend">
          <div class="legend-title">Expression Level</div>
          <div class="gradient-bar">
            <div class="gradient-fill"></div>
            <div class="gradient-labels">
              <span>Low</span>
              <span>High</span>
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
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
} from "vue";
import * as d3 from "d3";
import createRegl from "regl";
import { UMAPGeneViewer } from "../GeneExpressionViewer/dataManager";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
});

// Refs
const leftCanvas = ref(null);
const rightCanvas = ref(null);
const manager = ref(null);
const leftRegl = ref(null);
const rightRegl = ref(null);
const sharedZoom = ref(d3.zoomIdentity); // Unified zoom state
const leftResizeObserver = ref(null);
const rightResizeObserver = ref(null);
const leftPointsData = ref([]);
const rightPointsData = ref([]);
const hoveredCellId = ref(null); // Shared hover state by cell_id
const tooltipPos = ref({ x: 0, y: 0 });

// State
const loading = ref(true);
const error = ref(null);
const umapData = ref([]);

// Left panel (metadata)
const metadataColumns = ref([]);
const selectedMetadataColumn = ref("");
const metadataLegend = ref([]);

// Right panel (gene expression)
const geneSearch = ref("");
const selectedGene = ref("");
const geneSuggestions = ref([]);
const geneLoading = ref(false);

// Search timeout
let searchTimeout = null;

// Helper function
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

// Left panel render variables (shared across functions)
let leftRenderScheduled = false;
let leftDrawPoints = null;
let leftXScale = null;
let leftYScale = null;
let leftReglInstance = null;

// Right panel render variables (shared across functions)
let rightRenderScheduled = false;
let rightDrawPoints = null;
let rightXScale = null;
let rightYScale = null;
let rightReglInstance = null;

// Initialize
onMounted(async () => {
  try {
    console.log("Initializing data manager...");
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
        selectedMetadataColumn.value = cols[0];
      }
    }

    loading.value = false;

    await nextTick();
    setupResizeObservers();

    if (selectedMetadataColumn.value) {
      renderMetadataUMAP();
    }
  } catch (err) {
    console.error("Failed to initialize:", err);
    error.value = `Failed to load data: ${err.message}`;
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (leftResizeObserver.value) leftResizeObserver.value.disconnect();
  if (rightResizeObserver.value) rightResizeObserver.value.disconnect();
  if (leftRegl.value) leftRegl.value.destroy();
  if (rightRegl.value) rightRegl.value.destroy();
});

// Setup resize observers
function setupResizeObservers() {
  if (leftCanvas.value) {
    leftResizeObserver.value = new ResizeObserver(() => {
      if (selectedMetadataColumn.value) renderMetadataUMAP();
    });
    leftResizeObserver.value.observe(leftCanvas.value.parentElement);
  }

  if (rightCanvas.value) {
    rightResizeObserver.value = new ResizeObserver(() => {
      if (selectedGene.value) renderGeneUMAP();
    });
    rightResizeObserver.value.observe(rightCanvas.value.parentElement);
  }
}

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
  selectedGene.value = geneSearch.value;
  await renderGeneUMAP();
}

// Render metadata UMAP
async function renderMetadataUMAP() {
  await nextTick();
  const canvas = leftCanvas.value;
  if (!canvas || !umapData.value.length) return;

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

  // Prepare points
  const points = umapData.value.map((d) => ({
    ...d,
    x: d.umap_1,
    y: d.umap_2,
    color: colorScale(d[selectedMetadataColumn.value]) || "#cccccc",
    opacity: 0.8,
  }));

  // Store points for hover detection
  leftPointsData.value = points;

  try {
    if (leftRegl.value) {
      leftRegl.value.destroy();
    }
    leftRegl.value = createRegl(canvas);
  } catch (err) {
    console.error("WebGL not supported:", err);
    return;
  }

  const regl = leftRegl.value;
  leftReglInstance = regl;

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
  // Store scales for highlight function
  leftXScale = xScale;
  leftYScale = yScale;

  const positions = [];
  const colors = [];
  points.forEach((p) => {
    positions.push(xScale(p.x), yScale(p.y));
    const rgb = d3.color(p.color).rgb();
    colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
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
  // Store for external access
  leftDrawPoints = drawPoints;

  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 10])
    .filter((event) => event.type !== "wheel")
    .on("zoom", (event) => {
      if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
        sharedZoom.value = event.transform;
        render();
        // Also trigger right panel render if it exists
        if (rightRegl.value && selectedGene.value) {
          renderRightPanel();
        }
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
      render();
      d3.select(canvas).property("__zoom", newTransform);

      // Also update right panel
      if (rightCanvas.value && rightRegl.value && selectedGene.value) {
        d3.select(rightCanvas.value).property("__zoom", newTransform);
        renderRightPanel();
      }
    },
    { passive: false }
  );

  canvas.addEventListener("mousemove", (event) => {
    const r = canvas.getBoundingClientRect();
    const mx = event.clientX - r.left;
    const my = event.clientY - r.top;
    const tr = sharedZoom.value || d3.zoomIdentity;

    const ndcX = (mx / canvas.width) * 2 - 1;
    const ndcY = -((my / canvas.height) * 2 - 1);

    const hoverRadius = 0.02;
    let closestPoint = null;
    let closestDist = hoverRadius;
    let closestIndex = -1;

    leftPointsData.value.forEach((p, i) => {
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
      hoveredCellId.value = closestPoint.cell_id;
      tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 };
      drawHighlightedPoint(closestIndex, tr);

      // Trigger right panel re-render with highlight
      if (
        rightRegl.value &&
        selectedGene.value &&
        rightPointsData.value.length > 0
      ) {
        renderRightPanel();
      }
    } else {
      hoveredCellId.value = null;
      render();
      if (rightRegl.value && selectedGene.value) {
        renderRightPanel();
      }
    }
  });

  canvas.addEventListener("mouseleave", () => {
    hoveredCellId.value = null;
    render();
    if (rightRegl.value && selectedGene.value) {
      renderRightPanel();
    }
  });

  let renderScheduled = false;

  function render() {
    if (renderScheduled) return;
    renderScheduled = true;

    requestAnimationFrame(() => {
      regl.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 }); // Matches .canvas-container background
      let scale = 1,
        translate = [0, 0],
        pointSize = 3;

      if (sharedZoom.value) {
        const { k, x, y } = sharedZoom.value;
        scale = k;
        translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
        pointSize = Math.max(2, 3 * k);
      }

      drawPoints({ scale, translate, pointSize });
      renderScheduled = false;
    });
  }
  function drawHighlightedPoint(idx, tr) {
    if (renderScheduled) return;
    renderScheduled = true;

    requestAnimationFrame(() => {
      // Clear and draw base layer
      regl.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 });
      let scale = tr.k;
      let translate = [(2 * tr.x) / canvas.width, -(2 * tr.y) / canvas.height];
      let pointSize = Math.max(2, 3 * tr.k);
      drawPoints({ scale, translate, pointSize });

      // Draw highlight on top
      const p = leftPointsData.value[idx];
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
          vec2 pos = position * scale + translate;
          gl_Position = vec4(pos, 0, 1);
          gl_PointSize = pointSize;
          vColor = color;
        }
      `,
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
      renderScheduled = false;
    });
  }

  render();
}

function renderRightPanel() {
  if (!rightCanvas.value || !rightReglInstance || rightRenderScheduled) return;
  rightRenderScheduled = true;

  requestAnimationFrame(() => {
    const canvas = rightCanvas.value;
    rightReglInstance.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 });

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
        drawRightHighlightedPoint(idx, sharedZoom.value);
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

function renderLeftPanel() {
  if (!leftCanvas.value || !leftReglInstance || leftRenderScheduled) return;
  leftRenderScheduled = true;

  requestAnimationFrame(() => {
    const canvas = leftCanvas.value;
    leftReglInstance.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 });

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

    // Draw highlight if there's a hovered cell
    if (hoveredCellId.value) {
      const idx = leftPointsData.value.findIndex(
        (p) => p.cell_id === hoveredCellId.value
      );
      if (idx !== -1) {
        drawLeftHighlightedPoint(idx, sharedZoom.value);
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
// Render gene expression UMAP
async function renderGeneUMAP() {
  if (!selectedGene.value) return;

  await nextTick();
  const canvas = rightCanvas.value;
  if (!canvas || !umapData.value.length) return;

  const container = canvas.parentElement;
  const rect = container.getBoundingClientRect();
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);

  canvas.width = width;
  canvas.height = height;

  try {
    geneLoading.value = true;
    const geneData = await manager.value.getGeneExpression(selectedGene.value);
    geneLoading.value = false;

    const exprMap = new Map(geneData.map((d) => [d.cell_id, d.expression]));
    const allExpr = geneData.map((d) => d.expression);
    const maxExpr = Math.max(...allExpr);

    const points = umapData.value.map((d) => {
      const expr = exprMap.get(d.cell_id) || 0;
      const norm = maxExpr > 0 ? Math.min(expr / maxExpr, 1) : 0;

      // Color scale: gray -> blue gradient
      const r = Math.round(200 * (1 - norm) + 0 * norm);
      const g = Math.round(200 * (1 - norm) + 0 * norm);
      const b = Math.round(200 * (1 - norm) + 255 * norm);

      return {
        ...d,
        x: d.umap_1,
        y: d.umap_2,
        expr,
        norm,
        color: `rgb(${r}, ${g}, ${b})`,
        opacity: 0.8,
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

    // Store scales for highlight function
    rightXScale = xScale;
    rightYScale = yScale;

    const positions = [];
    const colors = [];
    points.forEach((p) => {
      positions.push(xScale(p.x), yScale(p.y));
      const rgb = d3.color(p.color).rgb();
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
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

    // Store for external access
    rightDrawPoints = drawPoints;

    const zoom = d3
      .zoom()
      .scaleExtent([0.5, 10])
      .filter((event) => event.type !== "wheel")
      .on("zoom", (event) => {
        if (event.sourceEvent && event.sourceEvent.type !== "wheel") {
          sharedZoom.value = event.transform;
          render();
          // Also trigger left panel render
          if (leftRegl.value && selectedMetadataColumn.value) {
            d3.select(leftCanvas.value).property("__zoom", event.transform);
            renderLeftPanel();
          }
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
        render();
        d3.select(canvas).property("__zoom", newTransform);

        // Also update left panel
        if (
          leftCanvas.value &&
          leftRegl.value &&
          selectedMetadataColumn.value
        ) {
          d3.select(leftCanvas.value).property("__zoom", newTransform);
          renderLeftPanel();
        }
      },
      { passive: false }
    );

    canvas.addEventListener("mousemove", (event) => {
      const r = canvas.getBoundingClientRect();
      const mx = event.clientX - r.left;
      const my = event.clientY - r.top;
      const tr = sharedZoom.value || d3.zoomIdentity;

      const ndcX = (mx / canvas.width) * 2 - 1;
      const ndcY = -((my / canvas.height) * 2 - 1);

      const hoverRadius = 0.02;
      let closestPoint = null;
      let closestDist = hoverRadius;
      let closestIndex = -1;

      rightPointsData.value.forEach((p, i) => {
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
        hoveredCellId.value = closestPoint.cell_id;
        tooltipPos.value = { x: event.clientX + 15, y: event.clientY - 10 };
        drawHighlightedPoint(closestIndex, tr);

        // Trigger left panel re-render with highlight
        if (
          leftRegl.value &&
          selectedMetadataColumn.value &&
          leftPointsData.value.length > 0
        ) {
          renderLeftPanel();
        }
      } else {
        hoveredCellId.value = null;
        render();
        if (leftRegl.value && selectedMetadataColumn.value) {
          renderLeftPanel();
        }
      }
    });

    canvas.addEventListener("mouseleave", () => {
      hoveredCellId.value = null;
      render();
      if (leftRegl.value && selectedMetadataColumn.value) {
        renderLeftPanel();
      }
    });

    let renderScheduled = false;

    function render() {
      if (renderScheduled) return;
      renderScheduled = true;

      requestAnimationFrame(() => {
        regl.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 });
        let scale = 1,
          translate = [0, 0],
          pointSize = 3;

        if (sharedZoom.value) {
          const { k, x, y } = sharedZoom.value;
          scale = k;
          translate = [(2 * x) / canvas.width, -(2 * y) / canvas.height];
          pointSize = Math.max(2, 3 * k);
        }

        drawPoints({ scale, translate, pointSize });
        renderScheduled = false;
      });
    }

    function drawHighlightedPoint(idx, tr) {
      if (renderScheduled) return;
      renderScheduled = true;

      requestAnimationFrame(() => {
        // Clear and draw base layer
        regl.clear({ color: [0.97, 0.98, 0.99, 1], depth: 1 });
        let scale = tr.k;
        let translate = [
          (2 * tr.x) / canvas.width,
          -(2 * tr.y) / canvas.height,
        ];
        let pointSize = Math.max(2, 3 * tr.k);
        drawPoints({ scale, translate, pointSize });

        // Draw highlight on top
        const p = rightPointsData.value[idx];
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
          vec2 pos = position * scale + translate;
          gl_Position = vec4(pos, 0, 1);
          gl_PointSize = pointSize;
          vColor = color;
        }
      `,
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
        renderScheduled = false;
      });
    }

    render();
  } catch (err) {
    console.error("Failed to render gene UMAP:", err);
    geneLoading.value = false;
  }
}
</script>

<style scoped>
.umap-comparison-dashboard {
  height: 100vh;
  overflow: hidden;
}

.dashboard {
  display: flex;
  gap: 24px;
  padding: 24px;
  height: 100%;
  width: 100%;
  background: #f8fafc;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 24px;
  min-height: 0;
  width: 50%;
  height: 100%;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.filter-placeholder {
  height: 40px;
  background: linear-gradient(
    135deg,
    rgba(102, 126, 234, 0.05) 0%,
    rgba(118, 75, 162, 0.05) 100%
  );
  border: 1px dashed #cbd5e1;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 13px;
  font-style: italic;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.gene-input-wrapper {
  display: flex;
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

.canvas-container {
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

.canvas-container canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  cursor: pointer;
}

.canvas-container canvas:active {
  cursor: grabbing;
}

.legend {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 16px;
}

.legend-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a202c;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
}

.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.legend-label {
  font-weight: 500;
}

.gradient-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.gradient-fill {
  height: 20px;
  background: linear-gradient(to right, #c8c8c8 0%, #0000ff 100%);
  border-radius: 2px;
  border: 1px solid #e2e8f0;
}

.gradient-labels {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #64748b;
  font-weight: 500;
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
  height: 100vh;
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
