const test = require('ava')
const sinon = require('sinon')
const RubyGemsDependencyResolver = require('../')

test.beforeEach((t) => {
  t.context.log = { warn: sinon.stub(), error: sinon.stub() }
  t.context.rubygems = new RubyGemsDependencyResolver({ log: t.context.log })
  t.context.rubygems.got = sinon.stub()
})

test('getManifestPatterns', (t) => {
  t.deepEqual(t.context.rubygems.getManifestPatterns(), ['^Gemfile$'])
})

test('extractDependenciesFromManifest', (t) => {
  const { rubygems } = t.context
  const manifest = `
  gem 'sqlite3'
  # Use Puma as the app server
  gem 'puma', '~> 3.7'
  # Use SCSS for stylesheets
  gem 'sass-rails', '~> 5.0'
  `

  const deps = rubygems.extractDependenciesFromManifest({ manifest })

  t.deepEqual(deps, [
    "gem 'sqlite3'",
    "gem 'puma', '~> 3.7'",
    "gem 'sass-rails', '~> 5.0'",
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
    body: JSON.stringify({
      dependencies: {
        development: [],
        runtime: []
      }
    })
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
    verson: '1.0.0'
  })
  t.context.rubygems.got.returns({
    body: JSON.stringify({
      dependencies: {
        development: [],
        runtime: [
          {
            "name": "actionmailer",
            "requirements": "= 3.0.18"
          }
        ]
      }
    })
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
    body: JSON.stringify({
      dependencies: {
        development: [
          {
            "name": "actionmailer",
            "requirements": "= 3.0.18"
          }
        ],
        runtime: []
      }
    })
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

test('resolve | return name and version correctly for >=', async (t) => {
  t.context.rubygems.got.resolves({
    body: JSON.stringify([
      {
        number: '3.1.1'
      }
    ])
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 3.0.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '3.1.1'
  })
})

test('resolve | return name and version correctly for ~> up to next minor', async (t) => {
  t.context.rubygems.got.returns({
    body: JSON.stringify([
      {
        number: '3.1.1'
      },
      {
        number: '2.0.1'
      },
      {
        number: '2.1.1'
      }
    ])
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
    body: JSON.stringify([
      {
        number: '3.1.1'
      },
      {
        number: '2.9.0'
      },
      {
        number: '2.1.0'
      }
    ])
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '~> 2.0'")
  const res = await t.context.rubygems.resolve(pkg)
  t.deepEqual(res, {
    name: 'rubocop',
    version: '2.9.0'
  })
})

test('resolve | throws if no satisfying version found', async (t) => {
  t.context.rubygems.got.returns({
    body: JSON.stringify([
      {
        number: '3.1.1'
      },
      {
        number: '2.9.0'
      },
      {
        number: '2.1.0'
      }
    ])
  })
  const pkg = t.context.rubygems.getSpec("gem 'rubocop', '>= 4.0.0'")
  await t.throwsAsync(async () => await t.context.rubygems.resolve(pkg))
})
