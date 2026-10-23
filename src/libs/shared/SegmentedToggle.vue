<template>
  <div
    v-if="options.length > (hideSingle ? 1 : 0)"
    class="segmented-toggle"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <button
      v-for="opt in options"
      :key="opt.key"
      type="button"
      role="radio"
      :aria-checked="opt.key === modelValue"
      :class="{ active: opt.key === modelValue }"
      :disabled="disabled || opt.disabled"
      :title="opt.title"
      @click="$emit('update:modelValue', opt.key)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<script setup>
// Segmented control for choosing one of a few options (cell map, plot type, signal mode…).
// The theme's secondary style; the selected option takes the primary color.
defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, default: () => [] }, // [{ key, label, disabled?, title? }]
  disabled: { type: Boolean, default: false },
  ariaLabel: { type: String, default: null },
  // Render nothing when there's only one option (e.g. a dataset with one cell map)
  hideSingle: { type: Boolean, default: false },
});
defineEmits(["update:modelValue"]);
</script>

<style scoped>
.segmented-toggle {
  display: inline-flex;
  border: 1px solid var(--pdw-border);
  border-radius: var(--pdw-radius);
  overflow: hidden;
  flex-shrink: 0;
}

.segmented-toggle button {
  padding: 4px 12px;
  font-size: 16px;
  font-weight: 500;
  color: var(--pdw-text-muted);
  background: var(--pdw-surface);
  border: none;
  border-left: 1px solid var(--pdw-border);
  cursor: pointer;
}

.segmented-toggle button:first-child {
  border-left: none;
}

.segmented-toggle button:hover:not(:disabled):not(.active) {
  background: var(--pdw-surface-muted);
  color: var(--pdw-text);
}

.segmented-toggle button.active {
  background: var(--pdw-primary);
  color: var(--pdw-primary-contrast);
}

.segmented-toggle button:focus-visible {
  outline: 2px solid var(--pdw-primary);
  outline-offset: -2px;
}

.segmented-toggle button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
