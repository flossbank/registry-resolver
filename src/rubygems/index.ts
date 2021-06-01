import got from 'got'
import { compare } from '@snyk/ruby-semver'
import limit from 'call-limit'

const compareVersions = (a: string, b: string): number => {
  const cmpRes = compare(a, b)
  // for some reason @snyk says they might return undefined from the above compare func
  // if that happens (it shouldn't), then we will consider the versions equal (:shrug:)
  if (typeof cmpRes === 'undefined') return 0
  return cmpRes
}

export interface RubyGemsDependencyResolverParams {
  log: Logger
  httpGet?: typeof got.get
}

export type RubyGemsDependencySpec = DependencySpec & {
  operator?: string
  versionSpec?: string
}

interface ResolvedSpec {
  name: string
  version: string
}

export interface RubyGemsPackageManifestDependencySpec {
  name: string
  requirements: string
}

export interface RubyGemsPackageManifest {
  dependencies?: {
    [depGroup: string]: RubyGemsPackageManifestDependencySpec[]
  }
}

interface RubyGemsPackageVersion {
  number: string
}

type RubyGemsVersionsResponse = RubyGemsPackageVersion[]

export class RubyGemsDependencyResolver implements DependencyResolver {
  private readonly log: Logger
  private readonly got: typeof got.get
  private versionsCache: Map<string, string[]>

  constructor ({ log, httpGet = got.get }: RubyGemsDependencyResolverParams) {
    this.log = log
    this.got = limit.promise(httpGet, 30)
    this.versionsCache = new Map()
  }

  init (): void {
    this.versionsCache = new Map()
  }

  // a blob-type string list that represents the search pattern
  // for this language/registry's manifest files
  // it will be matched with minimatch https://www.npmjs.com/package/minimatch
  getManifestPatterns (): string[] {
    return ['Gemfile']
  }

  // returns a string in the form of a top level dependency that specifies
  // the latest version of this package on the registry; for Ruby, not specifying
  // a version means you want the latest
  buildLatestSpec (pkgName: string): RawPkgSpec {
    return pkgName
  }

  // Def: given a raw file (i.e. the bytes of Gemfile), return a list ([]) of
  //  dependencies that are listed in the manifest file. The format of each entry in the list
  //  should be consumable (one at a time) by getSpec.
  extractDependenciesFromManifest ({ manifest }: PackageManifestInput): RawPkgSpec[] {
    // TODO: If we detect that the source of the manifest ISN"T rubygems.org, should we even parse the deps??

    // TODO: doesn't support `when '1.9.1'; gem 'ruby-debug-base19', '0.11.23'` syntax

    if (manifest === '') return []
    const extract = manifest.split('\n').reduce((acc: string[], line: string) => {
      /**
       * trim off leading and trailing whitespace
       * and lowercase the requirement to avoid duplication
       */
      line = line.trim().toLowerCase()
      /**
       * skip all blank lines
       */
      if (line === '') return acc
      /**
       * skip all lines that are comments
       */
      if (line.startsWith('#')) return acc
      /**
       * Add all lines that start with "gem" since we're including deps from every group
       */
      if (line.startsWith('gem')) {
        // Split on # and remove the comments at the end of any lines
        const lineWithoutComment = line.split('#').shift()
        if (typeof lineWithoutComment !== 'undefined') {
          return acc.concat(lineWithoutComment)
        }
      }
      return acc
    }, [])
    return extract
  }

  /**
   * - input: a single entry from extractDependenciesFromManifest, input format is of
   * "gem <name of gem>, "version (optional)", specifiers (optional)
   */
  getSpec (pkg: string): RubyGemsDependencySpec {
    // Version seems to always come after the gem name, if it is specified.
    const [namePart, ver] = pkg.split(',')
    // remove gem, trim off white space, remove quotes, now we have the name
    const name = (namePart ?? '').replace('gem', '').trim().replace(/'/g, '').replace(/"/g, '')

    // If there's nothing after the name, then return latest as version
    if (typeof ver === 'undefined' || ver === '') {
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
    const match = (ver ?? '').trim().match(re)
    const operator = match?.[2] ?? '='
    const version = match?.[3] ?? 'latest'

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
  async getDependencies (pkgSpec: RubyGemsDependencySpec): Promise<RubyGemsDependencySpec[]> {
    try {
      const { name, version } = await this.resolve(pkgSpec)

      const endpoint = typeof version === 'undefined' || version === ''
        ? `https://rubygems.org/api/v1/gems/${name}.json`
        : `https://rubygems.org/api/v2/rubygems/${name}/versions/${version}.json`
      const { body } = await this.got(endpoint, { responseType: 'json' })
      const { dependencies = {} } = body as RubyGemsPackageManifest

      // Response from RubyGems will include multiple "dependencies", most commonly "development" and "runtime"
      const dependencyKeys = Object.keys(dependencies) as Array<keyof typeof dependencies>
      const depRequirements = dependencyKeys.reduce((allDeps: RubyGemsDependencySpec[], key) => {
        // For each dependency group, compile a complete list of deps
        const groupedDepSpecs = dependencies[key] ?? []
        return allDeps.concat(groupedDepSpecs.reduce((groupedDeps: RubyGemsDependencySpec[], dep) => {
          // each dep is formatted like this
          /*
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
          let versionSpec = versionSplit[versionSplit.length - 1]
          let operator = versionSplit[versionSplit.length - 2]
          if (typeof versionSpec === 'undefined' || versionSpec === '') {
            this.log.warn(`Unable to determine version spec from ${dep.requirements} -- defaulting to latest`)
            versionSpec = 'latest'
          }
          if (typeof operator === 'undefined' || operator === '') {
            this.log.warn(`Unable to determine operator from ${dep.requirements} -- defaulting to '='`)
            operator = '='
          }

          const spec = {
            name: dep.name,
            versionSpec,
            operator,
            toString: () => `${dep.name}@${operator ?? '='}${versionSpec ?? 'latest'}`
          }
          return groupedDeps.concat(spec)
        }, []))
      }, [])

      return depRequirements
    } catch (e) {
      const { name, versionSpec } = pkgSpec
      this.log.error(e, `${name}, ${versionSpec ?? '<nullish version spec>}'}`)
      // unable to resolve the given spec; no way to get the deps for this input
      return []
    }
  }

  // resolves the most suitable version to freeze given <name><operator><version>
  // for example: rubocop >= 3.0.0 would fetch all versions available, and select the highest version
  private async resolve (pkgSpec: RubyGemsDependencySpec): Promise<ResolvedSpec> {
    const { name, operator, versionSpec: version } = pkgSpec

    // If operator is =, return name and version UNLESS version is latest, in which case we need to resolve
    // releases from ruby gems
    if ((operator === '==' || operator === '=') && version !== 'latest' && typeof version !== 'undefined') {
      return { name, version }
    }

    if (!this.versionsCache.has(name)) {
      // Fetch all tags for a package from https://rubygems.org/api/v1/versions/[gem name].json .
      // response will be an array of releases with a "number" key
      const { body = [] } = await this.got(`https://rubygems.org/api/v1/versions/${name}.json`, { responseType: 'json' })

      // Grab releases and sort them greatest to least
      const releasesRes = (body as RubyGemsVersionsResponse).map((rel) => rel.number)
        .sort(compareVersions)
        .reverse()

      this.versionsCache.set(name, releasesRes)
    }
    const releases = this.versionsCache.get(name) ?? []

    if (releases.length === 0) throw new Error('No releases found')

    // If version is latest, return the first element of the releases array, representing the latest release
    if (typeof version === 'undefined' || version === 'latest') {
      const latestVer = releases[0]
      if (typeof latestVer === 'undefined') throw new Error('No suitable release found')
      return { name, version: latestVer }
    }

    let release

    // Find the highest version out of the tags that satisfy the requirements
    switch (operator) {
      case '!=': {
        release = releases.find(rel =>
          compareVersions(rel, version) !== 0
        )
        break
      }
      case '>=': {
        release = releases.find(rel =>
          compareVersions(rel, version) >= 0
        )
        break
      }
      case '>': {
        release = releases.find(rel =>
          compareVersions(rel, version) > 0
        )
        break
      }
      case '<=': {
        release = releases.find(rel =>
          compareVersions(rel, version) <= 0
        )
        break
      }
      case '~>': {
        // Fetch latest version under the next specified minor
        const versionComponents = version.split('.')
        // If length of the version components is 1, then fetch up to next major
        // If length of the version components is 2, then means fetch up until the next major
        // if length of the version components is 3, then it means fetch up to the next minor
        let nextVersion: string
        switch (versionComponents.length) {
          case 1: {
            const currentMajor = versionComponents[0]
            if (typeof currentMajor !== 'undefined') {
              nextVersion = `${parseInt(currentMajor) + 1}`
            }
            break
          }
          case 2: {
            const currentMajor = versionComponents[0]
            if (typeof currentMajor !== 'undefined') {
              nextVersion = `${parseInt(currentMajor) + 1}.0`
            }
            break
          }
          default: {
            const currentMajor = versionComponents[0]
            const currentMinor = versionComponents[1]
            if (typeof currentMajor !== 'undefined' && typeof currentMinor !== 'undefined') {
              if (versionComponents.length > 1) {
                nextVersion = `${currentMajor}.${parseInt(currentMinor) + 1}.0`
              }
            }
            break
          }
        }

        release = releases.find(rel =>
          compareVersions(rel, nextVersion) < 0
        )
        break
      }
      case '<': {
        release = releases.find(rel =>
          compareVersions(rel, version) < 0
        )
        break
      }
      default: {
        throw new Error(`Unable to parse version: ${operator ?? '<undefined operator>'} ${version}`)
      }
    }

    if (typeof release === 'undefined') {
      throw new Error(`no version release that satisfies requirements: ${name} ${operator} ${version}`)
    }

    return { name, version: release }
  }

  /**
   * - input: same as getSpec -- a "manifest-style" package specifier (e.g. sodium-native@^1.1.1)
   *- output: a "locked" package version string -- with no ambiguity (e.g. sodium-native@1.4.0)
   * this is done by calling the registry
   */
  async resolveToSpec (pkg: string): Promise<RawPkgSpec> {
    try {
      const spec = this.getSpec(pkg)
      const { name, version } = await this.resolve(spec)
      return `${name}==${version}`
    } catch {}
    // Fall back to just returning the input
    return pkg
  }
}

export default RubyGemsDependencyResolver
