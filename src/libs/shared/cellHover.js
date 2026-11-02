// The hovered cell on a cell map: a marker drawn over the cell, and a short hover card.
// Shared by Gene CoExpression and Side By Side so both look and read the same.

/** Marker diameter in pixels; fixed, so zooming doesn't change it. */
export const HOVER_MARKER_PX = 14;

/**
 * Fragment shader for the marker (one regl point of size HOVER_MARKER_PX): the cell's
 * color with a ring of the same hue, darker, like the violin plot's data points.
 * Needs `varying vec4 vColor` and `uniform float pointSize`.
 */
export const HOVER_MARKER_FRAG = `
  precision mediump float;
  varying vec4 vColor;
  uniform float pointSize;
  void main() {
    vec2 c = gl_PointCoord - vec2(0.5);
    float d = length(c);
    if (d > 0.5) discard;
    // Ring width in pixels, whatever the marker size
    if (d * pointSize > pointSize * 0.5 - 2.5) gl_FragColor = vec4(vColor.rgb * 0.55, 1.0);
    else gl_FragColor = vec4(vColor.rgb, 1.0);
  }`;

/** At most this many rows on the hover card. */
export const CARD_MAX_ROWS = 8;

// After the widget's own rows (cell type, gene expression), the card fills up with the
// first of these the dataset has. Each takes the first of its columns that's present.
const CELL_FIELDS = [
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

const present = (v) => v !== null && v !== undefined && v !== "";

function formatField(value, format) {
  if (typeof value !== "number") return String(value);
  if (format === "int") return Math.round(value).toLocaleString();
  if (format === "pct") return `${value.toFixed(1)}%`;
  return formatExpression(value);
}

/** An expression value for the card: "Not detected" for zero. */
export function formatExpression(value) {
  if (!(value > 0)) return "Not detected";
  return value < 0.01 ? value.toExponential(2) : value.toFixed(2);
}

/**
 * Rows for the hover card: the widget's `leading` rows ({ label, value, color? }), then
 * dataset fields from `cell` (its metadata columns), CARD_MAX_ROWS in all.
 */
export function cellCardRows(cell, leading = []) {
  const rows = leading.filter((r) => present(r.value));
  for (const field of CELL_FIELDS) {
    if (rows.length >= CARD_MAX_ROWS) break;
    const key = field.keys.find((k) => present(cell?.[k]));
    if (key) rows.push({ label: field.label, value: formatField(cell[key], field.format) });
  }
  return rows.slice(0, CARD_MAX_ROWS);
}

const CARD_WIDTH = 320;
const CARD_HEIGHT_ESTIMATE = 260;

/** Card position next to the cursor, flipped left / up near the window's edges. */
export function cardStyle({ x, y }) {
  const flipX = x + CARD_WIDTH > window.innerWidth - 8;
  const flipY = y + CARD_HEIGHT_ESTIMATE > window.innerHeight - 8;
  return {
    left: `${flipX ? x - CARD_WIDTH - 30 : x}px`,
    top: `${flipY ? Math.max(8, y - CARD_HEIGHT_ESTIMATE) : y}px`,
  };
}
