import { ref } from "vue";
import { defineStore } from "pinia";

export const usePrecisionStore = defineStore("precisionGlobalVars", () => {
  // Persistent selections (not cleared on dashboard switch)
  const selectedGene = ref<string | null>(null);
  const selectedMetadataColumn = ref<string | null>(null);
  const selectedGene1 = ref<string | null>(null);
  const selectedGene2 = ref<string | null>(null);

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
      default:
        console.warn(`Unknown selection key: ${key}`);
    }
  }

  return {
    selectedGene,
    selectedMetadataColumn,
    selectedGene1,
    selectedGene2,
    setSelectedGene,
    setSelectedMetadataColumn,
    setSelectedGene1,
    setSelectedGene2,
    setSelection,
  };
});
