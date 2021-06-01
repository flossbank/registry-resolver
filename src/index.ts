import NpmDependencyResolver from './npm/index.js'
import RubyGemsDependencyResolver from './rubygems/index.js'

export interface RegistryResolverParams {
  log?: Logger
  epsilon?: number
  registryOverrides?: {
    [language: string]: {
      [registry: string]: DependencyResolver
    }
  }
}
export interface PkgRegIdentifier {
  language: LanguageId
  registry: RegistryId
}

export type SupportedManifest = {
  manifest: string
} & PkgRegIdentifier

export type SupportedManifestDependencies = {
  deps: RawPkgSpec[]
} & PkgRegIdentifier

export type SupportedManifestPattern = {
  patterns: string[]
} & PkgRegIdentifier

export type ComputePackageWeightInput = {
  topLevelPackages: RawPkgSpec[]
  noCompList?: Set<PackageName>
} & PkgRegIdentifier

export type ResolveToSpecInput = {
  packages: RawPkgSpec[]
} & PkgRegIdentifier

export class RegistryResolver {
  private readonly log: Logger

  private readonly registries: {
    [languageName: string]: {
      [registryName: string]: DependencyResolver
    }
  }

  private epsilon: number

  constructor ({ epsilon = 0.01, log = console, registryOverrides = {} }: RegistryResolverParams) {
    this.log = log
    this.epsilon = epsilon
    this.registries = {
      javascript: {
        npm: new NpmDependencyResolver({ log: this.log })
      },
      ruby: {
        rubygems: new RubyGemsDependencyResolver({ log: this.log })
      },
      ...registryOverrides
    }
  }

  setEpsilon (val: number): void {
    this.epsilon = val
  }

  getSupportedManifestPatterns (): SupportedManifestPattern[] {
    const supportedManifestPatterns = []
    for (const language in this.registries) {
      for (const registry in this.registries[language]) {
        // TODO fix this
        // @ts-expect-error
        const patterns = this.registries[language][registry].getManifestPatterns()
        supportedManifestPatterns.push({
          registry,
          language,
          patterns
        })
      }
    }
    return supportedManifestPatterns
  }

  //   manifests => extractedDeps
  // [
  //   { language, registry, manifest } => { language, registry, deps }
  // ]
  extractDependenciesFromManifests (manifests: SupportedManifest[]): SupportedManifestDependencies[] {
    const extractedDeps = manifests.map(({ language, registry, manifest }) => {
      const deps = this.extractDependenciesFromManifest({ language, registry, manifest })
      return {
        language,
        registry,
        deps
      }
    })

    const groups: Map<LanguageId, Map<RegistryId, RawPkgSpec[]>> = new Map()
    for (const { language, registry, deps } of extractedDeps) {
      if (!groups.has(language)) {
        groups.set(language, new Map([[registry, deps]]))
        continue
      }

      const languageGroup = groups.get(language)
      if (typeof languageGroup === 'undefined') continue

      if (!languageGroup.has(registry)) {
        languageGroup.set(registry, deps)
        continue
      }

      const registryGroup = languageGroup.get(registry)
      if (typeof registryGroup === 'undefined') continue

      languageGroup.set(registry, registryGroup.concat(deps))
    }

    const depsGroupedByLangReg: SupportedManifestDependencies[] = []
    for (const [lang, registries] of groups.entries()) {
      for (const [reg, deps] of registries.entries()) {
        depsGroupedByLangReg.push({ language: lang, registry: reg, deps })
      }
    }
    return depsGroupedByLangReg
  }

  extractDependenciesFromManifest (input: SupportedManifest): string[] {
    const { language, registry, manifest } = input
    const pkgReg = this.getSupportedRegistry({ language, registry })
    if (pkgReg == null) {
      return []
    }
    return pkgReg.extractDependenciesFromManifest({ manifest })
  }

  buildLatestSpec (pkgName: string, pkgRegId: PkgRegIdentifier): RawPkgSpec {
    const { language, registry } = pkgRegId
    const pkgReg = this.getSupportedRegistry({ language, registry })
    if (pkgReg == null) throw new Error(`unsupported language/registry ${language} / ${registry}`)

    return pkgReg.buildLatestSpec(pkgName)
  }

  getSupportedRegistry (pkgRegId: PkgRegIdentifier): DependencyResolver | null {
    const { language, registry } = pkgRegId
    const langGroup = this.registries[language]
    if (typeof langGroup === 'undefined') return null
    const pkgReg = langGroup[registry]
    if (typeof pkgReg === 'undefined') return null

    return pkgReg
  }

  // Given a supported language+registry, this function will use the configured
  // dependency resolver(s) to create a weighted map of all the dependencies of the
  // passed in "top level packages".
  async computePackageWeight (input: ComputePackageWeightInput): Promise<Map<string, number>> {
    const { topLevelPackages, language, registry, noCompList = new Set() } = input

    const pkgReg = this.getSupportedRegistry({ registry, language })
    if (pkgReg == null) {
      throw new Error('unsupported registry')
    }
    // If plugin has init function, call that
    if (typeof pkgReg.init === 'function') {
      pkgReg.init()
    }

    // this is the smallest weight we will give a package before exiting
    const epsilon = this.epsilon
    // this is a map of package => their combined weight
    const packageWeightMap: Map<PackageName, number> = new Map()
    // this is a map of package@version => [dep@version, ...]
    const resolvedPackages: Map<RawPkgSpec, DependencySpec[]> = new Map()

    const initialPackageSpecs = topLevelPackages.map((pkg: string) => {
      try {
        return pkgReg.getSpec(pkg)
      } catch (e) {
        this.log.warn('Unable to resolve initial pkg spec:', e)
        return null
      }
    }).filter((pkg): pkg is DependencySpec => pkg !== null)
    const initialWeight = 1 / (initialPackageSpecs.length > 0 ? initialPackageSpecs.length : 1)

    const queue = [{ packages: initialPackageSpecs, weight: initialWeight }]
    while (queue.length > 0) {
      const { packages, weight } = queue.pop() ?? { packages: [], weight: 0 }

      await Promise.all(packages.map(async (pkg) => {
        let pkgSpec: DependencySpec
        try {
          pkgSpec = pkgReg.getSpec(pkg.toString())
        } catch (e) {
          // it's possible for users to send up top level packages that include invalid specs
          // when this happens, we will simply skip processing that pkg (we wouldn't be able to
          // determine its dependencies anyway). this way, if the user was acting unintentionally,
          // we can still use the session to comp any other valid packages touched in the session.
          // if the user was acting intentionally (malicious), their malformed pkg name will be
          // silently ignored. an example of an invalid spec for NPM is "react^15" which hit
          // this lambda (and subsequently caused it to throw) when I typo-ed "react@^15".
          this.log.warn('Unable to resolve pkg spec:', e)
          return
        }
        const pkgId = pkgSpec.toString()

        let deps: DependencySpec[]
        if (resolvedPackages.has(pkgId)) {
          deps = resolvedPackages.get(pkgId) ?? []
        } else {
          deps = await pkgReg.getDependencies(pkgSpec)
          resolvedPackages.set(pkgId, deps)
        }

        const noCompDeps = deps.filter((depPkgSpec) => noCompList.has(depPkgSpec.name))

        // any dependencies of this package that are marked as no-comp that have no dependencies themselves
        // should not be counted in the revenue split; if they have dependencies of their own, that revenue can
        // flow down to their children. this handles everything except the case where a no comp package depends
        // soley on no-comp packages.
        const noCompDepsWithNoDeps = (await Promise.all(noCompDeps.map(async (depPkgSpec) => {
          let grandDeps: DependencySpec[]
          const depPkgId = depPkgSpec.toString()
          if (resolvedPackages.has(depPkgId)) {
            grandDeps = resolvedPackages.get(depPkgId) ?? []
          } else {
            grandDeps = await pkgReg.getDependencies(depPkgSpec)
            resolvedPackages.set(depPkgId, grandDeps)
          }

          return { depPkgSpec, grandDeps }
        }))).filter(({ grandDeps }) => grandDeps.length === 0).map(({ depPkgSpec }) => depPkgSpec)

        // remove no comp deps that have no deps from this package's dep list
        deps = deps.filter((dep) => !noCompDepsWithNoDeps.some(noCompDep => noCompDep.name === dep.name))

        let splitWeight: number
        if (noCompList.has(pkgSpec.name)) {
          // if the package's development is under the umbrella of some for-profit company
          // the weight can just continue through to its dependencies
          splitWeight = weight / (deps.length > 0 ? deps.length : 1)
          if (splitWeight < epsilon) {
            return
          }
        } else {
          // each package splits the weight with their dependencies evenly
          // deps.length == # of dependencies; +1 == self
          splitWeight = weight / (deps.length + 1)
          const currentWeight = packageWeightMap.get(pkgSpec.name) ?? 0
          if (splitWeight < epsilon) {
            packageWeightMap.set(pkgSpec.name, currentWeight + weight)
            return
          }
          packageWeightMap.set(pkgSpec.name, currentWeight + splitWeight)
        }

        queue.push({ packages: deps, weight: splitWeight })
      }))
    }

    return packageWeightMap
  }

  async resolveToSpec (input: ResolveToSpecInput): Promise<RawPkgSpec[]> {
    const { packages, language, registry } = input
    const pkgReg = this.getSupportedRegistry({ registry, language })
    if (pkgReg == null) {
      throw new Error('unsupported registry')
    }
    return await Promise.all(packages.map(async pkg => await pkgReg.resolveToSpec(pkg)))
  }
}

export default RegistryResolver
