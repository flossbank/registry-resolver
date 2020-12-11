const got = require('got')
const compareVersions = require('compare-versions')
const limit = require('call-limit')

/* The flow of functions:
0. getManifestPatterns
    - input: void
    - output: a list of strings that will be compiled to Regexs that will filter a list of files to only manifest files
1. extractDependenciesFromManifest
    - input: raw bytes of a package manifest file (requirements.txt)
    - output: a list of dependencies found in that manifest file
2. getSpec
    - input: a single entry from extractDependenciesFromManifest
    - output: an object { name: <pkgName>, toString: function that returns a package id (e.g. standard@1.1.1) }
3. getDependencies
    - input: an object outputted by getSpec
    - output: a list of dependencies of the inputted package, in the same form returned as getSpec
              e.g. dependencies.map(pkg => getSpec(pkg))
4. resolveToSpec
    - input: same as getSpec -- a "manifest-style" package specifier (e.g. sodium-native@^1.1.1)
    - output: a "locked" package version string -- with no ambiguity (e.g. sodium-native@1.4.0)
              this is done by calling the registry

The other functions defined in the NPM plugin are helpers called by the above 5
*/

class PipDependencyResolver {
  constructor({ log }) {
    this.log = log
    this.got = limit.promise(got, 30)
    this.versionsCache = new Map()
  }

  init() {
    this.versionsCache = new Map()
  }

  // a regex-type string list that represents the search pattern
  // for this language/registry's manifest files
  getManifestPatterns() {
    return [".*requirements.*\.txt"]
  }

  // input: string
  // output: string in format of PkgOpVersion
  cleanDependency(dep) {
    if (!dep) return ""

    dep = dep.split("; extra")[0] || ""
    dep = dep.replace(/[()]|\s+/g, "")  

    return dep
  }

  // Def: given a raw file (i.e. the bytes of requirements.txt), return a list ([]) of
  //  dependencies that are listed in the manifest file. The format of each entry in the list
  //  should be consumable (one at a time) by getSpec.
  extractDependenciesFromManifest({ manifest }) {
    if (!manifest) return []
    const extract = manifest.split("\n").reduce((acc, line) => {
      /**
       * trim off leading and trailing whitespace
       * and lowercase the requirement to avoid duplication
       */
      line = line.trim().toLowerCase()
      /**
       * skip all blank lines
       */
      if (line === "") return acc
      /**
       * skip all lines that are comments
       */
      if (line.startsWith("#")) return acc
      /**
       * skip all lines that start with git+
       */
      if (line.startsWith("git+")) return acc
      /**
       * skip all lines that start with -
       */
      if (line.startsWith("-")) return acc
      /**
       * If none of the above are true, assume it's a requirement, 
       * remove all comments and then remove all whitespace
       */
      return acc.concat(line)
    }, [])
    return extract
  }

  /**
   * - input: a single entry from extractDependenciesFromManifest, input format is of <name><operator><version>
   * - output: an object { name: <pkgName>, toString: function that returns a package id (e.g. standard@1.1.1) }} pkg
   */
  getSpec(pkg) {
    // parse the pkg version requirements ('>=', '1.11'), ('<', '1.12')

    if (typeof pkg === "object") return pkg

    const pkgOnlyReg = /^[A-Za-z0-9-_]+$/

    // If pkg is just a name, return name @ latest
    if (pkg.match(pkgOnlyReg)) {
      return {
        name: pkg, // splice off the trailing semi colon
        operator: "==", 
        versionSpec: "",
        toString: () => `${pkg}@`
      }
    }

    // Input could have a comment after <package><operator><version>, or who knows what else, so split on space and just consume
    // first element
    const pkgDetails = pkg.split(" ")[0]
    const re = /^([A-Za-z0-9\-_]+)(\[([A-Za-z0-9\-\_]+)\])?(==|>=|>|<=|~=)?([A-Za-z0-9\.]+)?$/
    const match = pkgDetails.match(re)
    if (!match) throw new Error("unparseable pkg dependency")
    const name = match[1]
    const operator = match[4]
    const version = match[5]

    return {
      name,
      operator,
      versionSpec: version,
      toString: () => `${name}@${operator}${version}`
    }
  }

  // returns a list of dependency specs: [ { dep1 }, { dep2 }, ...]
  /**
   * - input: an object outputted by getSpec
   * - output: a list of dependencies of the inputted package, in the same form returned as getSpec e.g. dependencies.map(pkg => getSpec(pkg))} pkg 
   * 
   * Example returned by pypi requires_dist field:
   * [
        'asgiref (~=3.2.10)',
        'pytz',
        'sqlparse (>=0.2.2)',
        "argon2-cffi (>=16.1.0) ; extra == 'argon2'",
        "bcrypt ; extra == 'bcrypt'"
      ]
   * https://www.python.org/dev/peps/pep-0345/#requires-dist-multiple-use
   */
  async getDependencies(pkgSpec) {
    let name
    let version

    try {
      const resolved = await this.resolve(pkgSpec)
      name = resolved.name
      version = resolved.version
    } catch (e) {
      this.log.error(e)
      // unable to resolve the given spec; no way to get the deps for this input
      return []
    }

    const options = { responseType: "json" }
    const endpoint = version ? `https://pypi.org/pypi/${name}/${version}/json`
      : `https://pypi.org/pypi/${name}/json`
    const { body } = await this.got(endpoint, options)

    const depRequirements = body.info.requires_dist
    if (!depRequirements || !depRequirements.length) return []

    // For each dep, call get spec of that dep
    const deps = []
    for (let i = 0; i < depRequirements.length; i++) {
      const dep = this.cleanDependency(depRequirements[i])

      if (!dep) continue

      try {
        const pkgSpec = await this.getSpec(dep)
        deps.push(pkgSpec)
      } catch (e) {}
    }
    return deps
  }

  // input: output of getSpec
  // resolves the most suitable version to freeze given <name><operator><version>
  // for example: django >= 3.0.0 would fetch all versions available, and select the highest version
  async resolve(pkgSpec) {
    const { name, operator, versionSpec: version } = pkgSpec

    if (operator === "==") {
      return { name, version }
    }

    if (!this.versionsCache.has(name)) {
      // Fetch all tags for a package from https://pypi.org/pypi/<name>/json . response will have top level "releases" key
      const options = { responseType: "json" }
      const { body } = (await this.got(`https://pypi.org/pypi/${name}/json`, options))
      // Grab releases and sort them greatest to least and then staches them in our cache
      const releasesRes = Object.keys(body.releases)
        .sort(compareVersions)
        .reverse()
      this.versionsCache.set(name, releasesRes)
    }
    
    const releases = this.versionsCache.get(name)

    if (!releases.length) throw new Error("No releases found")

    // If version is latest, return the first element of the releases array, representing the latest release
    if (version === "latest") {
      return { name, version: releases.shift() }
    }

    let release

    // Find the highest version out of the tags that satisfy the requirements
    switch (operator) {
      case "!=":
        release = releases.find(rel =>
          compareVersions.compare(rel, version) !== 0
        )
        break
      case ">=":
      case "<=":
      case ">":
        release = releases.find(rel =>
          compareVersions.compare(rel, version, operator)
        )
        break
      case "~=":
        // Fetch latest version under the next specified minor
        const versionComponents = version.split('.')
        // If length of the version components is 2, then means fetch up until the next major
        // if length of the version components is 3, then it means fetch up to the next minor
        let nextVersion
        if (versionComponents.length === 1) {
          nextVersion = `${parseInt(versionComponents[0])+1}`
        } else if (versionComponents.length === 2) {
          nextVersion = `${parseInt(versionComponents[0])+1}.0`
        } else {
          nextVersion = `${versionComponents[0]}.${parseInt(versionComponents[1])+1}.0`
        }
        release = releases.find(rel =>
          compareVersions.compare(rel, nextVersion, '<')
        )
        break
      default:
        throw new Error("Unable to parse version")
    }

    if (!release) {
      throw new Error("no version release that satisfies requirements")
    }

    return { name, version: release }
  }

  /**
   * - input: same as getSpec -- a "manifest-style" package specifier (e.g. sodium-native@^1.1.1)
   *- output: a "locked" package version string -- with no ambiguity (e.g. sodium-native@1.4.0)
   * this is done by calling the registry 
   */
  async resolveToSpec(pkg) {
    try {
      const spec = this.getSpec(pkg)
      const { name, version } = await this.resolve(spec)
      return `${name}==${version}`
    } catch {}
    // Fall back to just returning the input
    return pkg
  }
}

module.exports = PipDependencyResolver
