import { inject, provide } from "vue";
import * as duckdb from "@duckdb/duckdb-wasm";
import { getSharedDuckDBStore } from "@pennsieve-viz/core";

/**
 * Give core's DataExplorer / UMAP the `'duckdb'` store they inject. Uses the host's store
 * when it provides one (pennsieve-app does); otherwise core's shared store, backed by the
 * same DuckDB instance as the rest of the widgets. Call during setup, in the component that
 * renders them.
 */
export function provideDuckDBStore() {
  if (!inject("duckdb", null)) provide("duckdb", getSharedDuckDBStore(duckdb));
}
