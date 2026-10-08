import * as duckdb from "@duckdb/duckdb-wasm";

export class UMAPGeneViewer {
  constructor(basePath = "/data", config = {}) {
    this.basePath = basePath;
    this.config = config;
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

  /** Build list of reduction parquet files from config embeddings or defaults. */
  _getReductionFiles() {
    const embeddings = this.config?.embeddings;

    if (embeddings && embeddings.length > 0) {
      return embeddings.map((emb) => ({
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

  async getReductionData(reductionType = "umap") {
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
}
