interface Logger {
  info: <T>(...args: T) => void
  warn: <T>(...args: T) => void
  error: <T>(...args: T) => void
}

interface DependencyResolver<Spec extends DependencySpec> {
  buildLatestSpec (p: string): string
  extractDependenciesFromManifest (input: PackageManifestInput): string[]
  getManifestPatterns (): string[]
  getDependencies (spec: Spec): Promise<Spec[]>
  getSpec (p: string): Spec
  resolveToSpec (p: string): Promise<string>
}

type DependencySpec = {
  name: string
  toString(): string
}

type DependencySpecList = Record<string, string>

type Dependency = {
  name: string
}

interface PackageManifestInput {
  manifest: string
}

declare module 'call-limit' {
  export function promise<T>(fn: T, limit: number): T
}