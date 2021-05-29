interface Logger {
  info: <T>(...args: T) => void
  warn: <T>(...args: T) => void
}

interface DependencyResolver<Spec extends DependencySpec> {
  buildLatestSpec (p: string): string
  extractDependenciesFromManifest (input: PackageManifestInput): string[]
  getManifestPatterns (): string[]
  getDependencies (spec: Spec): Promise<Dependency[]>
  getSpec (p: string): Spec
  resolveToSpec (p: string): Promise<string>
}

type DependencySpec = {
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
  export function promise<T, A>(fn: (...args: A) => Promise<T>, limit: number): (...args: A) => Promise<T>
}