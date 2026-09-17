import { build } from 'esbuild'
import { mkdir,cp,writeFile,rm } from 'node:fs/promises'
const root='dist/standalone'
await rm(root,{recursive:true,force:true});await mkdir(root+'/public',{recursive:true})
const node=await build({entryPoints:['src/standalone/cli.ts'],outfile:root+'/betterlearn.mjs',bundle:true,platform:'node',format:'esm',target:'node24',metafile:true,banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"}})
const client=await build({entryPoints:['src/standalone/client.tsx'],outfile:root+'/public/app.js',bundle:true,platform:'browser',format:'esm',target:'es2022',jsx:'automatic',loader:{'.css':'text'},metafile:true})
for(const meta of [node.metafile,client.metafile]){
 const bad=Object.keys(meta.inputs).filter(p=>p.includes('@deepseek-ai/'))
 if(bad.length)throw new Error('Standalone bundle imports DSH: '+bad.join(','))
}
await writeFile(root+'/public/index.html','<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BetterLearn · 学习工作台</title></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
for(const path of ['contracts','python/nobei_core','python/requirements-phase1.lock','python/requirements-phase1.txt','services/quiz/app','services/quiz/run_managed.py','services/quiz/requirements.txt','services/quiz/LICENSE','services/quiz/PROVENANCE.md','LICENSE'])await cp(path,root+'/'+path,{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')})
await writeFile(root+'/package.json',JSON.stringify({name:'betterlearn-web',version:'0.1.0',private:true,type:'module',engines:{node:'>=24'},scripts:{start:'node betterlearn.mjs start'}},null,2)+'\n')
await writeFile(root+'/BUILD.json',JSON.stringify({dshDependencies:0,nodeModulesRequired:false},null,2)+'\n')
console.log('Built dist/standalone (no DSH, no Node runtime dependencies)')
