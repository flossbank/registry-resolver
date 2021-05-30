import anyTest, { TestInterface } from 'ava'
import sinon, { SinonStub } from 'sinon'
import { RubyGemsDependencyResolver } from '../src/rubygems/index.js'
import { NoopLogger } from './_helpers.js'

const test = anyTest as TestInterface<{
  rubygems: RubyGemsDependencyResolver

  httpGetStub: SinonStub
}>

test.beforeEach((t) => {
  t.context.httpGetStub = sinon.stub()

  t.context.rubygems = new RubyGemsDependencyResolver({
    log: new NoopLogger(),
    httpGet: t.context.httpGetStub
  })
})

test('getManifestPatterns', (t) => {
  t.deepEqual(t.context.rubygems.getManifestPatterns(), ['Gemfile'])
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

test('getSpec | should parse out operator and version from pkg req input', (t) => {
  const pkg = "gem 'rubocop', '~> 3.7'"
  t.deepEqual(t.context.rubygems.getSpec(pkg).toString(), 'rubocop@~>3.7')
})

test('getDependencies | returns empty dependencies of pkg from registry', async (t) => {
  const { httpGetStub } = t.context

  // resolve() calls registry for list of versions bc we have not specified a version
  httpGetStub.onCall(0).resolves({
    body: [{
      number: '1.0.0' // this will be `latest`
    }]
  })

  // getDependencies() calls registry for deps of resolved version
  httpGetStub.onCall(1).resolves({
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
  const { httpGetStub } = t.context
  httpGetStub.rejects('call to registry failed')

  const pkg = t.context.rubygems.getSpec("gem 'rubocop'")
  const deps = await t.context.rubygems.getDependencies(pkg)
  t.deepEqual(deps, [])
})

test('getDependencies | returns dependencies of pkg from registry', async (t) => {
  const { httpGetStub } = t.context

  // resolve() calls registry for list of versions bc we need to determine what is >= 3.0.0
  httpGetStub.onCall(0).resolves({
    body: [{
      number: '1.0.0' // not this one
    }, {
      number: '4.0.0' // this one
    }]
  })

  // getDependencies() calls registry for deps of resolved version
  httpGetStub.onCall(1).resolves({
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
  t.deepEqual(deps.map(dep => dep.toString()), ['actionmailer@=3.0.18'])
})

test('pkg resolution | operator defaults to =', async (t) => {
  const { httpGetStub, rubygems } = t.context

  httpGetStub.onCall(0).resolves({
    body: [
      { number: '3.1.0' },
      { number: '3.1.1' },
      { number: '3.1.2' },
      { number: '3.1.3' },
    ]
  })

  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '3.1.1'")
  t.is(resolved, 'rubocop==3.1.1')
})

test('pkg resolution | use cache on second request & init clears cache', async (t) => {
  const { httpGetStub, rubygems } = t.context

  httpGetStub.onCall(0).resolves({
    body: [
      { number: '3.1.0' },
      { number: '3.1.1' },
      { number: '3.1.2' },
      { number: '3.1.3' },
    ]
  })

  let resolved = await rubygems.resolveToSpec("gem 'rubocop', '>= 3.0.0'")
  t.is(resolved, 'rubocop==3.1.3')

  resolved = await rubygems.resolveToSpec("gem 'rubocop', '>= 3.1.2'")
  t.is(resolved, 'rubocop==3.1.3')

  t.true(httpGetStub.calledOnce)

  httpGetStub.resetHistory()
  rubygems.init() // should clear the versions cache

  // make the first call again
  resolved = await rubygems.resolveToSpec("gem 'rubocop', '>= 3.0.0'")
  t.is(resolved, 'rubocop==3.1.3')

  // and the HTTP call should have been re-made
  t.true(httpGetStub.calledOnce)
})

test('pkg resolution | no releases returned', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: []
  })
  // bc resolve() throws, resolveToSpec() will return its input
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '>= 3.0.0'")
  t.is(resolved, "gem 'rubocop', '>= 3.0.0'")
})

test('pkg resolution | return name and version correctly for >=', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '>= 3.0.0'")
  t.is(resolved, 'rubocop==3.1.1')
})

test('pkg resolution | return name and version correctly for !=', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '3.0.0'
      },
      {
        number: '3.1.1'
      }
    ]
  })
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '!= 3.0.0'")
  t.is(resolved, 'rubocop==3.1.1')
})

test('pkg resolution | return name and version correctly for <=', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '3.1.1'
      },
      {
        number: '3.0.0'
      }
    ]
  })
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '<= 3.0.0'")
  t.is(resolved, 'rubocop==3.0.0')
})

test('resolve | return name and version correctly for >', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '3.0.0'
      },
      {
        number: '3.1.1'
      }
    ]
  })
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '> 3.0.0'")
  t.is(resolved, 'rubocop==3.1.1')
})

test('pkg resolution | return name and version correctly for latest', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '3.1.1'
      }
    ]
  })
  const resolved = await rubygems.resolveToSpec("gem 'rubocop'")
  t.is(resolved, 'rubocop==3.1.1')
})

test('resolve | return name and version correctly for <', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
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
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '< 3.0.0'")
  t.is(resolved, 'rubocop==2.0.0')
})

test('pkg resolution | return name and version correctly for ~> up to next minor', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
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
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '~> 2.0.0'")
  t.is(resolved, 'rubocop==2.0.1')
})

test('pkg resolution | return name and version correctly for ~> up to next major', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
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
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '~> 2.0'")
  t.is(resolved, 'rubocop==2.9.0')
})

test('pkg resolution | return name and version correctly for ~> up to next major with single version', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
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
  const resolved = await rubygems.resolveToSpec("gem 'rubocop', '~> 2'")
  t.is(resolved, 'rubocop==2.9.0')
})

test('pkg resolution | no version satisfying', async (t) => {
  const { httpGetStub, rubygems } = t.context
  httpGetStub.onCall(0).resolves({
    body: [
      {
        number: '2.1.0'
      }
    ]
  })
  const input = "gem 'rubocop', '< 2.0'"
  const resolved = await rubygems.resolveToSpec(input)
  t.is(resolved, input)
})

test('buildLatestSpec', (t) => {
  t.is(t.context.rubygems.buildLatestSpec('sodium'), 'sodium')
})
