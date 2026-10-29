import { ref } from "vue";
import { defineStore } from "pinia";
import { defaultLinkFilters } from "../libs/LinkedPeaksTable/linkedPeaks.js";

type LinkFilters = { minAbsCorrelation: number; direction: string; types: string[] };
type Peak = { gene: string; chrom: string; start: number; end: number };

export const usePrecisionStore = defineStore("precisionGlobalVars", () => {
  // Persistent selections (not cleared on dashboard switch)
  const selectedGene = ref<string | null>(null);
  const selectedMetadataColumn = ref<string | null>(null);
  const selectedGene1 = ref<string | null>(null);
  const selectedGene2 = ref<string | null>(null);
  const selectedGeneX = ref<string | null>(null);
  const selectedChromatinGene = ref<string | null>(null);
  // Linked peak selected in the table or the chromatin view's arcs
  const chromatinFocus = ref<Peak | null>(null);
  // Peak the chromatin view is zoomed to (±5 kb), or null for the full region
  const chromatinZoom = ref<Peak | null>(null);
  // Linked Peaks table filters, which the chromatin view's arcs follow too
  const linkFilters = ref<LinkFilters>(defaultLinkFilters());

  function setSelectedGene(gene: string | null) {
    selectedGene.value = gene === "" ? null : gene;
  }

  function setSelectedMetadataColumn(column: string | null) {
    selectedMetadataColumn.value = column === "" ? null : column;
  }

  function setSelectedGene1(gene: string | null) {
    selectedGene1.value = gene === "" ? null : gene;
  }

  function setSelectedGene2(gene: string | null) {
    selectedGene2.value = gene === "" ? null : gene;
  }
  function setSelectedGeneX(gene: string | null) {
    selectedGeneX.value = gene === "" ? null : gene;
  }
  function setSelectedChromatinGene(gene: string | null) {
    const next = gene === "" ? null : gene;
    // A focused peak belongs to one gene; drop it when the gene changes
    if (chromatinFocus.value && chromatinFocus.value.gene.toUpperCase() !== next?.toUpperCase()) {
      chromatinFocus.value = null;
    }
    if (chromatinZoom.value && chromatinZoom.value.gene.toUpperCase() !== next?.toUpperCase()) {
      chromatinZoom.value = null;
    }
    selectedChromatinGene.value = next;
  }
  function setChromatinFocus(peak: Peak | null) {
    chromatinFocus.value = peak;
    if (peak) selectedChromatinGene.value = peak.gene;
  }
  // Zooming to a peak also selects it; null goes back to the full view
  function setChromatinZoom(peak: Peak | null) {
    chromatinZoom.value = peak;
    if (peak) setChromatinFocus(peak);
  }

  function setLinkFilters(filters: Partial<LinkFilters>) {
    linkFilters.value = { ...linkFilters.value, ...filters };
  }
  function resetLinkFilters() {
    linkFilters.value = defaultLinkFilters();
  }

  // Generic setter that handles all properties
  function setSelection(key: string, value: string | null) {
    switch (key) {
      case "selectedGene":
        setSelectedGene(value);
        break;
      case "selectedMetadataColumn":
        setSelectedMetadataColumn(value);
        break;
      case "selectedGene1":
        setSelectedGene1(value);
        break;
      case "selectedGene2":
        setSelectedGene2(value);
        break;
      case "selectedGeneX":
        setSelectedGeneX(value);
        break;
      case "selectedChromatinGene":
        setSelectedChromatinGene(value);
        break;
      default:
        console.warn(`Unknown selection key: ${key}`);
    }
  }

  return {
    selectedGene,
    selectedMetadataColumn,
    selectedGene1,
    selectedGene2,
    selectedGeneX,
    selectedChromatinGene,
    chromatinFocus,
    chromatinZoom,
    linkFilters,
    setSelectedGene,
    setSelectedMetadataColumn,
    setSelectedGene1,
    setSelectedGene2,
    setSelectedGeneX,
    setSelectedChromatinGene,
    setChromatinFocus,
    setChromatinZoom,
    setLinkFilters,
    resetLinkFilters,
    setSelection,
  };
});
