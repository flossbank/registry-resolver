const got = require('got')
const { compare: compareVersions } = require('@snyk/ruby-semver')
const limit = require('call-limit')

class RubyGemsDependencyResolver {

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
    return ['^Gemfile$']
  }

  // Def: given a raw file (i.e. the bytes of Gemfile), return a list ([]) of
  //  dependencies that are listed in the manifest file. The format of each entry in the list
  //  should be consumable (one at a time) by getSpec.
  extractDependenciesFromManifest({ manifest }) {
    // TODO: If we detect that the source of the manifest ISN"T rubygems.org, should we even parse the deps??

    // TODO: doesn't support `when '1.9.1'; gem 'ruby-debug-base19', '0.11.23'` syntax

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
       * Add all lines that start with "gem" since we're including deps from every group
       */
      if (line.startsWith("gem")) {
        // Split on # and remove the comments at the end of any lines
        const lineWithoutComment = line.split('#')[0]
        return acc.concat(lineWithoutComment)
      }
      return acc
    }, [])
    return extract
  }

  /**
   * - input: a single entry from extractDependenciesFromManifest, input format is of 
   * "gem <name of gem>, "version (optional)", specifiers (optional)
   */
  getSpec(pkg) {
    if (typeof pkg === "object") return pkg

    // Version seems to always come after the gem name, if it is specified. 
    const pkgParts = pkg.split(",")
    // remove gem, trim off white space, remove quotes, now we have the name
    const name = pkgParts[0].replace('gem', '').trim().replace(/'/g, '').replace(/"/g, '')

    // If there's nothing after the name, then return latest as version
    if (!pkgParts[1]) {
      return {
        name,
        operator: '=',
        versionSpec: 'latest',
        toString: () => `${name}@`
      }
    }

    // We are assuming that if this match fails, a version is not specified 
    // and there for we will set the version to "latest"

    // Some cases, like gem "toggle", ">= 1.0", "< 2.0", "!= 3.0" are too hard to determine so will
    // just use first found chunk i.e. >= 1.0. in this example
    const re = /^('|")(==|=|>=|>|<=|<|~>|!=)?\s*([a-z0-9.]+)('|")$/
    const match = pkgParts[1].trim().match(re) || []
    const operator = match[2] || '='
    const version = match[3] || 'latest'

    return {
      name,
      operator,
      versionSpec: version,
      toString: () => `${name}@${operator}${version}`
    }
  }

  // To list versions - hit https://rubygems.org/api/v1/versions/[gem name].json
  // To get deps of specific version - hit https://rubygems.org/api/v2/rubygems/[gem name]/versions/[version].json
  // to get latest version deps - hit https://rubygems.org/api/v1/gems/[gem name].json
  async getDependencies(pkgSpec) {
    let name
    let version
    let dependencies

    try {
      const resolved = await this.resolve(pkgSpec)
      name = resolved.name
      version = resolved.version

      const options = { responseType: "json" }
      const endpoint = version ? `https://rubygems.org/api/v2/rubygems/${name}/versions/${version}.json` : `https://rubygems.org/api/v1/gems/${name}.json`
      const { body } = await this.got(endpoint, options)
      dependencies = body.dependencies
    } catch (e) {
      this.log.error(`${e}, ${name}, ${version}`)
      // unable to resolve the given spec; no way to get the deps for this input
      return []
    }

    // Response from rubygems will include multiple "dependencies", most commonly "development" and "runtime"
    const dependencyKeys = Object.keys(dependencies)
    const depRequirements = dependencyKeys.reduce((allDeps, key) => {
      // For each depdency group, compile a complete list of deps
      const runtime = dependencies[key]
      return allDeps.concat(runtime.reduce((runtimeSpecificDeps, dep) => {
        // each dep is formatted like this
        /**
         * {
              "name": "activerecord",
              "requirements": "= 3.0.18"
          }

          OR 

          {
              "name": "activerecord",
              "requirements": ">= 3.0.18, < 4.0"
          }

          In the second case, we want to just adhere to the second operator (< 4.0)
        */
        const versionSplit = dep.requirements.split(' ')
        const versionSpec = versionSplit[versionSplit.length - 1]
        const operator = versionSplit[versionSplit.length - 2]
        const spec = {
          name: dep.name,
          versionSpec,
          operator,
          toString: () => `${dep.name}@${operator}${versionSpec}`
        }
        return runtimeSpecificDeps.concat(spec)
      }, []))
    }, [])

    if (!depRequirements || !depRequirements.length) return []

    return depRequirements
  }

  // input: output of getSpec
  // resolves the most suitable version to freeze given <name><operator><version>
  // for example: rubocop >= 3.0.0 would fetch all versions available, and select the highest version
  async resolve(pkgSpec) {
    const { name, operator, versionSpec: version } = pkgSpec

    // If operator is =, return name and version UNLESS version is latest, in which case we need to resolve
    // releases from ruby gems
    if ((operator === "==" || operator === '=') && version !== 'latest') {
      return { name, version }
    }

    if (!this.versionsCache.has(name)) {
      // Fetch all tags for a package from https://rubygems.org/api/v1/versions/[gem name].json . 
      // response will be an array of releases with a "number" key
      const options = { responseType: "json" }
      const { body } = await this.got(`https://rubygems.org/api/v1/versions/${name}.json`, options)

      // Grab releases and sort them greatest to least
      const releasesRes = body.map((rel) => rel.number)
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
      case '!=':
        release = releases.find(rel =>
          compareVersions(rel, version) !== 0
        )
        break
      case ">=":
        release = releases.find(rel =>
          compareVersions(rel, version) >= 0
        )
        break
      case ">":
        release = releases.find(rel =>
          compareVersions(rel, version) > 0
        )
        break
      case "<=":
        release = releases.find(rel =>
          compareVersions(rel, version) <= 0
        )
        break
      case "~>":
        // Fetch latest version under the next specified minor
        const versionComponents = version.split('.')
        // If length of the version components is 1, then fetch up to next major
        // If length of the version components is 2, then means fetch up until the next major
        // if length of the version components is 3, then it means fetch up to the next minor
        let nextVersion
        switch (versionComponents.length) {
          case 1:
            nextVersion = `${parseInt(versionComponents[0])+1}`
          case 2:
            nextVersion = `${parseInt(versionComponents[0])+1}.0`
            break
          default:
            nextVersion = `${versionComponents[0]}.${parseInt(versionComponents[1])+1}.0`
        }
        
        release = releases.find(rel =>
          compareVersions(rel, nextVersion) < 0
        )
        break
      case '<':
        release = releases.find(rel =>
          compareVersions(rel, version) < 0
        )
        break
      default:
        throw new Error(`Unable to parse version: ${operator} ${version}`)
    }

    if (!release) {
      throw new Error(`no version release that satisfies requirements: ${name} ${operator} ${version}`)
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

module.exports = RubyGemsDependencyResolver
