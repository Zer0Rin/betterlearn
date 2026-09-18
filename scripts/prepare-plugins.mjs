import { cp,mkdir,readFile,writeFile,access } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { parseArgs } from 'node:util'
import { constants } from 'node:fs'
const {values}=parseArgs({options:{output:{type:'string'},mcp:{type:'string'},node:{type:'string'},home:{type:'string'}}})
const output=resolve(values.output??'dist/plugins')
const runtime=resolve(values.mcp??'dist/standalone/mcp.mjs')
const node=resolve(values.node??process.execPath)
await access(runtime);await access(node,constants.X_OK)
for(const host of ['codex','claude']) {
 const dest=join(output,host,'betterlearn')
 await mkdir(dest,{recursive:true})
 await cp(`plugins/${host}/betterlearn`,dest,{recursive:true})
 await mkdir(join(dest,'skills/betterlearn'),{recursive:true})
 await cp('plugins/shared/SKILL.md',join(dest,'skills/betterlearn/SKILL.md'))
 await writeFile(join(dest,'.mcp.json'),JSON.stringify({mcpServers:{betterlearn:{command:node,args:[runtime,...(values.home?['--home',resolve(values.home)]:[])]}}},null,2)+'\n')
}
console.log(`Prepared local plugins in ${output}. Keep the MCP program at ${runtime}.`)
