import { execSync } from "node:child_process";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import type { TransformOptions as EsbuildOptions } from "esbuild";
import glob from "fast-glob";
import pc from "picocolors";
import { minify, type MinifyOptions as TerserOptions } from "terser";

export type { TransformOptions as EsbuildOptions } from "esbuild";
export type { MinifyOptions as TerserOptions } from "terser";

/**
 * Supported minifier engines
 */
export type MinifierType = "terser" | "esbuild";

/**
 * Output type
 */
export type OutputType = "minify" | "gzip" | "brotli";

/**
 * Bundle group
 */
export interface BundleGroup<TMinifier extends MinifierType = MinifierType> {
  /**
   * Group name
   */
  name?: string;
  /**
   * Glob patterns to include
   */
  include: string | string[];
  /**
   * Glob patterns to exclude
   */
  exclude?: string | string[];
  /**
   * Minifier engine to use for this group (overrides top-level minifier)
   */
  minifier?: TMinifier;
  /**
   * Whether to minify, or minifier-specific options
   */
  minify?: boolean | (TMinifier extends "esbuild" ? EsbuildOptions : TerserOptions);
}

/**
 * Base bundle size options
 */
export interface BaseBundleSizeOptions {
  /**
   * Groups of files to process
   */
  groups: BundleGroup[];
  /**
   * Compression formats to report
   */
  compression?: ("gzip" | "brotli")[];
  /**
   * Which files to keep on disk
   */
  save?: boolean | OutputType[];
  /**
   * Which files to remove after reporting
   */
  cleanup?: boolean | OutputType[];
  /**
   * Output bundle sizes to a JSON file.
   * Supports placeholder tokens: @git~SHA, @git~TAG, @git~BRANCH, @date, @time, @epoch.
   */
  json?: boolean | string;
}

/**
 * Terser bundle size options
 */
export interface TerserBundleSizeOptions extends BaseBundleSizeOptions {
  /**
   * Default minifier engine to use for groups (defaults to 'terser')
   */
  minifier?: "terser";
  /**
   * Default Terser minification settings for groups
   */
  minify?: boolean | TerserOptions;
}

/**
 * esbuild bundle size options
 */
export interface EsbuildBundleSizeOptions extends BaseBundleSizeOptions {
  /**
   * Default minifier engine to use for groups
   */
  minifier: "esbuild";
  /**
   * Default esbuild transform settings for groups
   */
  minify?: boolean | EsbuildOptions;
}

/**
 * Bundle size options
 */
export type BundleSizeOptions = TerserBundleSizeOptions | EsbuildBundleSizeOptions;

/**
 * Helper to define bundle size configuration with full TypeScript type inference and autocomplete.
 *
 * @param config Bundle size options
 * @returns The configuration object
 */
export function defineConfig<T extends BundleSizeOptions>(config: T): T {
  return config;
}

/**
 * Bundle size JSON output item
 */
export interface BundleSizeJsonItem {
  /**
   * File path
   */
  file: string;
  /**
   * Group name
   */
  group?: string;
  /**
   * Original size in bytes
   */
  size: number;
  /**
   * Minified size in bytes
   */
  minified?: number;
  /**
   * Gzipped size in bytes
   */
  gzip?: number;
  /**
   * Brotli size in bytes
   */
  brotli?: number;
}

/**
 * File size result
 */
export interface FileSizeResult {
  /**
   * File path
   */
  file: string;
  /**
   * Original size
   */
  size: number;
  /**
   * Minified size
   */
  minified?: number;
  /**
   * Gzipped size
   */
  gzip?: number;
  /**
   * Brotli size
   */
  brotli?: number;
}

/**
 * Group result
 */
export interface GroupResult {
  /**
   * Group name
   */
  name?: string;
  /**
   * File size results
   */
  files: FileSizeResult[];
}

let esbuildTransform: typeof import("esbuild").transform | null = null;

async function getEsbuildTransform() {
  if (!esbuildTransform) {
    try {
      const esbuild = await import("esbuild");
      esbuildTransform = esbuild.transform;
    } catch {
      throw new Error(
        "esbuild is not installed. To use the esbuild minifier, please install esbuild:\n  npm install -D esbuild",
      );
    }
  }
  return esbuildTransform;
}

/**
 * Calculates bundle sizes.
 *
 * @param options Bundle size options
 * @returns Promise that resolves to the group results
 */
export async function calculateBundleSizes(options: BundleSizeOptions): Promise<GroupResult[]> {
  const { groups, compression = ["gzip", "brotli"] } = options;
  const results: GroupResult[] = [];

  const defaultTerserOptions: TerserOptions = {
    ecma: 2020,
    module: true,
    toplevel: true,
    compress: {
      passes: 2,
    },
    mangle: true,
    format: {
      comments: false,
    },
  };

  const defaultEsbuildOptions: EsbuildOptions = {
    minify: true,
    target: "es2020",
    treeShaking: true,
    legalComments: "none",
  };

  const isOutputRequested = (option: boolean | OutputType[] | undefined, type: OutputType) => {
    if (typeof option === "boolean") return option;
    if (Array.isArray(option)) return option.includes(type);
    return false;
  };

  const shouldSave = (type: OutputType) => isOutputRequested(options.save, type);
  const shouldCleanup = (type: OutputType) => isOutputRequested(options.cleanup, type);

  const safeUnlink = async (path: string) => {
    try {
      await unlink(path);
    } catch {
      // Ignore errors if file doesn't exist
    }
  };

  const resolveMinifyOptions = <T>(
    groupMinify: boolean | T | undefined,
    globalMinify: boolean | T | undefined,
    defaultOptions: T,
  ): T | false => {
    if (groupMinify === false) return false;
    if (typeof groupMinify === "object" && groupMinify !== null) {
      return { ...defaultOptions, ...groupMinify };
    }
    if (groupMinify === true || typeof groupMinify === "undefined") {
      if (globalMinify === false) return false;
      if (typeof globalMinify === "object" && globalMinify !== null) {
        return { ...defaultOptions, ...globalMinify };
      }
      return defaultOptions;
    }
    return defaultOptions;
  };

  // Process each group
  for (const group of groups) {
    const groupResult: GroupResult = { name: group.name, files: [] };
    const files = await glob(group.include, {
      ignore: group.exclude ? (Array.isArray(group.exclude) ? group.exclude : [group.exclude]) : [],
    });

    for (const file of files) {
      // Ignore already minified files
      if (file.includes(".min.js")) {
        continue;
      }
      const minFile = file.replace(/\.js$/, ".min.js");

      // Read the contents and size
      const content = await readFile(file);
      const originalSize = (await stat(file)).size;
      const fileResult: FileSizeResult = { file, size: originalSize };

      let currentContent = content;

      // Minify if requested
      const groupMinifier: MinifierType = group.minifier || options.minifier || "terser";

      if (groupMinifier === "esbuild") {
        const esbuildOptions = resolveMinifyOptions(
          group.minify as EsbuildOptions | boolean | undefined,
          options.minifier === "esbuild" ? (options.minify as EsbuildOptions | boolean | undefined) : undefined,
          defaultEsbuildOptions,
        );

        if (esbuildOptions) {
          const transform = await getEsbuildTransform();
          const minified = await transform(content.toString(), esbuildOptions);
          if (minified.code) {
            currentContent = Buffer.from(minified.code.trimEnd());
            fileResult.minified = currentContent.length;

            if (shouldSave("minify")) {
              await writeFile(minFile, currentContent);
            }
          }
        }
      } else {
        const terserOptions = resolveMinifyOptions(
          group.minify as TerserOptions | boolean | undefined,
          options.minifier !== "esbuild" ? (options.minify as TerserOptions | boolean | undefined) : undefined,
          defaultTerserOptions,
        );

        if (terserOptions) {
          const minified = await minify(content.toString(), terserOptions);
          if (minified.code) {
            currentContent = Buffer.from(minified.code);
            fileResult.minified = currentContent.length;

            if (shouldSave("minify")) {
              await writeFile(minFile, currentContent);
            }
          }
        }
      }

      const baseFileForCompressed = fileResult.minified !== undefined ? minFile : file;

      // Compression
      if (compression.includes("gzip")) {
        const gzipped = gzipSync(currentContent);
        fileResult.gzip = gzipped.length;
        if (shouldSave("gzip")) {
          await writeFile(`${baseFileForCompressed}.gz`, gzipped);
        }
      }

      if (compression.includes("brotli")) {
        const brotlied = brotliCompressSync(currentContent);
        fileResult.brotli = brotlied.length;
        if (shouldSave("brotli")) {
          await writeFile(`${baseFileForCompressed}.br`, brotlied);
        }
      }

      groupResult.files.push(fileResult);
    }

    results.push(groupResult);
  }

  // Print results
  printResults(results);

  // Write JSON output if requested
  if (options.json) {
    const rawPattern = typeof options.json === "string" ? options.json : "bundle-size.json";
    const resolvedFileName = resolveJsonPath(rawPattern);
    const targetPath = path.resolve(process.cwd(), resolvedFileName);

    const isSingleUnnamedGroup = results.length === 1 && !results[0].name;
    const jsonItems: BundleSizeJsonItem[] = [];
    for (const group of results) {
      for (const file of group.files) {
        const item: BundleSizeJsonItem = {
          file: file.file,
          ...(!isSingleUnnamedGroup && group.name ? { group: group.name } : {}),
          size: file.size,
        };
        if (file.minified !== undefined) {
          item.minified = file.minified;
        }
        if (file.gzip !== undefined) {
          item.gzip = file.gzip;
        }
        if (file.brotli !== undefined) {
          item.brotli = file.brotli;
        }
        jsonItems.push(item);
      }
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(jsonItems, null, 2)}\n`, "utf-8");
    console.log(pc.green(`✔ Saved bundle sizes to ${resolvedFileName}\n`));
  }

  // Cleanup
  for (const group of results) {
    for (const file of group.files) {
      const minFile = file.file.replace(/\.js$/, ".min.js");
      const baseFileForCompressed = file.minified !== undefined ? minFile : file.file;

      if (shouldCleanup("minify") && file.minified !== undefined) {
        await safeUnlink(minFile);
      }
      if (shouldCleanup("gzip") && file.gzip !== undefined) {
        await safeUnlink(`${baseFileForCompressed}.gz`);
      }
      if (shouldCleanup("brotli") && file.brotli !== undefined) {
        await safeUnlink(`${baseFileForCompressed}.br`);
      }
    }
  }

  return results;
}

/**
 * Retrieves git information for pattern replacement.
 */
function getGitInfo(): { sha: string; tag: string; branch: string } {
  const runGit = (cmd: string): string | null => {
    try {
      return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf-8" }).trim();
    } catch {
      return null;
    }
  };

  const sha = runGit("rev-parse --short HEAD") || "unknown";
  const tag = runGit("describe --tags --exact-match") || "untagged";
  const rawBranch = runGit("rev-parse --abbrev-ref HEAD") || "unknown";
  const branch = rawBranch.replace(/\//g, "-");

  return { sha, tag, branch };
}

/**
 * Resolves a JSON output path pattern with special placeholder tokens.
 *
 * Supported tokens:
 * - \@git~SHA: Current git commit hash (short)
 * - \@git~TAG: Current git tag (or "untagged")
 * - \@git~BRANCH: Current git branch (with slashes replaced by dashes)
 * - \@date: Current date (YYYY-MM-DD)
 * - \@time: Current time (HH-MM-SS)
 * - \@epoch: Current timestamp in seconds
 *
 * @param pattern Output file path or pattern
 * @returns Resolved file path
 */
export function resolveJsonPath(pattern: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const epochStr = Math.floor(now.getTime() / 1000).toString();

  let result = pattern
    .replace(/@date/gi, dateStr)
    .replace(/@time/gi, timeStr)
    .replace(/@epoch/gi, epochStr);

  if (/@git~/i.test(result)) {
    const git = getGitInfo();
    result = result
      .replace(/@git~SHA/gi, git.sha)
      .replace(/@git~TAG/gi, git.tag)
      .replace(/@git~BRANCH/gi, git.branch);
  }

  if (!result.toLowerCase().endsWith(".json")) {
    result += ".json";
  }

  return result;
}

/**
 * Print the bundle size results to the console.
 * @param results
 */
export function printResults(results: GroupResult[]) {
  const allFiles = results.flatMap((group) => group.files);
  const hasMinified = results.some((group) => group.files.some((f) => f.minified !== undefined));
  const hasGzip = results.some((group) => group.files.some((f) => f.gzip !== undefined));
  const hasBrotli = results.some((group) => group.files.some((f) => f.brotli !== undefined));
  const isSingleUnnamedGroup = results.length === 1 && !results[0].name;

  // Calculate dynamic column widths based on uncolored text lengths
  let maxFileLen = "File".length;
  for (const group of results) {
    if (group.files.length === 0) continue;
    if (group.name && !isSingleUnnamedGroup) {
      maxFileLen = Math.max(maxFileLen, `**${group.name}**`.length);
    }
    for (const file of group.files) {
      const fileName = path.basename(file.file);
      const fileLabel = isSingleUnnamedGroup ? fileName : `  ${fileName}`;
      maxFileLen = Math.max(maxFileLen, fileLabel.length);
    }
  }

  let maxSizeLen = "Full Size".length;
  for (const file of allFiles) {
    maxSizeLen = Math.max(maxSizeLen, formatSize(file.size).length);
  }

  let maxMinLen = "Minified".length;
  if (hasMinified) {
    for (const file of allFiles) {
      if (file.minified !== undefined) {
        maxMinLen = Math.max(maxMinLen, formatSize(file.minified).length);
      }
    }
  }

  let maxGzipLen = "Gzip".length;
  if (hasGzip) {
    for (const file of allFiles) {
      if (file.gzip !== undefined) {
        maxGzipLen = Math.max(maxGzipLen, formatSize(file.gzip).length);
      }
    }
  }

  let maxBrotliLen = "Brotli".length;
  if (hasBrotli) {
    for (const file of allFiles) {
      if (file.brotli !== undefined) {
        maxBrotliLen = Math.max(maxBrotliLen, formatSize(file.brotli).length);
      }
    }
  }

  interface TableColumn {
    key: "file" | "size" | "minified" | "gzip" | "brotli";
    label: string;
    align: "left" | "right";
    width: number;
    headerColor: (text: string) => string;
    cellColor: (text: string) => string;
  }

  const columns: TableColumn[] = [
    {
      key: "file",
      label: "File",
      align: "left",
      width: maxFileLen,
      headerColor: (t) => pc.bold(pc.white(t)),
      cellColor: (t) => pc.white(t),
    },
    {
      key: "size",
      label: "Full Size",
      align: "right",
      width: maxSizeLen,
      headerColor: (t) => pc.bold(pc.green(t)),
      cellColor: (t) => pc.green(t),
    },
  ];

  if (hasMinified) {
    columns.push({
      key: "minified",
      label: "Minified",
      align: "right",
      width: maxMinLen,
      headerColor: (t) => pc.bold(pc.blue(t)),
      cellColor: (t) => pc.blue(t),
    });
  }

  if (hasGzip) {
    columns.push({
      key: "gzip",
      label: "Gzip",
      align: "right",
      width: maxGzipLen,
      headerColor: (t) => pc.bold(pc.magenta(t)),
      cellColor: (t) => pc.magenta(t),
    });
  }

  if (hasBrotli) {
    columns.push({
      key: "brotli",
      label: "Brotli",
      align: "right",
      width: maxBrotliLen,
      headerColor: (t) => pc.bold(pc.cyan(t)),
      cellColor: (t) => pc.cyan(t),
    });
  }

  const renderRow = (
    cells: { text: string; align: "left" | "right"; width: number; color?: (t: string) => string }[],
  ) => {
    const parts = cells.map((cell) => {
      const padded = cell.align === "left" ? cell.text.padEnd(cell.width) : cell.text.padStart(cell.width);
      return cell.color ? cell.color(padded) : padded;
    });
    return `${pc.dim("|")} ${parts.join(` ${pc.dim("|")} `)} ${pc.dim("|")}`;
  };

  const rawTableWidth = 1 + columns.reduce((acc, col) => acc + col.width + 3, 0);
  const divider = pc.bold(pc.cyan("=".repeat(rawTableWidth)));

  console.log(`\n${divider}`);
  console.log(pc.bold(pc.cyan("Bundle Size Report")));
  console.log(divider);

  if (allFiles.length === 0) {
    console.log(pc.yellow("No bundle files found."));
    console.log(`\n${divider}\n`);
    return;
  }

  // Header row
  const headerLine = renderRow(
    columns.map((col) => ({
      text: col.label,
      align: col.align,
      width: col.width,
      color: col.headerColor,
    })),
  );
  console.log(headerLine);

  // Separator row
  const separatorLine = renderRow(
    columns.map((col) => ({
      text: col.align === "left" ? `:${"-".repeat(col.width - 1)}` : `${"-".repeat(col.width - 1)}:`,
      align: col.align,
      width: col.width,
      color: (t) => pc.dim(t),
    })),
  );
  console.log(separatorLine);

  // Groups and files
  for (const group of results) {
    if (group.files.length === 0) continue;

    // Group header row (omitted if single unnamed group or no name)
    if (group.name && !isSingleUnnamedGroup) {
      const groupCells = columns.map((col, idx) => {
        if (idx === 0) {
          return {
            text: `**${group.name}**`,
            align: col.align,
            width: col.width,
            color: (t: string) => pc.bold(pc.yellow(t)),
          };
        }
        return {
          text: "",
          align: col.align,
          width: col.width,
        };
      });
      console.log(renderRow(groupCells));
    }

    // Sort files by size descending
    const sortedFiles = [...group.files].sort((a, b) => b.size - a.size);

    for (const file of sortedFiles) {
      const fileName = path.basename(file.file);
      const fileLabel = isSingleUnnamedGroup ? fileName : `  ${fileName}`;
      const fileCells = columns.map((col) => {
        switch (col.key) {
          case "file":
            return {
              text: fileLabel,
              align: col.align,
              width: col.width,
              color: col.cellColor,
            };
          case "size":
            return {
              text: formatSize(file.size),
              align: col.align,
              width: col.width,
              color: col.cellColor,
            };
          case "minified":
            return {
              text: file.minified !== undefined ? formatSize(file.minified) : "-",
              align: col.align,
              width: col.width,
              color: file.minified !== undefined ? col.cellColor : (t: string) => pc.dim(t),
            };
          case "gzip":
            return {
              text: file.gzip !== undefined ? formatSize(file.gzip) : "-",
              align: col.align,
              width: col.width,
              color: file.gzip !== undefined ? col.cellColor : (t: string) => pc.dim(t),
            };
          case "brotli":
            return {
              text: file.brotli !== undefined ? formatSize(file.brotli) : "-",
              align: col.align,
              width: col.width,
              color: file.brotli !== undefined ? col.cellColor : (t: string) => pc.dim(t),
            };
        }
      });
      console.log(renderRow(fileCells));
    }
  }

  console.log(`${divider}\n`);
}

/**
 * Format file size.
 * @param size
 * @returns
 */
function formatSize(size: number): string {
  if (!size) return "0 B";
  const MB = 1024 * 1024;
  if (size >= MB) {
    return `${(size / MB).toFixed(2)} MB`;
  } else if (size >= 1024) {
    return `${(size / 1024).toFixed(2)} KB`;
  }
  return `${size} B`;
}
