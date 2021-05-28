import pacote from 'pacote'
import npa from 'npm-package-arg'
import limit from 'call-limit'

export interface NpmDependencyResolverParams {
  log: Logger
  getManifest?: typeof pacote.manifest
}

export type NpmDependencySpec = npa.Result

export type NpmDependency = Dependency & {}

export type NpmPackageManifest = {
  dependencies?: DependencySpecList 
  devDependencies?: DependencySpecList
}

export class NpmDependencyResolver implements DependencyResolver<NpmDependencySpec> {
  private log: Logger
  private getManifest: typeof pacote.manifest

  constructor ({ log, getManifest = pacote.manifest }: NpmDependencyResolverParams) {
    this.log = log

    // allow 30 concurrent calls to npm registry for package manifests
    this.getManifest = limit.promise(getManifest, 30)
  }

  // a regex-type string list that represents the search pattern
  // for this language/registry's manifest files
  getManifestPatterns () {
    return ['package.json']
  }

  // returns a string in the form of a top level dependency that specifies
  // the latest version of this package on the registry; for NPM, that's done
  // by specifiying @latest instead of a version number
  buildLatestSpec (pkgName: string) {
    return `${pkgName}@latest`
  }

  extractDependenciesFromManifest (input: PackageManifestInput) {
    const { manifest } = input
    const parsedManifest = this.parseManifest({ manifest })
    const deps = parsedManifest.dependencies || {}
    const devDeps = parsedManifest.devDependencies || {}

    const allDeps = []
    for (const dep in deps) {
      const spec = deps[dep]
      allDeps.push(`${dep}@${spec}`)
    }
    for (const dep in devDeps) {
      const spec = devDeps[dep]
      allDeps.push(`${dep}@${spec}`)
    }

    return allDeps
  }

  private parseManifest (input: PackageManifestInput): NpmPackageManifest {
    const { manifest } = input
    try {
      return JSON.parse(manifest)
    } catch (e) {
      this.log.warn('Unable to parse manifest', e)
      return { dependencies: {} }
    }
  }

  // parse a written package like `sodium-native` into what it means to the registry
  // e.g. sodium-native@latest
  getSpec (pkg: string): NpmDependencySpec {
    return npa(pkg)
  }

  // returns a list of dependency specs: [ { dep1 }, { dep2 }, ...]
  // pkg is some npa.Result
  // ref: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/5344bfc80508c53a23dae37b860fb0c905ff7b24/types/npm-package-arg/index.d.ts#L25
  async getDependencies (pkg: NpmDependencySpec): Promise<Dependency[]> {
    if (!pkg.registry) {
      // this package doesn't live on the NPM registry, so we can't get the deps
      return []
    }
    try {
      const manifest = await this.resolve(pkg)
      // map { js-deep-equals: 1.0.0 } to [{ name: js-deep-equals, rawSpec: 1.0.0, etc }]
      // from npm-package-arg result (see above gh url)
      const data = Object.keys(manifest?.dependencies as DependencySpecList)
        .map((name) => {
          try {
            return npa.resolve(name, manifest?.dependencies?.[name] || '') as NpmDependency
          } catch (e) {
            this.log.warn(`unable to resolve package name ${name}`, e)
            return null
          }
        })
        .filter((spec: NpmDependency | null): spec is NpmDependency => !!spec) // filter out any invalid packages
      return data
    } catch (e) {
      this.log.warn(`unable to get manifest for pkg ${pkg}`, e)
      return []
    }
  }

  // given standard@latest return e.g. standard@13.1.0
  async resolveToSpec (pkg: string) {
    const manifest = await this.resolve(pkg)

    if (manifest?.name && manifest?.version) {
      return npa.resolve(manifest.name, manifest.version).toString()
    }
    // fallback to returning the input
    return pkg
  }

  // resolve a package to its manifest on the registry
  private async resolve (pkg: string | npa.Result): Promise<pacote.ManifestResult | null> {
    try {
      const manifest = await this.getManifest(pkg.toString(), {
        fullMetadata: false // we only need deps
      })
      return manifest
    } catch (e) {
      this.log.warn(`unable to get manifest for pkg ${pkg}`, e)
      return null
    }
  }
}

export default NpmDependencyResolver