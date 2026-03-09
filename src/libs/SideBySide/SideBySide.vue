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
      <div class="filter-placeholder">
        <!-- Filter will go here -->
      </div>
      <div class="both-pannels">
        <!-- Left Panel: Metadata UMAP -->
        <div class="panel">
          <div class="header">
            <h3 class="title">Cell Metadata</h3>
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

          <div
            v-if="metadataLegend.length > 0"
            class="legend"
            :class="{ 'legend-expanded': leftLegendExpanded }"
          >
            <div class="legend-header">
              <div class="legend-title">Legend</div>
              <button
                class="legend-toggle"
                @click.stop="toggleLeftLegend"
                :title="leftLegendExpanded ? 'Collapse' : 'Expand'"
              >
                <span v-if="leftLegendExpanded">▼</span>
                <span v-else>▲</span>
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
                  v-if="selectedMetadataColumn.toLowerCase() === 'atlas_annotation'"
                  class="legend-label legend-link"
                  :href="`https://nervosensus.netlify.app/?view=cards&atlasannotation=${item.label}`"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ item.label }}</a>
                <span v-else class="legend-label">{{ item.label }}</span>
              </div>
            </div>
          </div>

          <!-- Tooltip for Left Panel -->
          <div
            v-if="hoveredPoint"
            class="tooltip"
            :style="{
              left: leftTooltipPos.x + 'px',
              top: leftTooltipPos.y + 'px',
            }"
          >
            <div class="tooltip-header">{{ hoveredPoint.cell_id }}</div>
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

        <!-- Right Panel: Gene Expression UMAP -->
        <div class="panel">
          <div class="header">
            <h3 class="title">Assay RNA (Gene Expression)</h3>
          </div>

          <div class="controls">
            <label class="label">
              Select gene:
              <div class="gene-input-wrapper">
                <input
                  v-model="geneSearch"
                  type="text"
                  placeholder="Gene name (e.g., CDH9)"
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
import { UMAPGeneViewer } from "../dataManager";

// Props
const props = defineProps({
  dataPath: { type: String, default: "/data" },
  metadataColumn: { type: String, default: null },
  gene: { type: String, default: null },
});
//EMITS
const emit = defineEmits(["update:Vars"]);
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
const hoveredFromLeft = ref(true); // Track which panel triggered the hover
const leftTooltipPos = ref({ x: 0, y: 0 });
const leftLegendExpanded = ref(false);
const isLegendAnimating = ref(false);

// State
const loading = ref(true);
const error = ref(null);
const umapData = ref([]);

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

//WATCHES FOR REFS
watch(
  () => props.metadataColumn,
  (newVal) => {
    if (newVal && newVal !== selectedMetadataColumn.value) {
      selectedMetadataColumn.value = newVal;
      if (umapData.value.length > 0) {
        renderMetadataUMAP();
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
        renderGeneUMAP();
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

// Initialize
onMounted(async () => {
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
});

onBeforeUnmount(() => {
  if (leftResizeObserver.value) leftResizeObserver.value.disconnect();
  if (rightResizeObserver.value) rightResizeObserver.value.disconnect();

  // Clean up both panels
  cleanupLeftPanel();
  cleanupRightPanel();
});
// Setup resize observers
function setupResizeObservers() {
  if (leftCanvas.value) {
    leftResizeObserver.value = new ResizeObserver(() => {
      // Ignore resize events during legend animation
      if (!isLegendAnimating.value && selectedMetadataColumn.value) {
        renderMetadataUMAP();
      }
    });
    // Observe the panel instead of the canvas container
    leftResizeObserver.value.observe(leftCanvas.value.closest(".panel"));
  }

  if (rightCanvas.value) {
    rightResizeObserver.value = new ResizeObserver(() => {
      if (selectedGene.value) renderGeneUMAP();
    });
    // Observe the panel instead of the canvas container
    rightResizeObserver.value.observe(rightCanvas.value.closest(".panel"));
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
      colors.push(rgb.r / 255, rgb.g / 255, rgb.b / 255, 0.8);
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
// Draw labels on the left canvas using WebGL
function drawLeftLabels(canvas, transform) {
  if (
    !canvas ||
    !leftReglInstance ||
    !leftXScale ||
    !leftYScale ||
    leftLabels.length === 0
  )
    return;

  const tr = transform || d3.zoomIdentity;

  // Clean up old textures first
  leftLabelTextures.forEach((texture) => {
    try {
      texture.destroy();
    } catch (e) {}
  });
  leftLabelTextures = [];

  leftLabels.forEach((label) => {
    if (!subsetCategories.value.has(label.text)) {
      return;
    }
    const px = leftXScale(label.x);
    const py = leftYScale(label.y);

    // Transform to screen coordinates for visibility check
    const tX = (2 * tr.x) / canvas.width;
    const tY = -(2 * tr.y) / canvas.height;
    const screenX = ((px * tr.k + tX + 1) / 2) * canvas.width;
    const screenY = ((1 - (py * tr.k + tY)) / 2) * canvas.height;

    // Skip labels that are off-screen
    if (
      screenX < -100 ||
      screenX > canvas.width + 100 ||
      screenY < -100 ||
      screenY > canvas.height + 100
    ) {
      return;
    }

    // Calculate font size based on zoom, with limits
    const baseFontSize = 12;
    const minFontSize = 11;
    const maxFontSize = 18;
    // Direct scaling with zoom (no sqrt dampening)
    const fontSize = Math.round(
      Math.max(minFontSize, Math.min(maxFontSize, baseFontSize * tr.k))
    );
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

    tempCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const metrics = tempCtx.measureText(label.text);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    const padding = 4;

    // Size the temp canvas
    tempCanvas.width = textWidth + padding * 2;
    tempCanvas.height = textHeight + padding * 2;

    // Redraw (canvas was cleared by resize)
    tempCtx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    tempCtx.textAlign = "center";
    tempCtx.textBaseline = "middle";

    // Draw background
    tempCtx.fillStyle = "rgba(255, 255, 255, 0.85)";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw border
    tempCtx.strokeStyle = label.color;
    tempCtx.lineWidth = 2;
    tempCtx.strokeRect(0, 0, tempCanvas.width, tempCanvas.height);

    // Draw text
    tempCtx.fillStyle = label.color;
    tempCtx.fillText(label.text, tempCanvas.width / 2, tempCanvas.height / 2);

    // Create texture from canvas
    const texture = leftReglInstance.texture({
      data: tempCanvas,
      mag: "linear",
      min: "linear",
    });

    leftLabelTextures.push(texture); // Track for cleanup

    // Calculate quad size in NDC space - no additional scaling needed
    const quadWidth = (tempCanvas.width / canvas.width) * 2;
    const quadHeight = (tempCanvas.height / canvas.height) * 2;

    // Draw textured quad at 1:1 pixel ratio (no texture scaling)
    const drawQuad = leftReglInstance({
      frag: `
        precision mediump float;
        varying vec2 vUv;
        uniform sampler2D texture;
        void main() {
          gl_FragColor = texture2D(texture, vUv);
        }`,
      vert: `
        precision mediump float;
        attribute vec2 position;
        attribute vec2 uv;
        varying vec2 vUv;
        uniform vec2 offset;
        uniform vec2 size;
        uniform vec2 translate;
        void main() {
          vec2 pos = offset + position * size + translate;
          gl_Position = vec4(pos, 0, 1);
          vUv = uv;
        }`,
      attributes: {
        position: [
          [-0.5, -0.5],
          [0.5, -0.5],
          [-0.5, 0.5],
          [0.5, 0.5],
        ],
        uv: [
          [0, 1],
          [1, 1],
          [0, 0],
          [1, 0],
        ],
      },
      uniforms: {
        texture: texture,
        offset: [
          px * tr.k + (2 * tr.x) / canvas.width,
          py * tr.k - (2 * tr.y) / canvas.height,
        ],
        size: [quadWidth, quadHeight],
        translate: [0, 0],
      },
      primitive: "triangle strip",
      count: 4,
      depth: { enable: false },
      blend: {
        enable: true,
        func: {
          srcRGB: "src alpha",
          srcAlpha: 1,
          dstRGB: "one minus src alpha",
          dstAlpha: 1,
        },
      },
    });

    drawQuad();
  });
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
  const points = umapData.value.map((d) => ({
    ...d,
    x: d.umap_1,
    y: d.umap_2,
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
  let lastMouseMoveTime = 0;
  const MOUSE_MOVE_THROTTLE = 16; // ~60fps

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
    // Throttle mouse move events
    const now = Date.now();
    if (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE) return;
    lastMouseMoveTime = now;

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
      hoveredFromLeft.value = true;

      // Calculate tooltip position based on point location on canvas
      const px = xScale(closestPoint.x);
      const py = yScale(closestPoint.y);
      const tX = (2 * tr.x) / canvas.width;
      const tY = -(2 * tr.y) / canvas.height;
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

    // Single coordinated render
    renderLeftPanel();
    if (rightRegl.value && selectedGene.value) {
      renderRightPanel();
    }
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
        originalColor: `rgb(${r}, ${g}, ${b})`, // Store original color
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
    let lastMouseMoveTime = 0;
    const MOUSE_MOVE_THROTTLE = 16; // ~60fps

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
      // Throttle mouse move events
      const now = Date.now();
      if (now - lastMouseMoveTime < MOUSE_MOVE_THROTTLE) return;
      lastMouseMoveTime = now;

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
        hoveredFromLeft.value = false;

        // Calculate tooltip position based on point location on canvas
        const px = xScale(closestPoint.x);
        const py = yScale(closestPoint.y);
        const tX = (2 * tr.x) / canvas.width;
        const tY = -(2 * tr.y) / canvas.height;
        const screenX = ((px * tr.k + tX + 1) / 2) * canvas.width;
        const screenY = ((1 - (py * tr.k + tY)) / 2) * canvas.height;

        const canvasRect = canvas.getBoundingClientRect();
        // You can set right tooltip position here if needed
      } else {
        hoveredCellId.value = null;
      }

      // Single coordinated render
      renderRightPanel();
      if (leftRegl.value && selectedMetadataColumn.value) {
        renderLeftPanel();
      }
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
function getTooltipData(point) {
  const data = {};

  // Exclude these keys from display
  const exclude = new Set([
    "cell_id",
    "umap_1",
    "umap_2",
    "tsne_1",
    "tsne_2",
    "x",
    "y",
    "color",
    "opacity",
    "expr",
    "norm"
  ]);

  // Add all non-excluded keys
  Object.keys(point).forEach((k) => {
    if (!exclude.has(k) && point[k] !== null && point[k] !== undefined) {
      data[k] = point[k];
    }
  });

  return data;
}
function getTooltipLabelStyle(key) {
  return {};
}
function formatLabel(key) {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
const gene1Color = ref("#ff0000");
const gene2Color = ref("#0000ff");
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
.both-pannels {
  display: flex;
  flex-direction: row;
  gap: 24px;
  height: 100%;
  width: 100%;
  background: #f8fafc;
}
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 2px;
  padding: 24px;
  min-height: 0;
  width: 50%;
  height: auto;
  position: relative;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
  height: 20px;
  flex-shrink: 0;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #1a202c;
}

.filter-placeholder {
  height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 13px;
  font-style: italic;
  width: 100%;
}

.controls {
  display: flex;
  flex-direction: column;
  height: 72px;
  flex-shrink: 0;
  margin-top: 16px;
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
  min-width: 0;
  box-sizing: border-box;
}

.gene-input::placeholder {
  font-size: 13px;
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
  margin-top: 16px;
  height: 89%;
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
  height: 10%;
  min-height: 80px;
  flex-shrink: 0;
  margin-top: 16px;
  overflow-y: auto;
  transition: all 0.3s ease;
  position: relative;
  z-index: 5;
}

.legend-expanded {
  position: absolute;
  bottom: 24px;
  left: 24px;
  right: 24px;
  height: 60%;
  max-height: calc(100% - 200px);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.legend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.legend-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a202c;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.legend-toggle {
  background: transparent;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  color: #64748b;
  font-size: 12px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 24px;
}

.legend-toggle:hover {
  background: #f8fafc;
  border-color: #667eea;
  color: #667eea;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;
}
.legend-items {
  display: flex;
  flex-wrap: wrap;
}
.legend-item:hover {
  background: #f8fafc;
}

.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 2px;
  border: 2px solid;
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  cursor: pointer;
}

.legend-color-hidden {
  background: white !important;
  opacity: 0.6;
}

.legend-x {
  color: #64748b;
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
}

.legend-label {
  font-weight: 500;
}

.legend-link {
  color: inherit;
  text-decoration: none;
}

.legend-link:hover {
  text-decoration: underline;
  color: #667eea;
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

.tooltip-gene {
  border-color: #0000ff;
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
../dataManager
