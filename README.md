# @fimbul-works/bundle-size

[![npm version](https://badge.fury.io/js/%40fimbul-works%2Fbundle-size.svg)](https://www.npmjs.com/package/@fimbul-works/bundle-size)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg?v=101)](https://github.com/microsoft/TypeScript)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/%40fimbul-works%2Fbundle-size)](https://bundlephobia.com/package/@fimbul-works/bundle-size)

A minimalistic library and CLI utility for calculating, comparing, and reporting bundle sizes with minification and compression support.

## Features

- **Minification**: Powered by [Terser](https://terser.org/) or [esbuild](https://esbuild.github.io/).
- **Compression**: In-memory Gzip and Brotli measurement.
- **Beautiful Output**: Formatted Markdown-style table output with dynamic column alignment and terminal colors.
- **Grouped Reports**: Organize files into logical groups (e.g. Bundles, Plugins, Utilities).
- **JSON Export**: Export size metrics with tokenized filenames (`@git~SHA`, `@git~TAG`, `@git~BRANCH`, `@date`, `@time`, `@epoch`).
- **Zero Config Required**: Works out of the box with sensible defaults.

## Installation

```bash
pnpm add -D @fimbul-works/bundle-size

# Run via npx / pnpx
npx @fimbul-works/bundle-size
```

## CLI Usage

```bash
# Run with auto-detected configuration
bundle-size

# Use a specific configuration file
bundle-size custom.config.json
bundle-size -c path/to/config.ts

# Switch minifier on the fly
bundle-size --esbuild
bundle-size --minifier terser

# Export to JSON
bundle-size --json
bundle-size --json "bundle-size-@git~TAG-@date.json"
```

### CLI Options

| Flag | Description |
| :--- | :--- |
| `-c, --config <file>` | Path to configuration file (`.ts`, `.js`, `.mjs`, `.cjs`, `.json`). |
| `-j, --json [file]` | Export size metrics to a JSON file (supports tokens). |
| `-m, --minifier <terser\|esbuild>` | Select minification engine. |
| `--esbuild` | Shortcut for `--minifier esbuild`. |
| `--terser` | Shortcut for `--minifier terser`. |

## Example Output

```
===========================================================================
Bundle Size Report
===========================================================================
| File                       | Full Size | Minified |     Gzip |   Brotli |
| :------------------------- | --------: | -------: | -------: | -------: |
| **Main Bundles**           |           |          |          |          |
|   my-lib.full.js           | 110.56 KB | 43.81 KB | 16.01 KB | 14.14 KB |
|   my-lib.core.js           |  18.40 KB |  6.60 KB |  2.67 KB |  2.36 KB |
| **Plugins**                |           |          |          |          |
|   another-feature.js       |   9.81 KB |  4.90 KB |  2.32 KB |  2.04 KB |
|   super-awesome-feature.js |   4.27 KB |  2.09 KB |    920 B |    811 B |
===========================================================================
```

## Configuration

Create a configuration file (`bundle-size.config.(ts|js|mjs|cjs|json)`) in your project root:

### TypeScript Configuration (`bundle-size.config.ts`)

Use `defineConfig` for full autocomplete and type-checking. TypeScript automatically narrows `minify` options based on the chosen `minifier`:

```typescript
import { defineConfig } from '@fimbul-works/bundle-size';

// Using Terser (Default)
export default defineConfig({
  minifier: 'terser',
  groups: [
    {
      name: 'Main Bundles',
      include: 'dist/*.js',
    },
    {
      name: 'Plugins',
      include: 'dist/plugins/*.js',
    },
  ],
  minify: {
    ecma: 2020,
    module: true,
    toplevel: true,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  },
  compression: ['gzip', 'brotli'],
  json: 'reports/bundle-size-@git~SHA-@date.json',
});
```

#### Using esbuild

```typescript
import { defineConfig } from '@fimbul-works/bundle-size';

export default defineConfig({
  minifier: 'esbuild',
  groups: [
    {
      name: 'Main Bundles',
      include: 'dist/*.js',
      // Groups can also override minification individually:
      minify: {
        target: 'es2022',
        treeShaking: true,
      },
    },
  ],
});
```

### JSON Configuration (`bundle-size.config.json`)

```json
{
  "minifier": "terser",
  "groups": [
    {
      "name": "Main Bundles",
      "include": "dist/*.js"
    },
    {
      "name": "Plugins",
      "include": "dist/plugins/*.js"
    }
  ],
  "minify": true,
  "json": "bundle-size-@git~TAG-@date-@time.json"
}
```

## Programmatic API

You can also run bundle size calculations directly in Node.js scripts:

```typescript
import { calculateBundleSizes } from '@fimbul-works/bundle-size';

const results = await calculateBundleSizes({
  groups: [
    {
      name: 'Main Bundles',
      include: 'dist/*.js',
    },
  ],
  compression: ['gzip', 'brotli'],
});
```

## Options Reference

### `BundleGroup`
- `name`: `string` (optional) - Display name for the group. If omitted for a single group, the group header row and JSON field are omitted.
- `include`: `string | string[]` - Glob pattern(s) to include.
- `exclude`: `string | string[]` - Glob pattern(s) to exclude.
- `minifier`: `'terser' | 'esbuild'` - Optional group-level minifier override.
- `minify`: `boolean | TerserOptions | EsbuildOptions` - Minification settings for the group.

### `BundleSizeOptions`
- `minifier`: `'terser' | 'esbuild'` - Default minifier engine (defaults to `'terser'`).
- `groups`: `BundleGroup[]` - Array of file groups to process.
- `compression`: `('gzip' | 'brotli')[]` - Compression formats to report.
- `minify`: `boolean | TerserOptions | EsbuildOptions` - Default minification settings (type-checked based on `minifier`).
- `save`: `boolean | ('minify' | 'gzip' | 'brotli')[]` - Which transformed files to keep on disk.
- `cleanup`: `boolean | ('minify' | 'gzip' | 'brotli')[]` - Which files to remove after reporting.
- `json`: `boolean | string` - Output size metrics to a JSON file.

#### Supported JSON Tokens
- `@git~SHA`: Current short git commit hash.
- `@git~TAG`: Current git tag (or `"untagged"`).
- `@git~BRANCH`: Current git branch name (slashes sanitized to dashes).
- `@date`: Current date (`YYYY-MM-DD`).
- `@time`: Current time (`HH-MM-SS`).
- `@epoch`: Current timestamp in seconds.

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

Built with 📦 by [FimbulWorks](https://github.com/fimbul-works)
