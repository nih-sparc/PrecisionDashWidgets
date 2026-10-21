<template>
  <div
    v-if="options.length > 1"
    class="reduction-toggle"
    role="radiogroup"
    aria-label="Cell map"
  >
    <button
      v-for="opt in options"
      :key="opt.key"
      type="button"
      role="radio"
      :aria-checked="opt.key === modelValue"
      :class="{ active: opt.key === modelValue }"
      :disabled="disabled"
      @click="$emit('update:modelValue', opt.key)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<script setup>
// Segmented control for picking a cell map (e.g. RNA / ATAC / WNN UMAP).
// Renders nothing when there is only one option.
defineProps({
  modelValue: { type: String, default: null },
  options: { type: Array, default: () => [] }, // [{ key, label }]
  disabled: { type: Boolean, default: false },
});
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.reduction-toggle {
  display: inline-flex;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}

.reduction-toggle button {
  padding: 4px 10px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
  background: white;
  border: none;
  border-left: 1px solid #e2e8f0;
  cursor: pointer;
}

.reduction-toggle button:first-child {
  border-left: none;
}

.reduction-toggle button:hover:not(:disabled):not(.active) {
  background: #f8fafc;
  color: #1a202c;
}

.reduction-toggle button.active {
  background: #667eea;
  color: white;
}

.reduction-toggle button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
