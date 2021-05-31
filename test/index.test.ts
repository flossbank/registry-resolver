import anyTest, { TestInterface } from 'ava'
import { RegistryResolver } from '../src/index.js'
import { NoopLogger, StubbedRegistryResolver } from './_helpers.js'

const test = anyTest as TestInterface<{
  resolver: RegistryResolver

  internalResolver: StubbedRegistryResolver
}>

test.beforeEach((t) => {
  t.context.internalResolver = new StubbedRegistryResolver()
  t.context.resolver = new RegistryResolver({
    log: new NoopLogger(),
    registryOverrides: {
      zig: {
        zzz: t.context.internalResolver
      }
    }
  })
})

test('computePackageWeight | unsupported registry', async (t) => {
  const { resolver } = t.context
  await t.throwsAsync(async () => await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'scala',
    registry: 'mitski',
    noCompList: new Set(['react'])
  }))
})

test('computePackageWeight | calls pkg reg init if applicable', async (t) => {
  const { resolver, internalResolver } = t.context
  internalResolver.setDependencies('js-deep-equals', [])
  await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals'],
    language: 'zig',
    registry: 'zzz'
  })

  t.true(internalResolver.getInit().calledOnce)
})

test('computePackageWeight | computes', async (t) => {
  // a fake testing graph:
  /*
      js-deep-equals  web-app-thing
        |               |
    murmurhash@0.0.2   react
                        |
                      murmurhash@0.0.1
  */
  // with the above graph, we expect the following:
  //  1. the initial weight (1) is split between JSDE and WAP (0.5, 0.5)
  //  2. their respective weights are split in half with their immediate deps (mmh: 0.25, react: 0.25)
  //  3. react's weight is passed 100% to its dep (mmh: 0.25 + 0.25)
  //  4. a map is outputted: {
  //        js-deep-equals: 0.25,
  //        web-app-thing: 0.25,
  //        murmurhash: 0.25 + 0.25
  //        [react not here because it is in the no-comp list]
  //     }
  const { resolver, internalResolver } = t.context

  internalResolver.setDependencies('js-deep-equals', ['murmurhash'])
  internalResolver.setDependencies('murmurhash', [])
  internalResolver.setDependencies('web-app-thing', ['react'])
  internalResolver.setDependencies('react', ['murmurhash'])

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  })

  t.is(packageWeightMap.get('js-deep-equals'), 0.25)
  t.is(packageWeightMap.get('web-app-thing'), 0.25)
  t.is(packageWeightMap.get('murmurhash'), 0.5)
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | npm | handles no-comp pkgs with no deps', async (t) => {
  // in this test, react is marked as no-comp and it has no deps:
  // there are two top level deps; they initially get 0.5 each
  // js-deep-equals splits its half with murmurhash, so 0.25 to jde and 0.25 to mmh
  // web-app-thing splits its half with react and murmurhash, but react is no-comp
  // and in this case has no deps, so it's as if web-app-thing depends only on murmur;
  // so web-app-thing should get 0.25 and murmurhash should get another 0.25;
  // jde: 0.25
  // wat: 0.25
  // mmh: 0.5
  const { resolver, internalResolver } = t.context

  internalResolver.setDependencies('js-deep-equals', ['murmurhash'])
  internalResolver.setDependencies('murmurhash', [])
  internalResolver.setDependencies('web-app-thing', ['react', 'murmurhash'])
  internalResolver.setDependencies('react', [])

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  })

  t.is(packageWeightMap.get('js-deep-equals'), 0.25)
  t.is(packageWeightMap.get('web-app-thing'), 0.25)
  t.is(packageWeightMap.get('murmurhash'), 0.5)
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | npm | defers to cache for no-comp deps', async (t) => {
  const { resolver, internalResolver } = t.context

  internalResolver.setDependencies('js-deep-equals', ['intermediate'])
  internalResolver.setDependencies('intermediate', ['react'])
  internalResolver.setDependencies('web-app-thing', ['react'])
  internalResolver.setDependencies('react', [])

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  })
  t.is(internalResolver.getDepCallCount.get('react'), 1)

  t.is(packageWeightMap.get('js-deep-equals'), 0.25)
  t.is(packageWeightMap.get('intermediate'), 0.25)
  t.is(packageWeightMap.get('web-app-thing'), 0.5)
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | epsilon stops computation', async (t) => {
  const { resolver, internalResolver } = t.context

  internalResolver.setDependencies('js-deep-equals', ['murmurhash'])
  internalResolver.setDependencies('murmurhash', [])
  internalResolver.setDependencies('web-app-thing', ['react'])
  internalResolver.setDependencies('react', ['murmurhash'])

  resolver.setEpsilon(0.5)

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  })

  // with an epsilon of 0.5, only top level is hit
  t.is(packageWeightMap.get('js-deep-equals'), 0.5)
  t.is(packageWeightMap.get('web-app-thing'), 0.5)
  t.false(packageWeightMap.has('murmurhash'))
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | epsilon stops computation (no comp path)', async (t) => {
  const { resolver, internalResolver } = t.context

  internalResolver.setDependencies('react', [])
  resolver.setEpsilon(1.1) // everything is ignored
  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['react'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  })

  t.is(packageWeightMap.size, 0)
})

test('computePackageWeight | no top level packages', async (t) => {
  t.deepEqual(await t.context.resolver.computePackageWeight({
    topLevelPackages: [],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set(['react'])
  }), new Map())
})

test('computePackageWeight | invalid spec', async (t) => {
  const { resolver } = t.context
  t.deepEqual(await resolver.computePackageWeight({
    topLevelPackages: ['invalid-spec'],
    language: 'zig',
    registry: 'zzz',
    noCompList: new Set()
  }), new Map())
})

test('getSupportedRegistry | invalid lang', (t) => {
  const { resolver } = t.context
  t.is(resolver.getSupportedRegistry({
    language: 'haskell',
    registry: 'papajohns.com'
  }), null)
})

test('getSupportedRegistry | invalid registry', (t) => {
  const { resolver } = t.context
  t.is(resolver.getSupportedRegistry({
    language: 'javascript',
    registry: 'papajohns.com'
  }), null)
})

test('resolveToSpec | invalid registry', async (t) => {
  const { resolver } = t.context
  await t.throwsAsync(resolver.resolveToSpec({
    packages: ['a'],
    language: 'javascript',
    registry: 'blah.blah.com'
  }))
})

test('resolveToSpec | success', async (t) => {
  const { resolver, internalResolver } = t.context
  internalResolver.getResolveToSpec().resolves('a-very-resolved-spec')
  const res = await resolver.resolveToSpec({
    packages: ['a'],
    language: 'zig',
    registry: 'zzz'
  })
  t.deepEqual(res, ['a-very-resolved-spec'])
})

test('buildLatestSpec', (t) => {
  const { resolver } = t.context

  const spec = resolver.buildLatestSpec('asdf', { language: 'zig', registry: 'zzz' })
  t.is(spec, 'asdf@latest&greatest')
})

test('buildLatestSpec | invalid lang reg combo', (t) => {
  const { resolver } = t.context

  t.throws(() => resolver.buildLatestSpec('asdf', { language: 'papascript', registry: 'npm' }))
})

test('getSupportedManifestPatterns', (t) => {
  const { resolver } = t.context

  const supportedPatterns = resolver.getSupportedManifestPatterns()
  t.deepEqual(supportedPatterns, [{
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }, {
    language: 'ruby',
    patterns: ['Gemfile'],
    registry: 'rubygems'
  }, {
    language: 'zig',
    patterns: [],
    registry: 'zzz'
  }])
})

test('extractDependenciesFromManifests', (t) => {
  const { resolver } = t.context
  const manifests = [
    {
      language: 'javascript',
      registry: 'npm',
      manifest: JSON.stringify({ dependencies: { standard: '12.0.1' } })
    },
    {
      language: 'javascript',
      registry: 'npm',
      manifest: JSON.stringify({ dependencies: { 'js-deep-equals': '1.1.1' } })
    },
    {
      language: 'javascript',
      registry: 'the-new-javascript-registry',
      manifest: JSON.stringify({ dependencies: { 'something-irrelevant': '1.1.1' } })
    },
    {
      language: 'php',
      registry: 'idk',
      manifest: 'asdf'
    }
  ]

  const deps = resolver.extractDependenciesFromManifests(manifests)
  t.deepEqual(deps, [
    {
      language: 'javascript',
      registry: 'npm',
      deps: ['standard@12.0.1', 'js-deep-equals@1.1.1']
    },
    {
      language: 'javascript',
      registry: 'the-new-javascript-registry',
      deps: []
    },
    {
      language: 'php',
      registry: 'idk',
      deps: []
    }
  ])
})
