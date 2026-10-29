import * as duckdb from "@duckdb/duckdb-wasm";
import { buildSignedUrl, getSharedDuckDB } from "@pennsieve-viz/core";

// Every viewer uses the page's one DuckDB (shared with other libraries through core) and
// registers its files under its own prefix, so datasets never collide and a switch only
// drops files instead of restarting DuckDB.
let viewerCount = 0;

/** Start booting the shared DuckDB now (~1 s) so it's ready when the data arrives. */
export function preloadDuckDB() {
  getSharedDuckDB(duckdb).catch(() => {}); // a failure resurfaces when a viewer needs it
}

/**
 * Arrow table → array of plain objects. Reads column by column, which is
 * ~3x faster than row.toJSON() on wide tables. `transform` can extend each row.
 */
function tableToObjects(table, transform) {
  const names = table.schema.fields.map((f) => f.name);
  const columns = names.map((name) => {
    const vec = table.getChild(name);
    // toArray() turns nulls into 0 for numeric columns, so use get() when there are nulls
    return vec.nullCount === 0 ? vec.toArray() : Array.from({ length: vec.length }, (_, i) => vec.get(i));
  });
  const rows = new Array(table.numRows);
  for (let i = 0; i < rows.length; i++) {
    const row = {};
    for (let c = 0; c < names.length; c++) row[names[c]] = columns[c][i];
    rows[i] = transform ? transform(row) : row;
  }
  return rows;
}

export class UMAPGeneViewer {
  constructor(basePath = "/data", config = {}) {
    this.basePath = basePath;
    this.config = config;
    this.manifest = null;
    this.db = null;
    this.conn = null;
    this.reductions = new Map(); // key → merged data array
    this._pendingReductions = new Map(); // key → promise, for maps loading in the background
    this._reductionListeners = new Set();
    this.geneCache = new Map();
    this._prefix = `precision/${++viewerCount}/`;
    this._files = new Set(); // registered names, dropped on dispose
    this._loadedChromatinFiles = new Set();
    this._chromatinListeners = new Set();
  }

  /** This viewer's name for a data file in the shared DuckDB. */
  _file(name) {
    return this._prefix + name;
  }

  async _register(name, bytes) {
    const file = this._file(name);
    await this.db.registerFileBuffer(file, bytes);
    this._files.add(file);
  }

  // Backward-compat accessors
  get umapData() {
    return this.reductions.get("umap") || null;
  }

  // Signed with the credentials current at call time (config.getCloudfront), so
  // files fetched long after load still carry a valid signature
  _buildUrl(filename) {
    const qIndex = this.basePath.indexOf('?');
    const url = qIndex === -1
      ? `${this.basePath}/${filename}`
      : `${this.basePath.substring(0, qIndex)}/${filename}${this.basePath.substring(qIndex)}`;
    return buildSignedUrl(url, this.config?.getCloudfront?.());
  }

  async initialize() {
    try {
      // Data downloads don't need DuckDB, so start them while it boots
      const t0 = performance.now();
      const since = () => Math.round(performance.now() - t0);
      const timing = {};
      const files = this._startDownloads().then((f) => ((timing.downloads = since()), f));
      files.catch(() => {}); // surfaced by the await below
      this.db = await getSharedDuckDB(duckdb);
      this.conn = await this.db.connect();
      timing.duckdb = since();

      await this.loadEssentialData(await files);
      console.info(
        `[DataEngine] ready in ${since()} ms (DuckDB ready at ${timing.duckdb} ms, ` +
          `files downloaded at ${timing.downloads} ms)`
      );
    } catch (error) {
      console.error("Failed to initialize data manager:", error);
      this.dispose();
      throw new Error(`Initialization failed: ${error.message}`);
    }
  }

  /**
   * Close this viewer's connection and drop its files from the shared DuckDB (which keeps
   * running for other users). The viewer can't be used afterwards.
   */
  async dispose() {
    this._reductionListeners.clear();
    const { conn, db } = this;
    const files = [...this._files];
    this.conn = null;
    this.db = null;
    this._files.clear();
    try {
      await conn?.close();
      for (const file of files) await db?.dropFile(file);
    } catch (error) {
      console.warn("[DataEngine] Error while shutting down DuckDB:", error);
    }
  }

  /** Begin fetching everything needed for the first view. Resolves to { reductionFiles, firstReduction, loaded }. */
  async _startDownloads() {
    const fixedFiles = [
      { name: "gene_locations.parquet", required: true },
      { name: "gene_stats.parquet", required: true },
      { name: "cells.parquet", required: true },
      { name: "metadata.parquet", required: false },
      { name: "genes.parquet", required: true },
    ].map((f) => ({ ...f, path: this._buildUrl(f.name) }));
    const fixedDownloads = fixedFiles.map((f) => this._fetchFile(f));
    fixedDownloads.forEach((d) => d.catch(() => {})); // surfaced by Promise.all below

    // Without embeddings from config, read them from the dataset's manifest
    if (!this.config?.embeddings?.length) {
      await this._loadManifest();
    }

    // Build the list of reduction files from config or defaults.
    // The map shown first downloads now; the rest load in the background.
    const reductionFiles = this._getReductionFiles();
    const defaultKey = this._pickDefaultReduction(reductionFiles.map((rf) => rf.reductionKey));
    const firstReduction = reductionFiles.find((rf) => rf.reductionKey === defaultKey);
    const files = [...(firstReduction ? [firstReduction] : []), ...fixedFiles];
    const downloads = [...(firstReduction ? [this._fetchFile(firstReduction)] : []), ...fixedDownloads];
    const buffers = await Promise.all(downloads);
    return {
      reductionFiles,
      firstReduction,
      loaded: files.map((file, i) => ({ file, buffer: buffers[i] })),
    };
  }

  async loadEssentialData({ reductionFiles, firstReduction, loaded }) {
    const laterReductions = reductionFiles.filter((rf) => rf !== firstReduction);

    await Promise.all(
      loaded
        .filter(({ buffer }) => buffer)
        .map(({ file, buffer }) => this._register(file.name, buffer))
    );

    const hasMetadataFile = loaded.some(({ file, buffer }) => file.name === "metadata.parquet" && buffer);
    this._cellMetadata = await this._readCellMetadata(hasMetadataFile);

    if (firstReduction) await this._loadReduction(firstReduction);

    // Other maps download now but are only parsed when first shown, so they
    // don't hold up gene queries on the shared DuckDB connection
    for (const rf of laterReductions) {
      const downloaded = this._fetchFile(rf).then(
        (buffer) => buffer && this._register(rf.name, buffer).then(() => true)
      );
      // Drop a map as soon as its download fails, so it never shows as an option
      downloaded.then(
        (ok) => ok || this._dropReduction(rf.reductionKey, "file not found"),
        (err) => this._dropReduction(rf.reductionKey, err.message)
      );
      this._pendingReductions.set(rf.reductionKey, { rf, downloaded, parsed: null });
    }
  }

  /**
   * Call `fn` when a background cell map turns out to be unavailable, so the
   * map options can be refreshed. Returns an unsubscribe function.
   */
  onReductionsChange(fn) {
    this._reductionListeners.add(fn);
    return () => this._reductionListeners.delete(fn);
  }

  _dropReduction(key, reason) {
    if (!this._pendingReductions.delete(key)) return;
    console.warn(
      `[DataEngine] Cell map "${this.getReductionLabel(key)}" (${key}) didn't load: ${reason}. ` +
        "It has been removed from the map options."
    );
    this._reductionListeners.forEach((fn) => fn());
  }

  /** Download a file. Returns its bytes, or null if an optional file is missing. */
  async _fetchFile(file) {
    try {
      const response = await fetch(file.path);
      if (!response.ok) {
        if (file.required) {
          throw new Error(
            `Failed to load required file: ${file.name} (${response.status} ${response.statusText})`
          );
        }
        console.log(`Optional file ${file.name} not available, skipping...`);
        return null;
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (file.required) throw error;
      console.log(`Optional file ${file.name} not available:`, error.message);
      return null;
    }
  }

  /** Cell metadata by cell_id, from metadata.parquet when the dataset has one, else cells.parquet. */
  async _readCellMetadata(hasMetadataFile) {
    const cellMetadata = new Map();
    try {
      const file = hasMetadataFile ? "metadata.parquet" : "cells.parquet";
      const result = await this.conn.query(`SELECT * FROM "${this._file(file)}"`);
      for (const row of tableToObjects(result)) {
        cellMetadata.set(row.cell_id, row);
      }
    } catch (error) {
      console.warn("Could not load cell metadata:", error);
    }
    return cellMetadata;
  }

  /** Merge a reduction with cell metadata and store it in the reductions Map. */
  async _loadReduction(rf) {
    try {
      const result = await this.conn.query(`SELECT * FROM "${this._file(rf.name)}"`);
      const merged = tableToObjects(result, (row) =>
        Object.assign(row, this._cellMetadata.get(row.cell_id))
      );
      this.reductions.set(rf.reductionKey, merged);
      return true;
    } catch (err) {
      if (rf.required) throw err;
      console.log(`Reduction ${rf.reductionKey} not available`);
      return false;
    }
  }

  /** Fetch manifest.json next to the data files. Optional: older datasets have none. */
  async _loadManifest() {
    try {
      const response = await fetch(this._buildUrl("manifest.json"));
      if (response.ok) this.manifest = await response.json();
    } catch (error) {
      console.log("manifest.json not available:", error.message);
    }
  }

  get embeddings() {
    return this.config?.embeddings || this.manifest?.embeddings || null;
  }

  /** Build list of reduction parquet files from config embeddings or defaults. */
  _getReductionFiles() {
    const embeddings = this.embeddings;

    if (embeddings && embeddings.length > 0) {
      // Multiome manifests list the default embedding twice (its own file and
      // umap_complete.parquet) under the same key; load it once
      const seen = new Set();
      return embeddings
        .filter((emb) => !seen.has(emb.key) && seen.add(emb.key))
        .map((emb) => ({
          name: `${emb.key}.parquet`,
          path: this._buildUrl(emb.file || `${emb.key}_complete.parquet`),
          required: emb.required !== false,
          reductionKey: emb.key,
        }));
    }

    // Default: umap (required) + tsne (optional)
    return [
      {
        name: "umap.parquet",
        path: this._buildUrl("umap_complete.parquet"),
        required: true,
        reductionKey: "umap",
      },
      {
        name: "tsne.parquet",
        path: this._buildUrl("tsne_complete.parquet"),
        required: false,
        reductionKey: "tsne",
      },
    ];
  }

  /** Reduction to show first: the dataset's default (WNN for multiome), else umap. */
  get defaultReduction() {
    return this._pickDefaultReduction(this.getAvailableReductions());
  }

  _pickDefaultReduction(keys) {
    const preferred =
      this.config?.default_embedding || this.manifest?.default_embedding;
    if (preferred && keys.includes(preferred)) return preferred;
    if (keys.includes("umap")) return "umap";
    return keys[0] ?? null;
  }

  async getReductionData(reductionType = this.defaultReduction) {
    await this._finishReduction(reductionType);
    const data = this.reductions.get(reductionType);
    if (!data) {
      throw new Error(`Reduction "${reductionType}" not available`);
    }
    return data;
  }

  /** Parse a background-downloaded map the first time it's needed. */
  _finishReduction(key) {
    const pending = this._pendingReductions.get(key);
    if (!pending) return null;
    if (!pending.parsed) {
      pending.parsed = pending.downloaded
        .then((ok) => ok && this._loadReduction(pending.rf))
        .then((loaded) => {
          if (loaded) this._pendingReductions.delete(key);
          else this._dropReduction(key, "the file could not be read");
        })
        .catch((err) => this._dropReduction(key, err.message));
    }
    return pending.parsed;
  }

  /** Get all available reduction keys, including ones still loading. */
  getAvailableReductions() {
    return [...new Set([...this.reductions.keys(), ...this._pendingReductions.keys()])];
  }

  /**
   * Available reductions as { key, label }, ordered RNA, ATAC, WNN, then others.
   * Labels come from the manifest entry's `label`, else its file name / key.
   */
  getReductionOptions() {
    const order = ["RNA", "ATAC", "WNN", "UMAP", "tSNE"];
    const rank = (label) => {
      const i = order.indexOf(label);
      return i === -1 ? order.length : i;
    };
    return this.getAvailableReductions()
      .map((key) => ({ key, label: this.getReductionLabel(key) }))
      .sort((a, b) => rank(a.label) - rank(b.label));
  }

  getReductionLabel(key) {
    const emb = this._getEmbedding(key);
    if (emb?.label) return emb.label;
    // File name first: a multiome RNA UMAP can be keyed plain "umap"
    // but is written to rna_umap_complete.parquet
    const name = `${emb?.file || ""} ${key}`.toLowerCase();
    if (name.includes("wnn")) return "WNN";
    if (name.includes("atac")) return "ATAC";
    if (name.includes("rna")) return "RNA";
    if (name.includes("tsne")) return "tSNE";
    if (name.includes("umap")) return "UMAP";
    return key;
  }

  /** [x, y] coordinate column names for a reduction. */
  getReductionAxes(key) {
    const columns = this._getEmbedding(key)?.columns?.filter(
      (c) => c !== "cell_id"
    );
    if (columns?.length >= 2) return [columns[0], columns[1]];
    return key === "tsne" ? ["tsne_1", "tsne_2"] : ["umap_1", "umap_2"];
  }

  _getEmbedding(key) {
    return this.embeddings?.find((emb) => emb.key === key) || null;
  }

  hasReduction(key) {
    return this.reductions.has(key) || this._pendingReductions.has(key);
  }

  hasTsne() {
    return this.hasReduction("tsne");
  }

  async searchGenes(query) {
    if (!query || query.length < 1) {
      return [];
    }

    try {
      // First, check what columns are available
      const columnsResult = await this.conn.query(`
        DESCRIBE "${this._file("gene_stats.parquet")}"
      `);

      const columns = columnsResult.toArray().map((row) => row.toJSON());
      const columnNames = columns.map((c) => c.column_name);

      // Build query based on available columns
      let selectCols = ["gene_name"];
      if (columnNames.includes("mean_expr")) selectCols.push("mean_expr");
      if (columnNames.includes("total_expr")) selectCols.push("total_expr");
      if (columnNames.includes("pct_cells")) selectCols.push("pct_cells");
      if (columnNames.includes("n_cells_expressing"))
        selectCols.push("n_cells_expressing");

      const result = await this.conn.query(`
        SELECT ${selectCols.join(", ")}
        FROM "${this._file("gene_stats.parquet")}"
        WHERE UPPER(gene_name) LIKE UPPER('%${query}%')
        ORDER BY mean_expr DESC
        LIMIT 50
      `);

      return result.toArray().map((row) => row.toJSON());
    } catch (error) {
      console.error("Gene search failed:", error);
      return [];
    }
  }
  async getCellDetails(cellId) {
    try {
      // Try to get from loaded data first
      const umapCell = this.umapData?.find((c) => c.cell_id === cellId);
      if (umapCell) {
        return umapCell;
      }

      // Otherwise query directly
      try {
        const result = await this.conn.query(`
                SELECT * FROM "${this._file("metadata.parquet")}" WHERE cell_id = '${cellId}'
            `);
        const rows = result.toArray();
        if (rows.length > 0) {
          return rows[0].toJSON();
        }
      } catch (e) {
        const result = await this.conn.query(`
                SELECT * FROM "${this._file("cells.parquet")}" WHERE cell_id = '${cellId}'
            `);
        const rows = result.toArray();
        if (rows.length > 0) {
          return rows[0].toJSON();
        }
      }

      return null;
    } catch (error) {
      console.error("Failed to get cell details:", error);
      return null;
    }
  }
  async getGeneExpression(geneName) {
    // Check cache first
    if (this.geneCache.has(geneName)) {
      return this.geneCache.get(geneName);
    }

    try {
      // First, look up the gene ID from the gene name
      const geneIdResult = await this.conn.query(`
        SELECT gene_id
        FROM "${this._file("genes.parquet")}"
        WHERE gene_name = '${geneName}'
      `);

      const geneIdArray = geneIdResult.toArray();
      if (geneIdArray.length === 0) {
        throw new Error(`Gene ${geneName} not found in dataset`);
      }

      const geneId = geneIdArray[0].toJSON().gene_id;

      // Look up gene location
      const locationResult = await this.conn.query(`
        SELECT location, is_precomputed
        FROM "${this._file("gene_locations.parquet")}"
        WHERE gene_name = '${geneName}'
      `);

      const locationArray = locationResult.toArray();
      if (locationArray.length === 0) {
        throw new Error(`Gene ${geneName} not found in dataset`);
      }

      const locationData = locationArray[0].toJSON();
      const location = locationData.location;
      const isPrecomputed = locationData.is_precomputed;

      let geneData;

      if (isPrecomputed) {
        // Load individual gene file (fast!)
        const response = await fetch(this._buildUrl(location));
        if (!response.ok) {
          throw new Error(`Failed to load gene file: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const tempFileName = `gene_${geneName.replace(
          /[^a-zA-Z0-9]/g,
          "_"
        )}.parquet`;

        await this._register(tempFileName, new Uint8Array(buffer));

        const result = await this.conn.query(`
          SELECT cell_id, expression FROM "${this._file(tempFileName)}"
        `);

        geneData = result.toArray().map((row) => row.toJSON());
      } else {
        // Load chunk file
        const chunkFileName = location.split("/").pop();

        await this._ensureChunk(chunkFileName, location);

        const result = await this.conn.query(`
          SELECT cell_id, expression
          FROM "${this._file(chunkFileName)}"
          WHERE gene_id = ${geneId}
        `);

        geneData = result.toArray().map((row) => row.toJSON());
      }

      // Cache it
      this.geneCache.set(geneName, geneData);
      return geneData;
    } catch (error) {
      console.error(`Failed to load gene ${geneName}:`, error);
      throw error;
    }
  }

  /** Download and register a gene chunk once, even when several genes ask for it at the same time. */
  _ensureChunk(chunkFileName, location) {
    if (!this._chunkLoads) this._chunkLoads = new Map();
    if (!this._chunkLoads.has(chunkFileName)) {
      const load = (async () => {
        const response = await fetch(this._buildUrl(location));
        if (!response.ok) {
          throw new Error(`Failed to load chunk file: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        await this._register(chunkFileName, new Uint8Array(buffer));
      })();
      // Let a failed download be retried
      load.catch(() => this._chunkLoads.delete(chunkFileName));
      this._chunkLoads.set(chunkFileName, load);
    }
    return this._chunkLoads.get(chunkFileName);
  }

  getCellCount() {
    return this.umapData ? this.umapData.length : 0;
  }

  clearCache() {
    this.geneCache.clear();
  }

  // ---- Chromatin (multiome only) ----
  // Files are fetched on first use, so RNA-only datasets never pay for them.

  /** manifest.json `provenance`: which outputs the processor calculated, and how. */
  get provenance() {
    return this.config?.provenance || this.manifest?.provenance || null;
  }

  get chromatinInfo() {
    return this.config?.chromatin || this.manifest?.chromatin || null;
  }

  /** Load all chromatin files. Resolves to { tracks, geneCoords, links } booleans. */
  async loadChromatin() {
    const [tracks, geneCoords, links] = await Promise.all([
      this._loadChromatinFile("chromatin_tracks.parquet", "has_tracks"),
      this._loadChromatinFile("gene_coordinates.parquet", "has_gene_coordinates"),
      this._loadChromatinFile("linked_peaks.parquet", "has_linked_peaks"),
    ]);
    return { tracks, geneCoords, links };
  }

  /** Load only the linked peaks file (small), for views that don't need tracks. */
  loadLinkedPeaks() {
    return this._loadChromatinFile("linked_peaks.parquet", "has_linked_peaks");
  }

  // Each file is fetched once and shared by every view
  _loadChromatinFile(name, manifestFlag) {
    if (!this._chromatinFiles) this._chromatinFiles = new Map();
    if (!this._chromatinFiles.has(name)) {
      // Skip files the manifest says are missing; without a manifest, try anyway
      const listed = this.chromatinInfo?.[manifestFlag];
      const load = listed === false ? Promise.resolve(false) : this._registerOptional(name);
      load.then((ok) => {
        if (!ok) return;
        this._loadedChromatinFiles.add(name);
        this._chromatinListeners.forEach((fn) => fn(name));
      });
      this._chromatinFiles.set(name, load);
    }
    return this._chromatinFiles.get(name);
  }

  /** True once a chromatin file has been downloaded (by any view). */
  isChromatinFileLoaded(name) {
    return this._loadedChromatinFiles.has(name);
  }

  /**
   * Call `fn(name)` whenever a chromatin file finishes loading, so a view can use a file
   * another view downloaded. Returns an unsubscribe function.
   */
  onChromatinFileLoaded(fn) {
    this._chromatinListeners.add(fn);
    return () => this._chromatinListeners.delete(fn);
  }

  async _registerOptional(name) {
    try {
      const response = await fetch(this._buildUrl(name));
      if (!response.ok) return false;
      const buffer = await response.arrayBuffer();
      await this._register(name, new Uint8Array(buffer));
      return true;
    } catch (error) {
      console.log(`Optional file ${name} not available:`, error.message);
      return false;
    }
  }

  /** Gene location with exons as [[start, end], ...], or null if not annotated. */
  async getGeneCoordinates(geneName) {
    const rows = await this._query(`
      SELECT gene_name, chrom, start, "end", strand, exon_starts, exon_ends
      FROM "${this._file("gene_coordinates.parquet")}"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
      LIMIT 1
    `);
    return rows.length ? toGeneModel(rows[0]) : null;
  }

  /** All annotated genes overlapping a region, for the gene model row. */
  async getGenesInRegion(chrom, start, end) {
    const rows = await this._query(`
      SELECT gene_name, chrom, start, "end", strand, exon_starts, exon_ends
      FROM "${this._file("gene_coordinates.parquet")}"
      WHERE chrom IN (${chromVariants(chrom)}) AND "end" >= ${start} AND start <= ${end}
    `);
    return rows.map(toGeneModel);
  }

  /** Groups that have a track (cell types), cached. */
  async getChromatinGroups() {
    if (!this._chromatinGroups) {
      const rows = await this._query(
        `SELECT DISTINCT cell_type FROM "${this._file("chromatin_tracks.parquet")}"`
      );
      this._chromatinGroups = rows.map((r) => String(r.cell_type));
    }
    return this._chromatinGroups;
  }

  /** Per-cell-type peak signal in a region: [{ group, start, end, signal }]. */
  async getChromatinSignal(chrom, start, end) {
    const rows = await this._query(`
      SELECT cell_type, position_start, position_end, signal_value
      FROM "${this._file("chromatin_tracks.parquet")}"
      WHERE chrom IN (${chromVariants(chrom)})
        AND position_end >= ${start} AND position_start <= ${end}
    `);
    return rows.map((r) => ({
      group: String(r.cell_type),
      start: Number(r.position_start),
      end: Number(r.position_end),
      signal: Number(r.signal_value),
    }));
  }

  /**
   * Cells and reads in peaks per cell type, for depth-normalizing the tracks.
   * Reads come from the cell metadata column nCount_<chromatin assay> (e.g.
   * nCount_ATAC_macs2), the same peak counts the tracks are built from.
   * Returns { readsColumn, groups: Map(cellType → { cells, reads }) }, or null when the
   * metadata has no such column.
   */
  getChromatinDepth() {
    if (this._chromatinDepth !== undefined) return this._chromatinDepth;
    const source = { ...this.manifest, ...this.config };
    const typeColumn = source.cellTypeColumn || source.cell_type_column || "cell_type";
    const assay = this.provenance?.chromatin_assay?.value;
    const sample = this._cellMetadata?.values().next().value;
    const readsColumn = [assay && `nCount_${assay}`, "nCount_ATAC", "nCount_peaks"].find(
      (c) => c && sample && c in sample
    );
    if (!readsColumn || !(typeColumn in sample)) {
      this._chromatinDepth = null;
      return null;
    }
    const groups = new Map();
    for (const row of this._cellMetadata.values()) {
      const type = row[typeColumn];
      const reads = Number(row[readsColumn]);
      if (type == null || !Number.isFinite(reads)) continue;
      const g = groups.get(String(type)) || { cells: 0, reads: 0 };
      g.cells += 1;
      g.reads += reads;
      groups.set(String(type), g);
    }
    this._chromatinDepth = { readsColumn, groups };
    return this._chromatinDepth;
  }

  /** Per-cell-type signal at exact peaks: [{ group, start, end, signal }]. */
  async getPeakSignals(chrom, peaks) {
    if (!peaks.length) return [];
    const starts = [...new Set(peaks.map((p) => Number(p.start)))].join(", ");
    const rows = await this._query(`
      SELECT cell_type, position_start, position_end, signal_value
      FROM "${this._file("chromatin_tracks.parquet")}"
      WHERE chrom IN (${chromVariants(chrom)}) AND position_start IN (${starts})
    `);
    return rows.map((r) => ({
      group: String(r.cell_type),
      start: Number(r.position_start),
      end: Number(r.position_end),
      signal: Number(r.signal_value),
    }));
  }

  /**
   * Whether LinkPeaks tested a gene, from link_genes_tested.parquet (gene_name, n_links),
   * which newer processor runs write. Resolves to { tested, nLinks }, or null when the
   * dataset doesn't record which genes were tested.
   */
  async getLinkTestStatus(geneName) {
    const loaded = await this._loadChromatinFile("link_genes_tested.parquet", "has_link_genes_tested");
    if (!loaded) return null;
    const rows = await this._query(`
      SELECT n_links FROM "${this._file("link_genes_tested.parquet")}"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
      LIMIT 1
    `);
    return rows.length
      ? { tested: true, nLinks: toNumberOrNull(rows[0].n_links) }
      : { tested: false, nLinks: null };
  }

  /** All links for a gene, with every column the file has. */
  async getLinksForGene(geneName) {
    const rows = await this._query(`
      SELECT * FROM "${this._file("linked_peaks.parquet")}"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
    `);
    return rows.map(toLink);
  }

  /**
   * Links whose peak overlaps a position or range, for every gene (one peak can link to
   * several genes). Searches the whole links file, which is already in memory.
   */
  async getLinksAtPosition(chrom, start, end = start) {
    const rows = await this._query(`
      SELECT * FROM "${this._file("linked_peaks.parquet")}"
      WHERE peak_chrom IN (${chromVariants(chrom)})
        AND peak_start <= ${Math.round(end)} AND peak_end >= ${Math.round(start)}
      ORDER BY peak_start, ABS(correlation) DESC
    `);
    return rows.map(toLink);
  }

  async _query(sql) {
    const result = await this.conn.query(sql);
    return result.toArray().map((row) => row.toJSON());
  }
}

// A linked_peaks.parquet row as the views use it; `row` keeps every column for export
function toLink(r) {
  return {
    gene: String(r.gene_name),
    chrom: String(r.peak_chrom),
    start: Number(r.peak_start),
    end: Number(r.peak_end),
    correlation: toNumberOrNull(r.correlation),
    zscore: toNumberOrNull(r.zscore),
    pValue: toNumberOrNull(r.p_value),
    linkType: r.link_type == null ? null : String(r.link_type),
    distance: toNumberOrNull(r.distance_to_tss),
    topCellType: r.top_cell_type == null ? null : String(r.top_cell_type),
    topCellTypeSignal: toNumberOrNull(r.top_cell_type_signal),
    row: r,
  };
}

function toNumberOrNull(value) {
  return value == null ? null : Number(value);
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Peaks are named "chr1-..." but annotations may use "1"; match either
function chromVariants(chrom) {
  const bare = String(chrom).replace(/^chr/i, "");
  return [bare, `chr${bare}`].map(sqlString).join(", ");
}

function toGeneModel(row) {
  const starts = String(row.exon_starts || "").split(",").filter(Boolean).map(Number);
  const ends = String(row.exon_ends || "").split(",").filter(Boolean).map(Number);
  return {
    name: row.gene_name,
    chrom: String(row.chrom),
    start: Number(row.start),
    end: Number(row.end),
    strand: row.strand,
    exons: starts.map((s, i) => [s, ends[i]]).filter(([, e]) => Number.isFinite(e)),
  };
}
