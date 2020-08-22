const NpmDependencyResolver = require('./npm')

class RegistryResolver {
  constructor ({ epsilon, log }) {
    this.log = log || console
    this.epsilon = epsilon
    this.registries = {
      javascript: {
        npm: new NpmDependencyResolver({ log: this.log })
      }
    }
  }

  getSupportedManifestPatterns () {
    let supportedManifestPatterns = []
    for (const language in this.registries) {
      for (const registry in this.registries[language]) {
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

  getSupportedRegistry ({ language, registry }) {
    if (!registry || !language) return false
    if (!this.registries[language]) return false
    return this.registries[language][registry]
  }

  // Given a supported language+registry, this function will use the configured
  // dependency resolver(s) to create a weighted map of all the dependencies of the
  // passed in "top level packages". 
  async computePackageWeight ({ topLevelPackages, language, registry, noCompList }) {
    const pkgReg = this.getSupportedRegistry({ registry, language })
    if (!pkgReg) {
      throw new Error('unsupported registry')
    }

    const _noCompList = typeof noCompList === 'undefined' ? new Set() : noCompList

    // this is the smallest weight we will give a package before exiting
    const epsilon = this.epsilon
    // this is a map of package => their combined weight
    const packageWeightMap = new Map()
    // this is a map of package@version => [dep@version, ...]
    const resolvedPackages = new Map()

    const queue = [{ packages: topLevelPackages, weight: 1 / (topLevelPackages.length || 1) }]
    while (queue.length) {
      const { packages, weight } = queue.pop()

      await Promise.all(packages.map(async (pkg) => {
        let pkgSpec
        try {
          pkgSpec = pkgReg.getSpec(pkg)
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

        let deps
        if (resolvedPackages.has(pkgId)) {
          deps = resolvedPackages.get(pkgId)
        } else {
          deps = await pkgReg.getDependencies(pkgSpec)
          resolvedPackages.set(pkgId, deps)
        }

        let splitWeight
        if (noCompList.has(pkgSpec.name)) {
          // if the package's development is under the umbrella of some for-profit company
          // the weight can just continue through to its dependencies
          splitWeight = weight / (deps.length || 1)
          if (splitWeight < epsilon) {
            return
          }
        } else {
          // each package splits the weight with their dependencies evenly
          // deps.length == # of dependencies; +1 == self
          splitWeight = weight / (deps.length + 1)
          if (splitWeight < epsilon) {
            packageWeightMap.set(pkgSpec.name, (packageWeightMap.get(pkgSpec.name) || 0) + weight)
            return
          }
          packageWeightMap.set(pkgSpec.name, (packageWeightMap.get(pkgSpec.name) || 0) + splitWeight)
        }

        queue.push({ packages: deps, weight: splitWeight })
      }))
    }

    return packageWeightMap
  }

  async resolveToSpec ({ packages, language, registry }) {
    const pkgReg = this.getSupportedRegistry({ registry, language })
    if (!pkgReg) {
      throw new Error('unsupported registry')
    }
    return Promise.all(packages.map(pkg => pkgReg.resolveToSpec(pkg)))
  }
}

module.exports = RegistryResolver
