import { buildNativeGlass } from './build-native-glass.mjs'
import { build } from 'esbuild'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const root = 'dist/desktop'
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const result = await build({ entryPoints: ['src/desktop/main.ts'],
  outfile: `${root}/main.mjs`, bundle: true, platform: 'node',
  format: 'esm', target: 'node24', external: ['electron'], metafile: true,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
await build({ entryPoints: ['src/desktop/preload.ts'], outfile: `${root}/preload.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })
if (Object.keys(result.metafile.inputs).some(path => path.includes('@deepseek-ai/'))) throw new Error('Desktop bundle imports DSH')
for (const name of ['setup.html', 'setup.css', 'setup.js']) await cp(`src/desktop/${name}`, `${root}/${name}`)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
await writeFile(`${root}/package.json`, JSON.stringify({ name: 'betterlearn-desktop', productName: 'BetterLearn',
  version: pkg.version, description: pkg.description, author: 'BetterLearn contributors', license: 'MIT', main: 'main.mjs',
}, null, 2) + '\n')
console.log('Built desktop shell; Python resources remain in dist/standalone.')

buildNativeGlass(`${root}/native`)
