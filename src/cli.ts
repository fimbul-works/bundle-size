#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pc from "picocolors";
import { type BundleSizeOptions, calculateBundleSizes } from "./index.js";

/**
 * Loads a configuration file from a specific path
 */
async function loadConfigFile(fullPath: string) {
  if (fullPath.endsWith(".json")) {
    const content = await readFile(fullPath, "utf-8");
    return JSON.parse(content);
  }

  const module = await import(pathToFileURL(fullPath).href);
  return module.default || module;
}

/**
 * Searches for a configuration file in the current directory
 */
async function findConfig() {
  const names = [
    "bundle-size.config.ts",
    "bundle-size.config.js",
    "bundle-size.config.mjs",
    "bundle-size.config.cjs",
    "bundle-size.config.json",
  ];

  for (const name of names) {
    const fullPath = path.join(process.cwd(), name);
    try {
      await access(fullPath);
      return await loadConfigFile(fullPath);
    } catch {}
  }
  return null;
}

async function run() {
  const args = process.argv.slice(2);
  const customConfigPath = args[0];

  let config: BundleSizeOptions;

  if (customConfigPath) {
    const fullPath = path.resolve(process.cwd(), customConfigPath);
    try {
      await access(fullPath);
      config = await loadConfigFile(fullPath);
    } catch (error) {
      console.error(pc.red(`Error: Could not load configuration from "${customConfigPath}"`));
      if (error instanceof Error) {
        console.error(pc.dim(error.message));
      }
      process.exit(1);
    }
  } else {
    config = await findConfig();
  }

  if (!config) {
    console.error(
      pc.red("Error: No configuration found. Create a bundle-size.config.ts/js/json or provide a path as an argument."),
    );
    process.exit(1);
  }

  try {
    await calculateBundleSizes(config);
  } catch (error) {
    console.error(pc.red("Error calculating bundle sizes:"));
    console.error(error);
    process.exit(1);
  }
}

run();
