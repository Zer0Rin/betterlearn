import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
export function buildNativeGlass(output) {
  if (process.platform !== 'darwin') return
  const cache = join(homedir(), 'Library/Caches/node-gyp')
  const candidates = [process.env.NODE_INCLUDE_DIR, '/opt/homebrew/include/node', '/usr/local/include/node',
    ...(existsSync(cache) ? readdirSync(cache).reverse().map(v=>join(cache,v,'include/node')) : [])].filter(Boolean)
  const headers = candidates.find(p=>existsSync(join(p,'node_api.h')))
  if (!headers) throw new Error('Native glass build requires Node headers. Set NODE_INCLUDE_DIR to a directory containing node_api.h.')
  mkdirSync(output,{recursive:true})
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  execFileSync('xcrun',['clang','-arch',arch,'-mmacosx-version-min=14.0','-I',headers,'-c','src/desktop/native/bridge.c','-o',join(output,'bridge.o')],{stdio:'inherit'})
  execFileSync('xcrun',['swiftc','-swift-version','5','-target',`${arch}-apple-macosx14.0`,'-emit-library','src/desktop/native/Glass.swift',join(output,'bridge.o'),'-Xlinker','-undefined','-Xlinker','dynamic_lookup','-o',join(output,'glass.node')],{stdio:'inherit'})
  unlinkSync(join(output,'bridge.o'))
}
