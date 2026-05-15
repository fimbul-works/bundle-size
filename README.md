# @fimbul-works/bundle-size

[![npm version](https://badge.fury.io/js/%40fimbul-works%2Fbundle-size.svg)](https://www.npmjs.com/package/@fimbul-works/bundle-size)
[![TypeScript](https://badges.frapsoft.com/typescript/code/typescript.svg?v=101)](https://github.com/microsoft/TypeScript)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/%40fimbul-works%2Fbundle-size)](https://bundlephobia.com/package/@fimbul-works/bundle-size)

A minimalistic library for calculating and reporting bundle sizes.

## Features

- **Minification**: Powered by Terser.
- **Compression**: Gzip and Brotli support.
- **Grouped Reports**: Organize files into logical groups.
- **In-Memory Measurement**: Reports sizes without needing to write archives to disk unless requested.

## Installation

```bash
pnpm add -D @fimbul-works/bundle-size

# Use directly with npx
npx @fimbul-works/bundle-size
```

## Usage

```typescript
import { calculateBundleSizes } from '@fimbul-works/bundle-size';

calculateBundleSizes({
  groups: [
    {
      name: 'Main Bundles',
      include: 'dist/*.js',
    },
    {
      name: 'Plugins',
      include: 'plugins/*.js',
    }
  ],
  minify: {
    toplevel: true,
    compress: { passes: 2, ecma: 2020 },
    mangle: { module: true },
    module: true,
  },
  compression: ['gzip', 'brotli'],
  save: ['minify'],
  cleanup: ['gzip', 'brotli']
});
```

## Configuration

Create a configuration file (`bundle-size.config.(ts|js|mjs|cjs|json)`) in the project root for easy setup:

```json
{
  "groups": [
    {
      "name": "Main Bundles",
      "include": "dist/*.js",
    },
    {
      "name": "Plugins",
      "include": "dist/plugins/*.js",
    }
  ],
  "minify": true
}
```

### `BundleGroup`
- `name`: string - Display name for the group.
- `include`: string | string[] - Glob patterns to include.
- `exclude`: string | string[] - Glob patterns to exclude.
- `minify`: boolean | TerserOptions - Whether to minify. If `true`, uses top-level `minify` options or defaults.

### `BundleSizeOptions`
- `groups`: BundleGroup[] - Array of groups to process.
- `compression`: ('gzip' | 'brotli')[] - Compression formats to report.
- `minify`: boolean | TerserOptions - Default minification settings for groups.
- `save`: boolean | ('minify' | 'gzip' | 'brotli')[] - Which files to keep on disk.
- `cleanup`: boolean | ('minify' | 'gzip' | 'brotli')[] - Which files to remove after reporting.

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

Built with 📦 by [FimbulWorks](https://github.com/fimbul-works)
