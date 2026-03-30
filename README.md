# precision-dashwidgets

## Version Compatibility

| PrecisionDashWidgets | PennsieveDashboard | SparcDashWidgets | Notes |
|----------------------|--------------------|------------------|-------|
| >= 1.0.0             | >= 1.0.0           | >= 1.0.0         | `s3Url`/`apiUrl` removed — use `services` instead |
| < 1.0.0              | < 1.0.0            | < 1.0.0          | Legacy `s3Url`/`apiUrl` on `GlobalVarsShape` |

Pre-1.0 versions of these packages are not compatible with 1.0+. If you are using SparcDashWidgets or PrecisionDashWidgets, all three packages must be on the same side of the 1.0 boundary.

For full documentation on embedding widgets and building custom widget libraries, see the [PennsieveDashboard README](https://github.com/Pennsieve/PennsieveDashboard#readme).

---

Interactive genomics visualization widgets built with Vue 3. These components provide gene expression analysis, dimensionality reduction plots (UMAP/tSNE), and distribution visualizations powered by DuckDB WASM for client-side querying of Parquet data files.

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9

### Clone and Run

```bash
# Clone the repo
git clone https://github.com/nih-sparc/DashboardRepo.git
cd DashboardRepo/packages/PrecisionDashWidgets

# Install dependencies
npm install

# Start the dev server (opens at http://localhost:5173)
npm run dev
```

The dev server loads `src/App.vue`, which renders a `MultiDashboard` with all the widgets wired up against sample data. This is the fastest way to see everything in action.

### Build the Library

```bash
# Build for distribution (outputs to dist/)
npm run build

# Preview the built package
npm run preview
```

The build produces two bundles in `dist/`:
- `precision-dashwidgets.es.js` (ESM)
- `precision-dashwidgets.umd.js` (UMD)
- `style.css` (combined styles)

---

## Architecture

### Libs vs Components

The codebase uses a **two-layer architecture** under `src/`:

- **`src/components/`** — Lightweight **wrapper components** that form the public API. Each wrapper handles prop injection (e.g. `dataPath`, `initialGene1`), connects to the shared Pinia store, resolves the data URL via `useDashboardGlobalVars()`, and delegates all rendering to a corresponding lib component. These are what consumers import.

- **`src/libs/`** — The **implementation layer** where the actual visualization logic lives. Lib components own DuckDB initialization, WebGL/D3 rendering, user interaction handling, and local state. For example, `components/GeneExpressionViewer/` wraps `libs/GeneExpressionViewer/GeneCoexpressionViewer.vue`.

This split keeps the public-facing component API clean and dashboard-aware, while the libs remain self-contained and reusable.

### DuckDB and dataManager.js

All data access goes through `src/libs/dataManager.js`, which exports the `UMAPGeneViewer` class. When a component mounts, it creates a `UMAPGeneViewer` instance pointed at a base URL (S3, HTTP, etc.) containing Parquet files. The class initializes a **DuckDB WASM** worker in-browser, fetches the Parquet files as binary buffers, registers them in DuckDB, and then runs SQL queries entirely client-side — no backend needed.

Key operations include loading UMAP/tSNE coordinates, searching genes via full-text SQL queries against `gene_stats.parquet`, and loading individual gene expression data on-demand from chunked Parquet files referenced in `gene_locations.parquet`. Results are cached in memory so repeated gene lookups are instant.

Each component currently creates its own `UMAPGeneViewer` / DuckDB instance. See [Known Limitations](#known-limitations) and the [Roadmap](#roadmap-configurable-data-schema) for planned shared-instance support.

### Shared State

Cross-widget coordination (e.g. selecting a gene in one widget updates another) is handled by a **Pinia store** (`usePrecisionStore`). Dashboard-level context like the data URL and filters flows through Vue's `provide`/`inject` via `DASHBOARD_GLOBAL_VARS_KEY`.

---

## Components

### GeneExpression

Gene co-expression analysis widget. Renders a scatter plot (UMAP or tSNE) colored by the co-expression of two selected genes. Includes autocomplete gene search, dual gene selection, and a statistics panel.

| Prop | Type | Description |
|------|------|-------------|
| `dataPath` | `string?` | URL to data directory containing Parquet files. Falls back to injected `services.s3Url`, then the default. |
| `initialGene1` | `string?` | Pre-selected first gene (e.g. `"CDH9"`) |
| `initialGene2` | `string?` | Pre-selected second gene (e.g. `"TAC1"`) |

### SideBySide

Dual-panel comparison widget. Left panel shows a UMAP colored by a selected metadata column (cell type, cluster, etc.). Right panel shows a UMAP colored by expression level of a selected gene. Useful for comparing spatial clustering against gene expression patterns.

| Prop | Type | Description |
|------|------|-------------|
| `dataPath` | `string?` | URL to data directory containing Parquet files. Falls back to injected `services.s3Url`, then the default. |
| `initialGene` | `string?` | Pre-selected gene for the expression panel |
| `initialMetadataColumn` | `string?` | Pre-selected metadata column for the metadata panel |

### ViolinPlot (also exported as `GeneXDistribution`)

Gene expression distribution widget. Renders violin or box plots showing the distribution of a gene's expression across metadata categories. Supports toggling between violin and box plot modes, and can overlay individual data points.

| Prop | Type | Description |
|------|------|-------------|
| `dataPath` | `string?` | URL to data directory containing Parquet files. Falls back to injected `services.s3Url`, then the default. |
| `initialGene` | `string?` | Pre-selected gene |
| `initialMetadataColumn` | `string?` | Pre-selected metadata column for x-axis grouping |

### Additional Components

- **DataExplorer** - Data exploration interface
- **UMAP** - Standalone UMAP visualization
- **ProportionPlot** - Cell proportion visualization

## Data Requirements

All components use DuckDB WASM to query Parquet files from a remote data path (S3 or any HTTP-accessible location). The data path must contain the following files:

| File | Required | Description |
|------|----------|-------------|
| `umap_complete.parquet` | Yes | UMAP coordinates + cell metadata |
| `tsne_complete.parquet` | No | tSNE coordinates (enables tSNE option in GeneExpression) |
| `gene_locations.parquet` | Yes | Mapping of gene names to their data file locations |
| `gene_stats.parquet` | Yes | Gene-level statistics used for search/autocomplete |
| `cells.parquet` | Yes | Cell metadata (cell types, clusters, etc.) |
| `metadata.parquet` | No | Alternative/extended metadata source |
| `genes.parquet` | Yes | Gene name to ID mapping |

Gene expression values are loaded on-demand from individual or chunked Parquet files referenced in `gene_locations.parquet`.

---

## Use Case 1: Inside the Pennsieve Dashboard

When used within the `pennsieve-dashboard`, components are provided context automatically via Vue's `provide`/`inject` and a shared Pinia store.

### Install

The package is already a workspace dependency. If needed:

```bash
npm install precision-dashwidgets
```

### Import Components

```js
import {
  GeneExpression,
  SideBySide,
  ViolinPlot, // or GeneXDistribution
} from 'precision-dashwidgets'
import 'precision-dashwidgets/style.css'
```

### Register in a Layout

The dashboard uses a widget layout system. Register components in your layout config:

```js
const defaultLayout = [
  {
    id: 'GeneExpression-0',
    x: 0, y: 0, w: 3, h: 8,
    componentKey: 'GeneExpression',
    componentName: 'Gene Co-expression',
    component: GeneExpression,
    Props: {
      initialGene1: 'CDH9',
      initialGene2: 'TAC1',
    },
  },
  {
    id: 'SideBySide-0',
    x: 3, y: 0, w: 3, h: 8,
    componentKey: 'SideBySide',
    componentName: 'Side by Side',
    component: SideBySide,
    Props: {
      initialGene: 'CDH9',
      initialMetadataColumn: 'cell_type',
    },
  },
  {
    id: 'ViolinPlot-0',
    x: 0, y: 8, w: 3, h: 8,
    componentKey: 'ViolinPlot',
    componentName: 'Gene Distribution',
    component: ViolinPlot,
    Props: {
      initialGene: 'CDH9',
      initialMetadataColumn: 'cell_type',
    },
  },
]
```

### How State Flows in the Dashboard

The dashboard provides two context mechanisms:

1. **Global vars injection** (`DASHBOARD_GLOBAL_VARS_KEY`) - provides `services` (configurables like data URLs, API keys) and shared `filters` via `provide`/`inject`.
2. **Pinia store** (`usePrecisionStore`) - shared reactive state for gene and metadata selections across all widgets. When a user selects a gene in one widget, other widgets can react.

These are wired automatically when used inside the dashboard framework.

---

## Use Case 2: Standalone (Without Pennsieve Dashboard)

You can use these components in any Vue 3 application. This requires setting up the dependencies that the dashboard normally provides.

### Install

```bash
npm install precision-dashwidgets
```

### Peer Dependencies

Install the required peer dependencies:

```bash
npm install vue pinia element-plus @element-plus/icons-vue
```

### Setup

#### 1. Register Pinia and Element Plus

```js
// main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus)
app.mount('#app')
```

#### 2. Import Styles

```js
import 'precision-dashwidgets/style.css'
```

#### 3. Use the Components

The simplest approach is to pass your data URL directly via the `dataPath` prop. Your directory must contain the same Parquet file names listed in [Data Requirements](#data-requirements).

```vue
<template>
  <div style="height: 600px; width: 100%;">
    <GeneExpression
      dataPath="https://your-bucket.s3.amazonaws.com/your-dataset"
      initialGene1="CDH9"
      initialGene2="TAC1"
    />
  </div>

  <div style="height: 600px; width: 100%;">
    <SideBySide
      dataPath="https://your-bucket.s3.amazonaws.com/your-dataset"
      initialGene="CDH9"
      initialMetadataColumn="cell_type"
    />
  </div>

  <div style="height: 500px; width: 100%;">
    <ViolinPlot
      dataPath="https://your-bucket.s3.amazonaws.com/your-dataset"
      initialGene="CDH9"
      initialMetadataColumn="cell_type"
    />
  </div>
</template>

<script setup>
import {
  GeneExpression,
  SideBySide,
  ViolinPlot,
} from 'precision-dashwidgets'
</script>
```

#### Alternative: Provide Global Vars (set data path once)

Instead of passing `dataPath` to every component, you can provide `DASHBOARD_GLOBAL_VARS_KEY` in an ancestor component. All widgets will inherit `services.s3Url` from it:

```vue
<script setup>
import { provide, ref } from 'vue'
import { DASHBOARD_GLOBAL_VARS_KEY } from 'precision-dashwidgets'

provide(DASHBOARD_GLOBAL_VARS_KEY, {
  services: ref({ s3Url: 'https://your-bucket.s3.amazonaws.com/your-dataset' }),
  filters: ref({}),
  setFilter: () => {},
  clearFilter: () => {},
})
</script>
```

**Resolution order:** `dataPath` prop > injected `services.s3Url` > built-in default URL.

### Accessing Shared State

If you need to read or control widget selections programmatically, import the Pinia store:

```js
import { usePrecisionStore } from 'precision-dashwidgets'

const store = usePrecisionStore()

// Read current selections
console.log(store.selectedGene)
console.log(store.selectedMetadataColumn)

// Set selections programmatically
store.setSelectedGene('TAC1')
store.setSelectedMetadataColumn('cluster')
```

#### Store Properties

| Property | Used By | Description |
|----------|---------|-------------|
| `selectedGene` | SideBySide | Currently selected gene |
| `selectedMetadataColumn` | SideBySide, ViolinPlot | Currently selected metadata column |
| `selectedGene1` | GeneExpression | First gene in co-expression |
| `selectedGene2` | GeneExpression | Second gene in co-expression |
| `selectedGeneX` | ViolinPlot | Selected gene for distribution plot |

---

## Exports

```js
// Components
export { GeneExpression }       // Gene co-expression analysis
export { SideBySide }           // Dual UMAP comparison
export { ViolinPlot }           // Violin/box plot (alias for GeneXDistribution)
export { GeneXDistribution }    // Violin/box plot (original name)
export { DataExplorer }         // Data exploration
export { UMAP }                 // Standalone UMAP
export { ProportionPlot }       // Proportion visualization

// Utilities
export { usePrecisionStore }          // Pinia store for shared widget state
export { useDashboardGlobalVars }     // Composable to access injected global vars
export { DASHBOARD_GLOBAL_VARS_KEY }  // Injection key for providing global vars
```

## Bringing Your Own Data

You can point the widgets at any HTTP-accessible directory, as long as it contains Parquet files with the **exact names** listed in [Data Requirements](#data-requirements). The internal `dataManager` appends those filenames to whatever base path you provide (e.g. `{dataPath}/umap_complete.parquet`).

Currently there is no way to customize file names, column mappings, or the data schema. See the roadmap below for planned support.

## Known Limitations

- **Fixed Parquet file names**: Your data directory must use the exact file names the `dataManager` expects (`umap_complete.parquet`, `genes.parquet`, etc.). Custom naming is not yet supported.
- **Fixed column schema**: The components expect specific column names inside the Parquet files (e.g. UMAP coordinates, gene expression values). These cannot be remapped yet.
- **DuckDB WASM**: Components initialize a DuckDB WASM instance at mount time, which downloads the DuckDB worker from jsDelivr CDN. Ensure your environment allows loading scripts from `cdn.jsdelivr.net`.
- **Sizing**: Components expand to fill their parent container. Wrap them in a container with explicit `height` and `width`.
- **One DuckDB instance per component**: Each widget creates its own `UMAPGeneViewer` / DuckDB instance. If you mount multiple widgets, they each load data independently.

---

## Roadmap: Configurable Data Schema

Currently the `dataManager` has hardcoded file names and column expectations. The plan for making this fully configurable:

### Phase 1 - Data Config Object

Introduce a `DataConfig` type that maps logical data roles to actual file paths and column names:

```ts
interface DataConfig {
  // Base URL for all data files
  basePath: string

  // File name overrides (defaults to current names)
  files: {
    umap?: string           // default: "umap_complete.parquet"
    tsne?: string           // default: "tsne_complete.parquet"
    geneLocations?: string  // default: "gene_locations.parquet"
    geneStats?: string      // default: "gene_stats.parquet"
    cells?: string          // default: "cells.parquet"
    metadata?: string       // default: "metadata.parquet"
    genes?: string          // default: "genes.parquet"
  }

  // Column name mappings per file
  columns: {
    umap?: {
      x?: string            // default: "umap_1"
      y?: string            // default: "umap_2"
      cellId?: string       // default: "cell_id"
    }
    tsne?: {
      x?: string            // default: "tsne_1"
      y?: string            // default: "tsne_2"
    }
    genes?: {
      name?: string         // default: "gene_name"
      id?: string           // default: "gene_id"
    }
    // ... etc for each file
  }
}
```

### Phase 2 - Update dataManager.js

Refactor `UMAPGeneViewer` to accept a `DataConfig` instead of a plain `basePath` string:

1. `loadEssentialData()` reads file paths from `config.files` instead of hardcoded names.
2. All SQL queries use `config.columns` mappings instead of hardcoded column names.
3. Merge user-provided config with defaults so only overrides need to be specified.

### Phase 3 - Shared DuckDB Instance

Instead of each component creating its own DuckDB instance:

1. Create a `useDataManager()` composable that provides a singleton `UMAPGeneViewer` via `provide`/`inject`.
2. Components call `useDataManager()` to get the shared instance.
3. The config is set once at the provider level, all widgets share the connection and cache.

### Phase 4 - Component Props

Wire the config through the component layer:

1. Wrapper components accept an optional `dataConfig` prop.
2. If not provided, fall back to the injected shared instance.
3. The `provide` approach from Phase 3 becomes the recommended setup for standalone users.

This would let standalone users do:

```vue
<script setup>
import { provide } from 'vue'
import { createDataProvider } from 'precision-dashwidgets'

const dataProvider = createDataProvider({
  basePath: 'https://my-bucket.s3.amazonaws.com/my-data',
  files: {
    umap: 'embeddings.parquet',
    genes: 'gene_index.parquet',
  },
  columns: {
    umap: { x: 'dim1', y: 'dim2' },
  },
})

provide('precision:data', dataProvider)
</script>
```

## Tech Stack

- **Vue 3** - Component framework
- **DuckDB WASM** - Client-side SQL engine for Parquet file queries
- **D3.js** - SVG-based visualizations (violin plots, axes, legends)
- **regl** - WebGL rendering for high-performance scatter plots
- **Pinia** - State management across widgets
- **Element Plus** - UI components (dropdowns, inputs)
- **Vite** - Build tooling (library mode)
