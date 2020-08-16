const test = require('ava')
const sinon = require('sinon')
const npa = require('npm-package-arg')
const RegistryResolver = require('../')

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

test('computePackageWeight | unsupported registry', async (t) => {
  const { resolver } = t.context
  await t.throwsAsync(() => resolver.computePackageWeight({
    topLevelPackages: ['js-deep-equals', 'web-app-thing'],
    language: 'scala',
    registry: 'mitski',
    noCompList: new Set(['react'])
  }))
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
