const test = require('ava')
const sinon = require('sinon')
const RubyGemsDependencyResolver = require('../')

test.beforeEach((t) => {
  t.context.log = { warn: sinon.stub(), error: sinon.stub() }
  t.context.rubygems = new RubyGemsDependencyResolver({ log: t.context.log })
  t.context.rubygems.got = sinon.stub()
})

test('getManifestPatterns', (t) => {
  t.deepEqual(t.context.rubygems.getManifestPatterns(), ['Gemfile'])
})

test('init | clears cache', (t) => {
  t.context.rubygems.versionsCache = new Map()
  t.context.rubygems.versionsCache.set('key', 'val')
  t.deepEqual(t.context.rubygems.versionsCache.size, 1)
  t.context.rubygems.init()
  t.deepEqual(t.context.rubygems.versionsCache.size, 0)
})

test('extractDependenciesFromManifest', (t) => {
  const { rubygems } = t.context
  const manifest = `
  gem 'sqlite3'
  # Use Puma as the app server
  gem 'puma', '~> 3.7'
  # Use SCSS for stylesheets
  gem 'sass-rails', '~> 5.0'
  poopy unparseable line
  `

  const deps = rubygems.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [
    "gem 'sqlite3'",
    "gem 'puma', '~> 3.7'",
    "gem 'sass-rails', '~> 5.0'"
  ])
})

test('extractDependenciesFromManifest | bad manifest', (t) => {
  const { rubygems } = t.context
  const manifest = ''
  const deps = rubygems.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [])
})

test('getSpec | returns just name if name is just passed in', (t) => {
  const pkg = "gem 'rubocop'"
  t.deepEqual(t.context.rubygems.getSpec(pkg).toString(), 'rubocop@')
})

test('getSpec | returns obj immediately if obj passed in', (t) => {
  const pkg = "gem 'rubocop'"
  const specObj = t.context.rubygems.getSpec(pkg)
  t.deepEqual(t.context.rubygems.getSpec(specObj).toString(), 'rubocop@')
})

test('getSpec | should parse out operator and version from pkg req input', (t) => {
  const pkg = "gem 'rubocop', '~> 3.7'"
  t.deepEqual(t.context.rubygems.getSpec(pkg).toString(), 'rubocop@~>3.7')
})

test('getDependencies | returns empty dependencies of pkg from registry', async (t) => {
  t.context.rubygems.resolve = sinon.stub().resolves({
    name: 'vscodium',
    verson: '1.0.0'
  })
  t.context.rubygems.got.returns({
    body: {
      dependencies: {
        development: [],
        runtime: []
      }
    }
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop'")
  const deps = await t.context.rubygems.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns empty dependencies if resolve throws', async (t) => {
  t.context.rubygems.resolve = sinon.stub().rejects('error')
  const pkg = t.context.rubygems.getSpec("gem 'rubocop'")
  const deps = await t.context.rubygems.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns dependencies of pkg from registry', async (t) => {
  t.context.rubygems.resolve = sinon.stub().resolves({
    name: 'vscodium',
    version: '1.0.0'
  })
  t.context.rubygems.got.returns({
    body: {
      dependencies: {
        development: [],
        runtime: [
          {
            name: 'actionmailer',
            requirements: '= 3.0.18'
          }
        ]
      }
    }
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 3.0.0'")
  const deps = await t.context.rubygems.getDependencies(pkg)
  t.deepEqual(deps[0].toString(), 'actionmailer@=3.0.18')
})

test('getDependencies | returns "latests" dependencies of pkg from registry', async (t) => {
  // When resolve returns undefined version, resolver fetches latest version from rubygems
  t.context.rubygems.resolve = sinon.stub().resolves({
    name: 'vscodium',
    verson: undefined
  })
  t.context.rubygems.got.returns({
    body: {
      dependencies: {
        development: [
          {
            name: 'actionmailer',
            requirements: '= 3.0.18'
          }
        ],
        runtime: []
      }
    }
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop'")
  const deps = await t.context.rubygems.getDependencies(pkg)
  t.deepEqual(deps[0].toString(), 'actionmailer@=3.0.18')
})

test('resolve | return name and version if operator isn\'t there', async (t) => {
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '3.1.1'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | use cache on second request', async (t) => {
  t.context.rubygems.got = sinon.stub().resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 3.0.0'")
  await t.context.rubygems.resolve(pkg)
  t.true(t.context.rubygems.got.calledOnce)
  t.context.rubygems.got.reset()
  await t.context.rubygems.resolve(pkg)
  t.true(t.context.rubygems.got.notCalled)
})

test('resolve | no releases returned', async (t) => {
  t.context.rubygems.got = sinon.stub().resolves({
    body: []
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 3.0.0'")
  await t.throwsAsync(async () => await t.context.rubygems.resolve(pkg))
})

test('resolve | return name and version correctly for >=', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for !=', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.0.0'
      },
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '!= 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for <=', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '3.0.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '<= 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.0.0'
  })
})

test('resolve | return name and version correctly for >', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.0.0'
      },
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '> 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for latest', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for <', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '3.0.0'
      },
      {
        number: '2.0.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '< 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '2.0.0'
  })
})

test('resolve | default case | wonky input', async (t) => {
  t.context.rubygems.got.resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '=>>> 1.0.0'")
  pkg.operator = '@#$'
  pkg.versionSpec = '1.0.0'
  await t.throwsAsync(async () => await t.context.rubygems.resolve(pkg))
})

test('resolve | return name and version correctly for ~> up to next minor', async (t) => {
  t.context.rubygems.got.returns({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '2.0.1'
      },
      {
        number: '2.1.1'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '~> 2.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '2.0.1'
  })
})

test('resolve | return name and version correctly for ~> up to next major', async (t) => {
  t.context.rubygems.got.returns({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '2.9.0'
      },
      {
        number: '2.1.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '~> 2.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '2.9.0'
  })
})

test('resolve | return name and version correctly for ~> up to next major with single version', async (t) => {
  t.context.rubygems.got.returns({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '2.9.0'
      },
      {
        number: '2.1.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '~> 2'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '2.9.0'
  })
})

test('resolve | throw | no version satisfying', async (t) => {
  t.context.rubygems.got.returns({
    body: [
      {
        number: '2.1.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '< 2.0'")
  await t.throwsAsync(async () => await t.context.rubygems.resolve(pkg))
})

test('resolve | throws if no satisfying version found', async (t) => {
  t.context.rubygems.got.returns({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '2.9.0'
      },
      {
        number: '2.1.0'
      }
    ]
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 4.0.0'")
  await t.throwsAsync(async () => await t.context.rubygems.resolve(pkg))
})

test('resolveToSpec', async (t) => {
  t.context.rubygems.resolve = sinon.stub().resolves({
    name: 'rubocop',
    version: '3.1.1'
  })
  const spec = await t.context.rubygems.resolveToSpec("gem 'rubocop', '>= 4.0.0'")
  t.deepEqual(spec, 'rubocop==3.1.1')
})

test('resolveToSpec | throws', async (t) => {
  t.context.rubygems.resolve = sinon.stub().throws()
  const spec = await t.context.rubygems.resolveToSpec("gem 'rubocop', '>= 4.0.0'")
  t.deepEqual(spec, "gem 'rubocop', '>= 4.0.0'")
})

test('buildLatestSpec', (t) => {
  t.is(t.context.rubygems.buildLatestSpec('sodium'), 'sodium')
})
