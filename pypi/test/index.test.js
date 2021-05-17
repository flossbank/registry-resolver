const test = require('ava')
const sinon = require('sinon')
const limit = require('call-limit')
const PipDependencyResolver = require('../')

test.before((t) => {
  sinon.stub(limit, 'promise')
})

test.beforeEach((t) => {
  t.context.log = { warn: sinon.stub(), error: sinon.stub() }
  t.context.pypi = new PipDependencyResolver({ log: t.context.log })
  t.context.pypi.got = sinon.stub()
})

test.after(() => {
  limit.promise.restore()
})

test('getManifestPatterns', (t) => {
  t.deepEqual(t.context.pypi.getManifestPatterns(), ['requirements.txt'])
})

test('extractDependenciesFromManifest', (t) => {
  const { pypi } = t.context
  const manifest = `
  aim-cli==2.1.3
  aimrecords==0.0.7
  alembic==1.1.0
  `

  const deps = pypi.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [
    'aim-cli==2.1.3',
    'aimrecords==0.0.7',
    'alembic==1.1.0'
  ])
})

test('extractDependenciesFromManifest | bad manifest', (t) => {
  const { pypi } = t.context
  const manifest = ''
  const deps = pypi.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [])
})

test('getSpec | returns obj if object passed in', (t) => {
  const currentSpec = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  t.deepEqual(t.context.pypi.getSpec(currentSpec), currentSpec)
})

test('getSpec | returns just name if name is just passed in', (t) => {
  const pkg = 'js-deep-equals'
  t.deepEqual(t.context.pypi.getSpec(pkg).toString(), 'js-deep-equals@')
})

test('getSpec | should parse out operator and version from pkg req input', (t) => {
  const pkg = 'js-deep-equals>=1.0.0     # for comparing objects deeply'
  t.deepEqual(t.context.pypi.getSpec(pkg).toString(), 'js-deep-equals@>=1.0.0')
})

test('getDependencies | returns empty dependencies of pkg from registry', async (t) => {
  t.context.pypi.resolve = sinon.stub().resolves({
    name: 'vscodium',
    verson: '1.0.0'
  })
  t.context.pypi.got.returns({
    body: {
      info: {
        requires_dist: []
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  const deps = await t.context.pypi.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns empty dependencies if resolve throws', async (t) => {
  t.context.pypi.resolve = sinon.stub().rejects('error')
  const pkg = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  const deps = await t.context.pypi.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns dependencies of pkg from registry', async (t) => {
  t.context.pypi.resolve = sinon.stub().resolves({
    name: 'vscodium',
    verson: '1.0.0'
  })
  t.context.pypi.got.returns({
    body: {
      info: {
        requires_dist: [
          'django (>=3.1.1)',
        ]
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  const deps = await t.context.pypi.getDependencies(pkg)
  t.deepEqual(deps[0].toString(), 'django@>=3.1.1')
})

test('getDependencies | returns "latests" dependencies of pkg from registry', async (t) => {
  // When resolve returns undefined version, resolver fetches latest version from pypi
  t.context.pypi.resolve = sinon.stub().resolves({
    name: 'vscodium',
    verson: undefined
  })
  t.context.pypi.got.returns({
    body: {
      info: {
        requires_dist: [
          'django (>=3.1.1)',
        ]
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  const deps = await t.context.pypi.getDependencies(pkg)
  t.deepEqual(deps[0].toString(), 'django@>=3.1.1')
})

test('resolve | return name and version if operator is ==', async (t) => {
  const pkg = t.context.pypi.getSpec('js-deep-equals==1.0.0')
  const res = await t.context.pypi.resolve(pkg)
  t.deepEqual(res, {
    name: 'js-deep-equals',
    version: '1.0.0'
  })
})

test('resolve | return name and version correctly for >=', async (t) => {
  t.context.pypi.got.resolves({
    body: {
      releases: {
        '3.1.1': '',
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals>=1.0.0')
  const res = await t.context.pypi.resolve(pkg)
  t.deepEqual(res, {
    name: 'js-deep-equals',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for ~= up to next minor', async (t) => {
  t.context.pypi.got.returns({
    body: {
      releases: {
        '3.1.1': '',
        '2.0.1': '',
        '2.1.1': ''
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals~=2.0.0')
  const res = await t.context.pypi.resolve(pkg)
  t.deepEqual(res, {
    name: 'js-deep-equals',
    version: '2.0.1'
  })
})

test('resolve | return name and version correctly for ~= up to next major', async (t) => {
  t.context.pypi.got.returns({
    body: {
      releases: {
        '3.1.1': '',
        '2.9.0': '',
        '2.1.0': ''
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals~=2.0')
  const res = await t.context.pypi.resolve(pkg)
  t.deepEqual(res, {
    name: 'js-deep-equals',
    version: '2.9.0'
  })
})

test('resolve | throws if no satisfying version found', async (t) => {
  t.context.pypi.got.returns({
    body: {
      releases: {
        '3.1.1': '',
        '2.9.0': '',
        '2.1.0': ''
      }
    }
  })
  const pkg = t.context.pypi.getSpec('js-deep-equals>=5.0.0')
  await t.throwsAsync(async () => await t.context.pypi.resolve(pkg))
})

