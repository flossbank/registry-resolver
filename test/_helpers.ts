import sinon, { SinonStub } from 'sinon'

export class NoopLogger implements Logger {
  info (): void {}
  warn (): void {}
  error (): void {}
}

export class StubbedRegistryResolver implements DependencyResolver {
  pkgDeps: Map<string, DependencySpec[]> = new Map()
  getDepCallCount: Map<string, number> = new Map()

  init (): void {
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
    this.getDepCallCount.set(spec.name, (this.getDepCallCount.get(spec.name) ?? 0) + 1)
    return this.pkgDeps.get(spec.name)! // eslint-disable-line
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

  getInit = (): SinonStub => this._init
  getResolveToSpec = (): SinonStub => this._resolveToSpec

  setDependencies = (name: string, deps: string[]): void => {
    this.pkgDeps.set(name, deps.map((pkg) => this.getSpec(pkg)))
  }
}
