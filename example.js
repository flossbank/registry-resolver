const RegistryResolver = require('.')

const resolver = new RegistryResolver({
  epsilon: 0.01 // the smallest weight that will be assigned to a package before exiting
})

async function main () {
  const packageWeightMap = await resolver.computePackageWeight({
    language: 'javascript',
    registry: 'npm',
    topLevelPackages: ['standard', 'react', 'webpack'],
    noCompList: new Set(['react'])
  })
  console.error({ packageWeightMap })
}

main()
