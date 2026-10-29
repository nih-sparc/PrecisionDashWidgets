// Chromatin track signal: the units the chromatin view can show, and which cell type is
// most open at a peak. Tracks hold mean peak counts per cell for each cell type (no depth
// normalization); depth comes from dataManager.getChromatinDepth().

export const SIGNAL_MODES = [
  {
    key: "rpm",
    label: "Reads per million",
    unit: "reads per million in peaks",
    title:
      "Per million reads in peaks: each cell type's mean counts per cell divided by its mean " +
      "reads in peaks per cell, × 10⁶, so deeply sequenced cell types don't look more open. " +
      "Calculated in the dashboard.",
  },
  {
    key: "mean",
    label: "Mean per cell",
    unit: "mean counts per cell",
    title: "Mean peak counts per cell in each cell type. Not adjusted for sequencing depth.",
  },
  {
    key: "total",
    label: "Total",
    unit: "total counts",
    title:
      "Each cell type's total counts (mean per cell × number of cells). Larger cell types " +
      "have higher totals.",
  },
];

/** Mean counts per cell → reads per million reads in peaks, or null without depth. */
export function readsPerMillion(meanSignal, depthGroup) {
  if (!depthGroup?.cells || !depthGroup.reads) return null;
  return (meanSignal / (depthGroup.reads / depthGroup.cells)) * 1e6;
}

/**
 * Depth-normalized "most open in" for each peak.
 * @param signals [{ group, start, end, signal }] from dataManager.getPeakSignals()
 * @param depth   dataManager.getChromatinDepth()
 * @returns Map("start-end" → { group, rpm, meanSignal })
 */
export function mostOpenByPeak(signals, depth) {
  const best = new Map();
  for (const s of signals) {
    const rpm = readsPerMillion(s.signal, depth?.groups.get(s.group));
    if (rpm == null) continue;
    const key = peakKey(s);
    if (!best.has(key) || rpm > best.get(key).rpm) {
      best.set(key, { group: s.group, rpm, meanSignal: s.signal });
    }
  }
  return best;
}

export function peakKey(peak) {
  return `${peak.start}-${peak.end}`;
}

export function formatSignal(value) {
  if (value >= 100) return Math.round(value).toLocaleString();
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(2);
}
