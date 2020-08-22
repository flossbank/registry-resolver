const pacote = require('pacote')
const npa = require('npm-package-arg')
const limit = require('call-limit')

class NpmDependencyResolver {
  constructor ({ log }) {
    this.log = log

    // allow 30 concurrent calls to npm registry for package manifests
    this.getManifest = limit.promise(pacote.manifest, 30)
  }

  // a regex-type string list that represents the search pattern
  // for this language/registry's manifest files
  getManifestPatterns () {
    return ['package.json']
  }

  extractDependenciesFromManifest({ manifest }) {
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

  parseManifest ({ manifest }) {
    try {
      return JSON.parse(manifest)
    } catch (e) {
      this.log.warn('Unable to parse manifest', e)
      return {}
    }
  }

  // parse a written package like `sodium-native` into what it means to the registry
  // e.g. sodium-native@latest
  getSpec (pkg) {
    return npa(pkg)
  }

  // returns a list of dependency specs: [ { dep1 }, { dep2 }, ...]
  // pkg is some npa.Result
  // ref: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/5344bfc80508c53a23dae37b860fb0c905ff7b24/types/npm-package-arg/index.d.ts#L25
  async getDependencies (pkg) {
    if (!pkg.registry) {
      // this package doesn't live on the NPM registry, so we can't get the deps
      return []
    }
    let dependencies = []
    try {
      const manifest = await this.resolve(pkg)
      // map { js-deep-equals: 1.0.0 } to [{ name: js-deep-equals, rawSpec: 1.0.0, etc }]
      // from npm-package-arg result (see above gh url)
      dependencies = Object.keys(manifest.dependencies || {})
        .map(name => {
          try {
            return npa.resolve(name, manifest.dependencies[name])
          } catch (e) {
            this.log.warn(`unable to resolve package name ${name}`, e)
            return null
          }
        })
        .filter(spec => spec) // filter out any invalid packages
    } catch (e) {
      this.log.warn(`unable to get manifest for pkg ${pkg}`, e)
    }
    return dependencies
  }

  // given standard@latest return e.g. standard@13.1.0
  async resolveToSpec (pkg) {
    const manifest = await this.resolve(pkg)
    if (manifest.name && manifest.version) {
      return npa.resolve(manifest.name, manifest.version).toString()
    }
    // fallback to returning the input
    return pkg
  }

  // resolve a package to its manifest on the registry
  async resolve (pkg) {
    try {
      const manifest = await this.getManifest(npa(pkg), {
        fullMetadata: false // we only need deps
      })
      return manifest
    } catch (e) {
      this.log.warn(`unable to get manifest for pkg ${pkg}`, e)
      return {}
    }
  }
}

module.exports = NpmDependencyResolver
