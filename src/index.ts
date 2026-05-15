import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import bytes from "bytes";
import glob from "fast-glob";
import pc from "picocolors";
import { type MinifyOptions, minify } from "terser";

/**
 * Output type
 */
export type OutputType = "minify" | "gzip" | "brotli";

/**
 * Bundle group
 */
export interface BundleGroup {
  /**
   * Group name
   */
  name: string;
  /**
   * Glob patterns to include
   */
  include: string | string[];
  /**
   * Glob patterns to exclude
   */
  exclude?: string | string[];
  /**
   * Whether to minify
   */
  minify?: boolean | MinifyOptions;
}

/**
 * Bundle size options
 */
export interface BundleSizeOptions {
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
   * Default minification settings for groups
   */
  minify?: boolean | MinifyOptions;
}

/**
 * File size result
 */
interface FileSizeResult {
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
interface GroupResult {
  /**
   * Group name
   */
  name: string;
  /**
   * File size results
   */
  files: FileSizeResult[];
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

  const defaultTerserOptions: MinifyOptions = {
    toplevel: true,
    compress: { passes: 2, ecma: 2020 },
    mangle: { module: true },
    module: true,
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

  const getMinifyOptions = (minify: boolean | MinifyOptions | undefined, undefinedValue: boolean | MinifyOptions) => {
    if (typeof minify === "undefined") {
      return undefinedValue === true ? defaultTerserOptions : undefinedValue;
    }

    if (typeof minify === "object") {
      return minify;
    }

    return defaultTerserOptions;
  };

  // Default minification options
  const defaultMinifyOptions = getMinifyOptions(options.minify, true);

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

      // Minifiy if requested
      const terserOptions = getMinifyOptions(group.minify, defaultMinifyOptions);

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

      const baseFileForCompressed = terserOptions ? minFile : file;

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
 * Print the bundle size results to the console.
 * @param results
 */
function printResults(results: GroupResult[]) {
  const divider = pc.bold(
    pc.cyan("===================================================================================="),
  );
  console.log(`\n${divider}`);
  console.log(pc.bold(pc.cyan(" Bundle sizes (bytes):")));
  console.log(`${divider}\n`);

  for (const group of results) {
    console.log(pc.bold(pc.yellow(` ${group.name}:`)));

    // Sort files by size descending
    const sortedFiles = [...group.files].sort((a, b) => b.size - a.size);

    for (const file of sortedFiles) {
      const fileName = path.basename(file.file);
      let line = `  ${pc.white(fileName.padEnd(30))} ${pc.green(formatSize(file.size).padStart(10))}`;

      if (file.minified !== undefined) {
        line += ` ${pc.dim("min:")} ${pc.blue(formatSize(file.minified).padStart(8))}`;
      }

      if (file.gzip !== undefined) {
        line += ` ${pc.dim("gz:")} ${pc.magenta(formatSize(file.gzip).padStart(8))}`;
      }

      if (file.brotli !== undefined) {
        line += ` ${pc.dim("br:")} ${pc.cyan(formatSize(file.brotli).padStart(8))}`;
      }

      console.log(line);
    }
    console.log("");
  }

  console.log(`${divider}\n`);
}

/**
 * Format file size.
 * @param size
 * @returns
 */
function formatSize(size: number): string {
  return bytes(size, { decimalPlaces: 2 }) || "0 B";
}
