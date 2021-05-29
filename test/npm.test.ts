import anyTest, { TestInterface } from 'ava'
import npa from 'npm-package-arg'
import { NpmDependencyResolver } from '../src/npm/index.js'
import sinon, { SinonStub } from 'sinon'

const test = anyTest as TestInterface<{
  log: Logger
  npm: NpmDependencyResolver

  getManifestStub: SinonStub
}>

test.beforeEach((t) => {
  t.context.getManifestStub = sinon.stub()

  t.context.log = { info: () => {}, warn: () => {} }
  t.context.npm = new NpmDependencyResolver({
    log: t.context.log, getManifest: t.context.getManifestStub
  })
})

test('getManifestPatterns', (t) => {
  t.deepEqual(t.context.npm.getManifestPatterns(), ['package.json'])
})

test('extractDependenciesFromManifest', (t) => {
  const { npm } = t.context
  const manifest = JSON.stringify({
    dependencies: {
      'js-deep-equals': '1.0.0'
    },
    devDependencies: {
      standard: '^12.1.1'
    }
  })

  const deps = npm.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [
    'js-deep-equals@1.0.0',
    'standard@^12.1.1'
  ])
})

test('extractDependenciesFromManifest | bad manifest', (t) => {
  const { npm } = t.context
  const manifest = 'undefined'
  const deps = npm.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [])
})

test('getSpec | calls npa', (t) => {
  t.deepEqual(t.context.npm.getSpec('js-deep-equals'), npa('js-deep-equals'))
})

test('getDependencies | returns dependencies of pkg from registry', async (t) => {
  t.context.getManifestStub.returns({
    name: 'js-deep-equals',
    version: '2.1.1',
    dependencies: { murmurhash: '0.0.2' },
    devDependencies: {
      ava: '^0.25.0',
      coveralls: '^3.0.1',
      'lodash.isequal': '^4.5.0',
      nyc: '^11.7.3'
    },
    directories: { test: 'test' }
  })
  const pkg = npa('js-deep-equals@2.1.1')
  const deps = await t.context.npm.getDependencies(pkg)
  t.deepEqual(deps, [npa.resolve('murmurhash', '0.0.2') as Dependency])
})

test('getDependencies | a pkg that is not on the registry', async (t) => {
  const pkg = npa.resolve('blah', 'git+https://github.com/stripedpajamas/blah')
  const deps = await t.context.npm.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | filters out dependencies that are invalid', async (t) => {
  t.context.getManifestStub.returns({
    name: 'js-deep-equals',
    version: '2.1.1',
    dependencies: { baddy: 'ipfs://abcd', murmurhash: '0.0.2' }
  })
  const deps = await t.context.npm.getDependencies(npa('js-deep-equals'))
  t.deepEqual(deps, [npa.resolve('murmurhash', '0.0.2') as Dependency])
})

test('getDependencies | gracefully handles bad manifest', async (t) => {
  t.context.getManifestStub.returns({
    name: 'js-deep-equals',
    version: '2.1.1'
    // no .dependencies
  })

  const pkg = npa('js-deep-equals@2.1.1')
  const deps = await t.context.npm.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns no dependencies if registry call fails', async (t) => {
  t.context.getManifestStub.rejects()

  const pkg = npa('js-deep-equals@2.1.1')
  const deps = await t.context.npm.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('resolveToSpec | returns proper spec from registry', async (t) => {
  t.context.getManifestStub.returns({
    name: 'js-deep-equals',
    version: '2.1.1',
    dependencies: { murmurhash: '0.0.2' },
    devDependencies: {
      ava: '^0.25.0',
      coveralls: '^3.0.1',
      'lodash.isequal': '^4.5.0',
      nyc: '^11.7.3'
    },
    directories: { test: 'test' }
    // there is a big signature included in the manifest as well, but omitting here
  })

  t.is(await t.context.npm.resolveToSpec('js-deep-equals'), 'js-deep-equals@2.1.1')
})

test('resolveToSpec | returns input if registry does not help', async (t) => {
  t.context.getManifestStub.returns({})

  t.is(await t.context.npm.resolveToSpec('js-deep-equals'), 'js-deep-equals')
})

test('buildLatestSpec', (t) => {
  t.is(t.context.npm.buildLatestSpec('sodium'), 'sodium@latest')
})
