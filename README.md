# registry-resolver

A packages resolver library intended to assign weights to all the packages in the dependency tree of a given package or packages.

The algorithm currently in use is:

1. Begin with weight 1
1. Divide weight between input packages (top level packages)
1. For each package, query registry for immediate dependencies
1. Split the package's weight with its immediate dependencies.
1. Repeat from step 2 until there are no more dependencies or remaining weight is less than the configured `epsilon`

## Usage

```javascript
const RegistryResolver = require('@flossbank/registry-resolver')

const resolver = new RegistryResolver({
  log: logger, // defaults to console
  epsilon: 0.01 // the smallest weight that will be assigned to a package before exiting
})

const packageWeightMap = await resolver.computePackageWeight({
  language: 'javascript',
  registry: 'npm',
  topLevelPackages: ['standard', 'react', 'webpack'],
  noCompList: new Set(['react'])
})

/* example output
{
  packageWeightMap: Map {
    'standard' => 0.037037037037037035,
    'webpack' => 0.013333333333333332,
    '@types/estree' => 0.013333333333333332,
    '@webassemblyjs/ast' => 0.013333333333333332,
    '@types/eslint-scope' => 0.013333333333333332,
    'glob-to-regexp' => 0.013333333333333332,
    '@webassemblyjs/helper-module-context' => 0.013333333333333332,
    'graceful-fs' => 0.013333333333333332,
    'json-parse-better-errors' => 0.013333333333333332,
    'loader-runner' => 0.013333333333333332,
    'mime-types' => 0.013333333333333332,
    'pkg-dir' => 0.013333333333333332,
    'neo-async' => 0.013333333333333332,
    '@webassemblyjs/wasm-edit' => 0.013333333333333332,
    '@webassemblyjs/wasm-parser' => 0.013333333333333332,
    'tapable' => 0.013333333333333332,
    'chrome-trace-event' => 0.013333333333333332,
    'acorn' => 0.013333333333333332,
    'terser-webpack-plugin' => 0.013333333333333332,
    'schema-utils' => 0.013333333333333332,
    'watchpack' => 0.013333333333333332,
    'eslint-scope' => 0.013333333333333332,
    'enhanced-resolve' => 0.013333333333333332,
    'webpack-sources' => 0.013333333333333332,
    'browserslist' => 0.013333333333333332,
    'events' => 0.013333333333333332,
    'loose-envify' => 0.08333333333333333,
    'object-assign' => 0.16666666666666666,
    'js-tokens' => 0.08333333333333333,
    'eslint-config-standard' => 0.037037037037037035,
    'eslint-plugin-node' => 0.037037037037037035,
    'eslint-plugin-react' => 0.037037037037037035,
    'eslint-plugin-promise' => 0.037037037037037035,
    'standard-engine' => 0.037037037037037035,
    'eslint-config-standard-jsx' => 0.037037037037037035,
    'eslint' => 0.037037037037037035,
    'eslint-plugin-import' => 0.037037037037037035
  }
}
*/
```

## API

### `new RegistryResolver({ log, epsilon })`

Constructor. Log defaults to `console`. Epsilon is the smallest weight allowed for a specific package.

### `.getSupportedManifestPatterns()`

Returns filenames of package manifest files supported by the resolver in the format:

```javascript
[
  {
    registry: String,
    language: String,
    patterns: []String
  }
]
```

### `.extractDependenciesFromManifests(manifests)`

Returns top-level dependencies extracted from a list of supported manifest files.

#### manifests
A list of manifest objects:

```javascript
[
  {
    registry: String,
    language: String,
    manifest: String
  }
]
```

### `.extractDependenciesFromManifest(manifest)`

Returns top-level dependencies extracted from a single manifest file.

#### manifest
```javascript
{
  registry: String,
  language: String,
  manifest: String
}
```

### `.getSupportedRegistry({ language: String, registry: String })`

Returns a package registry wrapper used to resolve dependencies, or false if the combination is unsupported. Used internally.

### `.computePackageWeight({ topLevelPackages, language, registry, noCompList? })`

Returns a `Promise` that resolves to a `Map` of `packageName => packageWeight`.

#### topLevelPackages
A list of packages/specs extracted from package manifest files, e.g. `['standard@^12.0.1', 'react@16.0.0']`.

#### language
String; the language the packages are written in (e.g. `javascript`). Currently only JavaScript is supported.

#### registry
String; the registry identifier (e.g. `npm`). Currently only NPM is supported.

#### noCompList
Set; a set of packages that should be given 0 weight in the dependency tree.

### `.resolveToSpec({ packages, language, registry })`
Returns a `Promise` that resolves a list of package specs (e.g. `standard@^12.0.1`) to a static package identifier (e.g. `standard@12.1.1`).

#### packages
List of strings, e.g. `['standard@^12.0.1', 'react@16.0.0']`.

#### language
String; the language the packages are written in (e.g. `javascript`). Currently only JavaScript is supported.

#### registry
String; the registry identifier (e.g. `npm`). Currently only NPM is supported.


# License 
GPL-3.0
