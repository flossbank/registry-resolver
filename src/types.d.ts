interface Logger {
  info: <T>(...args: T) => void
  warn: <T>(...args: T) => void
  error: <T>(...args: T) => void
}

interface DependencyResolver {
  init?: () => void
  buildLatestSpec: (p: string) => string
  extractDependenciesFromManifest: (input: PackageManifestInput) => string[]
  getManifestPatterns: () => string[]
  getDependencies: (spec: DependencySpec) => Promise<DependencySpec[]>
  getSpec: (p: string) => DependencySpec
  resolveToSpec: (p: string) => Promise<RawPkgSpec>
}

interface DependencySpec {
  name: string
  toString: () => string
}

type DependencySpecList = Record<string, string>

interface Dependency {
  name: string
}

type RegistryId = string
type LanguageId = string
type PackageName = string
type RawPkgSpec = string

interface PackageManifestInput {
  manifest: string
}

declare module 'call-limit' {
  export function promise<T> (fn: T, limit: number): T
}
