/* eslint-disable */
const RegistryResolver = require('.')
const fs = require('fs')

const resolver = new RegistryResolver({
  epsilon: 0.000001 // the smallest weight that will be assigned to a package before exiting
})

async function resolveNpmWeightsMap () {
  const packageWeightMap = await resolver.computePackageWeight({
    language: 'javascript',
    registry: 'npm',
    topLevelPackages: ['standard', 'react', 'webpack'],
    noCompList: new Set(['react'])
  })
  console.error({ packageWeightMap })
}

async function resolveRubyWeightsMap () {
  fs.readFile('./testData/Gemfile.octobox', async (err, data) => {
    const res = await resolver.extractDependenciesFromManifests([{
      language: 'ruby',
      registry: 'rubygems',
      manifest: data.toString()
    }])
    try {
      const packageWeightMap = await resolver.computePackageWeight({
        language: 'ruby',
        registry: 'rubygems',
        topLevelPackages: res[0].deps,
        noCompList: undefined
      })

      // console.error({ packageWeightMap })

      const output = [...packageWeightMap.entries()].map(([packageName, weight]) => [
        packageName, weight * 10000])
      fs.writeFileSync('./output.json', JSON.stringify(output))
    } catch (e) {
      console.error({ e })
    }
  })
}

resolveRubyWeightsMap()
