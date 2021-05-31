import sinon from 'sinon'

export class NoopLogger implements Logger {
  info () {}
  warn () {}
  error () {}
}

export class StubbedRegistryResolver implements DependencyResolver {
  pkgDeps: Map<string, DependencySpec[]> = new Map()
  getDepCallCount: Map<string, number> = new Map()

  init () {
    this._init()
  }

  buildLatestSpec (p: string): string {
    return `${p}@latest&greatest`
  }

  extractDependenciesFromManifest (input: PackageManifestInput): string[] {
    return [input.manifest]
  }

  getManifestPatterns (): string[] {
    return []
  }

  async getDependencies (spec: DependencySpec): Promise<DependencySpec[]> {
    if (!this.pkgDeps.has(spec.name)) throw new Error(`unexpected call to getDependencies for ${JSON.stringify(spec)}`)
    this.getDepCallCount.set(spec.name, (this.getDepCallCount.get(spec.name) || 0) + 1)
    return this.pkgDeps.get(spec.name)!
  }

  getSpec (p: string): DependencySpec {
    if (p === 'invalid-spec') throw new Error('invalid spec!')
    return { name: p, toString: () => p }
  }

  async resolveToSpec (p: string): Promise<string> {
    return this._resolveToSpec(p)
  }

  // stubz
  _init = sinon.stub()
  _resolveToSpec = sinon.stub()

  getInit = () => this._init
  getResolveToSpec = () => this._resolveToSpec

  setDependencies = (name: string, deps: string[]) => {
    this.pkgDeps.set(name, deps.map((pkg) => this.getSpec(pkg)))
  }
}
