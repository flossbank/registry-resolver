import test from 'ava'
import sinon from 'sinon'
import npa from 'npm-package-arg'
import * as RegistryResolver from '../index.js'
console.error(RegistryResolver)

test.before(() => {
  sinon.stub(console, 'log')
})

test.after(() => {
  console.log.restore()
})

test.beforeEach((t) => {
  const log = { log: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
  t.context.resolver = new RegistryResolver({ log })
})

test('log defaults to console', (t) => {
  const rr = new RegistryResolver({})
  t.deepEqual(rr.log, console)
})

test('computePackageWeight | unsupported registry', async (t) => {
  const { resolver } = t.context
  await t.throwsAsync(() => resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'scala',
    registry: 'mitski',
    noCompList: new Set(['react'])
  }))
})

test('computePackageWeight | calls pkg reg init if applicable', async (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.init = sinon.stub()
  resolver.registries.javascript.npm.getSpec = npa
  resolver.registries.javascript.npm.getDependencies = () => []
  resolver.epsilon = 0.01

  await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals'],
    language: 'javascript',
    registry: 'npm'
  })

  t.true(resolver.registries.javascript.npm.init.calledOnce)
})

test('computePackageWeight | npm | computes', async (t) => {
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
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = npa
  resolver.registries.javascript.npm.getDependencies = (pkg) => {
    if (pkg.name === 'js-deep-equals') {
      return [npa('murmurhash@0.0.2')]
    }
    if (pkg.name === 'murmurhash') {
      return []
    }
    if (pkg.name === 'web-app-thing') {
      return [npa('react@0.0.0')]
    }
    if (pkg.name === 'react') {
      return [npa('murmurhash@0.0.2')]
    }
  }
  resolver.epsilon = 0.01

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'javascript',
    registry: 'npm',
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
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = npa
  resolver.registries.javascript.npm.getDependencies = (pkg) => {
    if (pkg.name === 'js-deep-equals') {
      return [npa('murmurhash@0.0.2')]
    }
    if (pkg.name === 'murmurhash') {
      return []
    }
    if (pkg.name === 'web-app-thing') {
      return [npa('react@0.0.0'), npa('murmurhash@0.0.2')]
    }
    if (pkg.name === 'react') {
      return []
    }
  }
  resolver.epsilon = 0.01

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set(['react'])
  })

  t.is(packageWeightMap.get('js-deep-equals'), 0.25)
  t.is(packageWeightMap.get('web-app-thing'), 0.25)
  t.is(packageWeightMap.get('murmurhash'), 0.5)
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | npm | defers to cache for no-comp deps', async (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = npa

  let reactDepCallCount = 0
  resolver.registries.javascript.npm.getDependencies = (pkg) => {
    if (pkg.name === 'js-deep-equals') {
      return [npa('intermediate@1.0.1')]
    }
    if (pkg.name === 'intermediate') {
      return [npa('react@0.0.0')]
    }
    if (pkg.name === 'web-app-thing') {
      return [npa('react@0.0.0')]
    }
    if (pkg.name === 'react') {
      reactDepCallCount++
      return []
    }
  }
  resolver.epsilon = 0.01

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set(['react'])
  })
  t.is(reactDepCallCount, 1)

  t.is(packageWeightMap.get('js-deep-equals'), 0.25)
  t.is(packageWeightMap.get('intermediate'), 0.25)
  t.is(packageWeightMap.get('web-app-thing'), 0.5)
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | epsilon stops computation', async (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = npa
  resolver.registries.javascript.npm.getDependencies = (pkg) => {
    if (pkg.name === 'js-deep-equals') {
      return [npa('murmurhash@0.02')]
    }
    if (pkg.name === 'murmurhash') {
      return []
    }
    if (pkg.name === 'web-app-thing') {
      return [npa('react@0.0.0')]
    }
    if (pkg.name === 'react') {
      return [npa('murmurhash@0.02')]
    }
  }
  resolver.epsilon = 0.5

  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals@latest', 'web-app-thing@1.0.1'],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set(['react'])
  })

  // with an epsilon of 0.5, only top level is hit
  t.is(packageWeightMap.get('js-deep-equals'), 0.5)
  t.is(packageWeightMap.get('web-app-thing'), 0.5)
  t.false(packageWeightMap.has('murmurhash'))
  t.false(packageWeightMap.has('react'))
})

test('computePackageWeight | epsilon stops computation (no comp path)', async (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = npa
  resolver.registries.javascript.npm.getDependencies = (pkg) => {
    if (pkg.name === 'react') {
      return []
    }
  }
  resolver.epsilon = 1.1 // everything is ignored
  const packageWeightMap = await resolver.computePackageWeight({
    topLevelPackages: ['react'],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set(['react'])
  })

  t.is(packageWeightMap.size, 0)
})

test('computePackageWeight | no top level packages', async (t) => {
  t.deepEqual(await t.context.resolver.computePackageWeight({
    topLevelPackages: [],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set(['react'])
  }), new Map())
})

test('computePackageWeight | invalid spec', async (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.getSpec = () => { throw new Error('invalid spec') }
  t.deepEqual(await resolver.computePackageWeight({
    topLevelPackages: ['react^15'],
    language: 'javascript',
    registry: 'npm',
    noCompList: new Set()
  }), new Map())
})

test('getSupportedRegistry | missing param', (t) => {
  const { resolver } = t.context
  t.false(resolver.getSupportedRegistry({
    language: 'haskell'
  }))
})

test('getSupportedRegistry | invalid lang', (t) => {
  const { resolver } = t.context
  t.false(resolver.getSupportedRegistry({
    language: 'haskell',
    registry: 'papajohns.com'
  }))
})

test('getSupportedRegistry | invalid registry', (t) => {
  const { resolver } = t.context
  t.is(resolver.getSupportedRegistry({
    language: 'javascript',
    registry: 'papajohns.com'
  }), undefined)
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
  const { resolver } = t.context
  resolver.registries.javascript.npm.resolveToSpec = () => 'a@1.0.0'
  const res = await resolver.resolveToSpec({
    packages: ['a'],
    language: 'javascript',
    registry: 'npm'
  })
  t.deepEqual(res, ['a@1.0.0'])
})

test('buildLatestSpec', (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.buildLatestSpec = () => 'validspec'

  const spec = resolver.buildLatestSpec('asdf', { language: 'javascript', registry: 'npm' })
  t.is(spec, 'validspec')
})

test('buildLatestSpec | invalid lang reg combo', (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.buildLatestSpec = () => 'validspec'

  t.throws(() => resolver.buildLatestSpec('asdf', { language: 'papascript', registry: 'npm' }))
})

test('getSupportedManifestPatterns', (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.getManifestPatterns = () => ['package.json']

  const supportedPatterns = resolver.getSupportedManifestPatterns()
  t.deepEqual(supportedPatterns, [{
    registry: 'npm',
    language: 'javascript',
    patterns: ['package.json']
  }, {
    language: 'ruby',
    patterns: ['Gemfile'],
    registry: 'rubygems'
  }])
})

test('extractDependenciesFromManifests', (t) => {
  const { resolver } = t.context
  resolver.registries.javascript.npm.extractDependenciesFromManifest = sinon.stub()
    .onFirstCall().returns(['standard@12.0.1'])
    .onSecondCall().returns(['js-deep-equals@1.1.1'])

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
