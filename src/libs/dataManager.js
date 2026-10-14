import * as duckdb from "@duckdb/duckdb-wasm";

export class UMAPGeneViewer {
  constructor(basePath = "/data", config = {}) {
    this.basePath = basePath;
    this.config = config;
    this.manifest = null;
    this.db = null;
    this.conn = null;
    this.reductions = new Map(); // key → merged data array
    this.geneCache = new Map();
    this.loadedChunks = new Set();
  }

  // Backward-compat accessors
  get umapData() {
    return this.reductions.get("umap") || null;
  }

  _buildUrl(filename) {
    const qIndex = this.basePath.indexOf('?');
    if (qIndex === -1) return `${this.basePath}/${filename}`;
    const base = this.basePath.substring(0, qIndex);
    const qs = this.basePath.substring(qIndex);
    return `${base}/${filename}${qs}`;
  }

  async initialize() {
    try {
      // Get DuckDB bundles
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      // Create worker
      const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], {
          type: "text/javascript",
        })
      );

      const worker = new Worker(worker_url);
      const logger = new duckdb.VoidLogger();

      // Initialize database
      this.db = new duckdb.AsyncDuckDB(logger, worker);
      await this.db.instantiate(bundle.mainModule);
      this.conn = await this.db.connect();

      // Load essential data
      await this.loadEssentialData();
    } catch (error) {
      console.error("Failed to initialize data manager:", error);
      throw new Error(`Initialization failed: ${error.message}`);
    }
  }

  async loadEssentialData() {
    // Without embeddings from config, read them from the dataset's manifest
    if (!this.config?.embeddings?.length) {
      await this._loadManifest();
    }

    // Build the list of reduction files from config or defaults
    const reductionFiles = this._getReductionFiles();

    const filesToLoad = [
      ...reductionFiles,
      {
        name: "gene_locations.parquet",
        path: this._buildUrl("gene_locations.parquet"),
        required: true,
      },
      {
        name: "gene_stats.parquet",
        path: this._buildUrl("gene_stats.parquet"),
        required: true,
      },
      {
        name: "cells.parquet",
        path: this._buildUrl("cells.parquet"),
        required: true,
      },
      {
        name: "metadata.parquet",
        path: this._buildUrl("metadata.parquet"),
        required: false,
      },
      {
        name: "genes.parquet",
        path: this._buildUrl("genes.parquet"),
        required: true,
      },
    ];

    for (const file of filesToLoad) {
      try {
        const response = await fetch(file.path);

        if (!response.ok) {
          if (file.required) {
            throw new Error(
              `Failed to load required file: ${file.name} (${response.status} ${response.statusText})`
            );
          } else {
            console.log(
              `Optional file ${file.name} not available, skipping...`
            );
            continue;
          }
        }

        const arrayBuffer = await response.arrayBuffer();
        await this.db.registerFileBuffer(
          file.name,
          new Uint8Array(arrayBuffer)
        );
      } catch (error) {
        if (file.required) {
          throw error;
        }
        console.log(`Optional file ${file.name} not available:`, error.message);
      }
    }

    // Load cell metadata first
    let cellMetadata = new Map();
    try {
      // Try metadata.parquet first
      try {
        const metaResult = await this.conn.query(
          'SELECT * FROM "metadata.parquet"'
        );
        const metaArray = metaResult.toArray().map((row) => row.toJSON());

        metaArray.forEach((row) => {
          cellMetadata.set(row.cell_id, row);
        });
      } catch (e) {
        // Fall back to cells.parquet
        console.log("metadata.parquet not found, trying cells.parquet...");
        const cellsResult = await this.conn.query(
          'SELECT * FROM "cells.parquet"'
        );
        const cellsArray = cellsResult.toArray().map((row) => row.toJSON());

        cellsArray.forEach((row) => {
          cellMetadata.set(row.cell_id, row);
        });
      }
    } catch (error) {
      console.warn("Could not load cell metadata:", error);
    }

    // Merge each reduction with metadata and store in reductions Map
    for (const rf of reductionFiles) {
      try {
        const result = await this.conn.query(`SELECT * FROM "${rf.name}"`);
        const rows = result.toArray().map((row) => row.toJSON());
        const merged = rows.map((row) => {
          const metadata = cellMetadata.get(row.cell_id) || {};
          return { ...row, ...metadata };
        });
        this.reductions.set(rf.reductionKey, merged);
      } catch (err) {
        if (rf.required) throw err;
        console.log(`Reduction ${rf.reductionKey} not available`);
      }
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
    const preferred =
      this.config?.default_embedding || this.manifest?.default_embedding;
    if (preferred && this.reductions.has(preferred)) return preferred;
    if (this.reductions.has("umap")) return "umap";
    return this.reductions.keys().next().value ?? null;
  }

  async getReductionData(reductionType = this.defaultReduction) {
    const data = this.reductions.get(reductionType);
    if (!data) {
      throw new Error(`Reduction "${reductionType}" not available`);
    }
    return data;
  }

  /** Get all available reduction keys. */
  getAvailableReductions() {
    return Array.from(this.reductions.keys());
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
    return this.reductions.has(key);
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
        DESCRIBE "gene_stats.parquet"
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
        FROM "gene_stats.parquet"
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
                SELECT * FROM "metadata.parquet" WHERE cell_id = '${cellId}'
            `);
        const rows = result.toArray();
        if (rows.length > 0) {
          return rows[0].toJSON();
        }
      } catch (e) {
        const result = await this.conn.query(`
                SELECT * FROM "cells.parquet" WHERE cell_id = '${cellId}'
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
        FROM "genes.parquet"
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
        FROM "gene_locations.parquet"
        WHERE gene_name = '${geneName}'
      `);

      const locationArray = locationResult.toArray();
      if (locationArray.length === 0) {
        throw new Error(`Gene ${geneName} not found in dataset`);
      }

      const locationData = locationArray[0].toJSON();
      const location = locationData.location;
      const isPrecomputed = locationData.is_precomputed;

      const startTime = performance.now();

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

        await this.db.registerFileBuffer(tempFileName, new Uint8Array(buffer));

        const result = await this.conn.query(`
          SELECT cell_id, expression FROM "${tempFileName}"
        `);

        geneData = result.toArray().map((row) => row.toJSON());
      } else {
        // Load chunk file
        const chunkFileName = location.split("/").pop();

        // Check if chunk already loaded
        if (!this.loadedChunks.has(chunkFileName)) {
          const response = await fetch(this._buildUrl(location));
          if (!response.ok) {
            throw new Error(
              `Failed to load chunk file: ${response.statusText}`
            );
          }

          const buffer = await response.arrayBuffer();
          await this.db.registerFileBuffer(
            chunkFileName,
            new Uint8Array(buffer)
          );

          this.loadedChunks.add(chunkFileName);
        }

        const result = await this.conn.query(`
          SELECT cell_id, expression
          FROM "${chunkFileName}"
          WHERE gene_id = ${geneId}
        `);

        geneData = result.toArray().map((row) => row.toJSON());
      }

      const loadTime = performance.now() - startTime;

      // Cache it
      this.geneCache.set(geneName, geneData);
      return geneData;
    } catch (error) {
      console.error(`Failed to load gene ${geneName}:`, error);
      throw error;
    }
  }

  getCellCount() {
    return this.umapData ? this.umapData.length : 0;
  }

  clearCache() {
    this.geneCache.clear();
  }

  // ---- Chromatin (multiome only) ----
  // Files are fetched on first use, so RNA-only datasets never pay for them.

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
      this._chromatinFiles.set(
        name,
        listed === false ? Promise.resolve(false) : this._registerOptional(name)
      );
    }
    return this._chromatinFiles.get(name);
  }

  async _registerOptional(name) {
    try {
      const response = await fetch(this._buildUrl(name));
      if (!response.ok) return false;
      const buffer = await response.arrayBuffer();
      await this.db.registerFileBuffer(name, new Uint8Array(buffer));
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
      FROM "gene_coordinates.parquet"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
      LIMIT 1
    `);
    return rows.length ? toGeneModel(rows[0]) : null;
  }

  /** All annotated genes overlapping a region, for the gene model row. */
  async getGenesInRegion(chrom, start, end) {
    const rows = await this._query(`
      SELECT gene_name, chrom, start, "end", strand, exon_starts, exon_ends
      FROM "gene_coordinates.parquet"
      WHERE chrom IN (${chromVariants(chrom)}) AND "end" >= ${start} AND start <= ${end}
    `);
    return rows.map(toGeneModel);
  }

  /** Groups that have a track (cell types), cached. */
  async getChromatinGroups() {
    if (!this._chromatinGroups) {
      const rows = await this._query(
        `SELECT DISTINCT cell_type FROM "chromatin_tracks.parquet"`
      );
      this._chromatinGroups = rows.map((r) => String(r.cell_type));
    }
    return this._chromatinGroups;
  }

  /** Per-cell-type peak signal in a region: [{ group, start, end, signal }]. */
  async getChromatinSignal(chrom, start, end) {
    const rows = await this._query(`
      SELECT cell_type, position_start, position_end, signal_value
      FROM "chromatin_tracks.parquet"
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

  /** Peaks linked to a gene: [{ start, end, correlation }]. */
  async getLinkedPeaks(geneName) {
    const rows = await this._query(`
      SELECT peak_start, peak_end, correlation
      FROM "linked_peaks.parquet"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
    `);
    return rows.map((r) => ({
      start: Number(r.peak_start),
      end: Number(r.peak_end),
      correlation: r.correlation == null ? null : Number(r.correlation),
    }));
  }

  /** All links for a gene, with every column the file has. */
  async getLinksForGene(geneName) {
    const rows = await this._query(`
      SELECT * FROM "linked_peaks.parquet"
      WHERE UPPER(gene_name) = UPPER(${sqlString(geneName)})
    `);
    return rows.map((r) => ({
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
    }));
  }

  async _query(sql) {
    const result = await this.conn.query(sql);
    return result.toArray().map((row) => row.toJSON());
  }
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
