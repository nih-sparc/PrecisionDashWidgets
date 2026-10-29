// Filtering, sorting and summaries for the linked peaks table.
// Links look like dataManager.getLinksForGene() rows.

export const LINK_TYPES = [
  { value: "promoter", label: "Promoter" },
  { value: "intronic", label: "Intronic" },
  { value: "distal", label: "Distal" },
];

// Correlation bars and link arcs share one fixed |r| scale, so a weak link looks weak for
// every gene (scaling to each gene's strongest link made r = 0.08 look as strong as 0.3)
export const CORRELATION_SCALE_MAX = 0.5;

// Link colors by sign, used by the table and the chromatin view's arcs
export const POSITIVE_COLOR = "#f59e0b";
export const NEGATIVE_COLOR = "#3b82f6";

/** Filters shared by the table and the chromatin view's arcs: everything shown. */
export function defaultLinkFilters() {
  return { minAbsCorrelation: 0, direction: "all", types: LINK_TYPES.map((t) => t.value) };
}

export const PEAK_DEFINITION = "A region of open (accessible) DNA detected in the ATAC data.";

export const MOST_OPEN_TOOLTIP =
  "Cell type with the highest accessibility at this peak. The correlation itself is computed across all cells.";

/** 0..1 position of |r| on the shared scale. */
export function correlationStrength(r) {
  if (r == null) return 0;
  return Math.min(1, Math.abs(r) / CORRELATION_SCALE_MAX);
}

export const SORT_OPTIONS = [
  { value: "strength", label: "Strongest correlation (|r|)" },
  { value: "correlation", label: "Correlation (high to low)" },
  { value: "pValue", label: "p-value (low to high)" },
  { value: "distance", label: "Distance to gene (nearest)" },
  { value: "position", label: "Genomic position" },
];

const SORTERS = {
  strength: (a, b) => Math.abs(b.correlation ?? 0) - Math.abs(a.correlation ?? 0),
  correlation: (a, b) => (b.correlation ?? -Infinity) - (a.correlation ?? -Infinity),
  pValue: (a, b) => (a.pValue ?? Infinity) - (b.pValue ?? Infinity),
  distance: (a, b) => Math.abs(a.distance ?? Infinity) - Math.abs(b.distance ?? Infinity),
  position: (a, b) => a.start - b.start,
};

/** True when the file has promoter/intronic/distal labels (older outputs don't). */
export function hasLinkTypes(links) {
  const known = new Set(LINK_TYPES.map((t) => t.value));
  return links.some((l) => known.has(l.linkType));
}

/**
 * @param {object} filters { minAbsCorrelation, direction: "all"|"positive"|"negative", types: Set|null }
 *   types = null skips the link type filter (e.g. when the data has no types).
 */
export function filterLinks(links, { minAbsCorrelation = 0, direction = "all", types = null }) {
  return links.filter((l) => {
    const r = l.correlation ?? 0;
    if (Math.abs(r) < minAbsCorrelation) return false;
    if (direction === "positive" && r <= 0) return false;
    if (direction === "negative" && r >= 0) return false;
    if (types && !types.has(l.linkType)) return false;
    return true;
  });
}

/** The table's filters as filterLinks() options; type filtering only when the data has types. */
export function linkFilterOptions(filters, links) {
  const f = { ...defaultLinkFilters(), ...filters };
  return {
    minAbsCorrelation: f.minAbsCorrelation,
    direction: f.direction,
    types: hasLinkTypes(links) ? new Set(f.types) : null,
  };
}

/** Same chromosome, start and end (chromosomes compare with or without "chr"). */
export function samePeak(a, b) {
  if (!a || !b) return false;
  const bare = (c) => String(c).replace(/^chr/i, "");
  return bare(a.chrom) === bare(b.chrom) && a.start === b.start && a.end === b.end;
}

export function sortLinks(links, sortBy) {
  const sorter = SORTERS[sortBy] || SORTERS.strength;
  // Ties fall back to genomic position so the order is stable
  return [...links].sort((a, b) => sorter(a, b) || a.start - b.start);
}

export function summarizeLinks(links) {
  let positive = 0;
  let negative = 0;
  let farthest = null;
  for (const l of links) {
    if ((l.correlation ?? 0) > 0) positive++;
    else if ((l.correlation ?? 0) < 0) negative++;
    if (l.distance != null && (!farthest || Math.abs(l.distance) > Math.abs(farthest.distance))) {
      farthest = l;
    }
  }
  return { total: links.length, positive, negative, farthest };
}

/**
 * Which columns the processor calculated, from manifest.json `provenance.linked_peaks`.
 * Returns { known, linksComputed, columns: { name: { computed, rule } }, info }.
 * known = false when the dataset was processed before provenance was recorded.
 */
export function linkProvenance(provenance) {
  const info = provenance?.linked_peaks;
  if (!info) return { known: false, linksComputed: null, columns: {}, info: null };
  const columns = {};
  for (const [name, col] of Object.entries(info.columns || {})) {
    columns[name] = { computed: col?.source === "computed", rule: col?.rule || null };
  }
  return { known: true, linksComputed: info.source === "computed", columns, info };
}

/** One-line description of how links were made, for the table footnote. */
export function describeLinkMethod(info) {
  if (!info) return "";
  if (info.source !== "computed") return "Links come from the submitted data.";
  const p = info.parameters || {};
  const parts = [
    `Links were calculated by the data processor with ${info.method || "Signac LinkPeaks"}`,
  ];
  const details = [];
  if (p.method) details.push(`${p.method} correlation of peak accessibility with gene expression`);
  if (p.distance_bp) details.push(`peaks within ${formatBp(p.distance_bp)} of the gene start`);
  if (p.pvalue_cutoff != null) details.push(`p < ${p.pvalue_cutoff}`);
  if (p.score_cutoff != null) details.push(`|r| > ${p.score_cutoff}`);
  if (details.length) parts[0] += ` (${details.join(", ")})`;
  if (info.gene_selection) {
    const tested = info.genes_tested != null ? `${info.genes_tested.toLocaleString()} genes` : "selected genes";
    parts.push(`Only ${tested} were tested: ${info.gene_selection}`);
  }
  if (info.complete === false) parts.push("The run stopped early, so some selected genes were not tested");
  return `${parts.join(". ")}. These are statistical associations, not proof of regulation.`;
}

/**
 * Parse a genomic position typed by a user: "chr3:38,816,400", "3:38816400",
 * "chr3 38816400" or a range "chr3:38,816,400-38,816,500". Returns { chrom, start, end }
 * with chrom as "chrN", or null.
 */
export function parsePosition(text) {
  const m = String(text)
    .trim()
    .replace(/,/g, "")
    .match(/^(?:chr)?([0-9]{1,2}|x|y|m|mt)\s*[:\s]\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
  if (!m) return null;
  const start = Number(m[2]);
  const end = m[3] ? Number(m[3]) : start;
  if (end < start) return null;
  const chrom = m[1].toUpperCase() === "MT" ? "M" : m[1].toUpperCase();
  return { chrom: `chr${chrom}`, start, end };
}

/**
 * CSV of links with every column of linked_peaks.parquet (in file order), plus `extra`
 * columns computed in the dashboard: [{ name, value: (link) => value }].
 */
export function linksToCsv(links, extra = []) {
  const columns = [];
  for (const link of links) {
    for (const name of Object.keys(link.row || {})) if (!columns.includes(name)) columns.push(name);
  }
  const header = [...columns, ...extra.map((e) => e.name)];
  const lines = links.map((link) => [
    ...columns.map((name) => link.row?.[name]),
    ...extra.map((e) => e.value(link)),
  ]);
  return [header, ...lines].map((cells) => cells.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value) {
  if (value == null) return "";
  const text = typeof value === "bigint" ? value.toString() : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** "12.3 kb upstream", "850 bp downstream", "at gene start". Negative = upstream. */
export function formatDistance(bp) {
  if (bp == null) return "—";
  if (bp === 0) return "at gene start";
  return `${formatBp(Math.abs(bp))} ${bp < 0 ? "upstream" : "downstream"}`;
}

export function formatBp(bp) {
  if (bp >= 1e6) return `${(bp / 1e6).toFixed(2)} Mb`;
  if (bp >= 1000) return `${(bp / 1000).toFixed(1)} kb`;
  return `${Math.round(bp)} bp`;
}

export function formatPValue(p) {
  if (p == null) return "—";
  if (p === 0) return "< 1e-300";
  return p < 0.001 ? p.toExponential(1) : p.toFixed(3);
}
