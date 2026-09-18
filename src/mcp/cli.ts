import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { readFile } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { homedir } from 'node:os'
import { parseArgs } from 'node:util'
import { createMcpServer,BridgeError } from './server.js'
async function main() {
let values:{home?:string;help?:boolean}
try { ({values}=parseArgs({options:{home:{type:'string'},help:{type:'boolean',short:'h'}}})) }
catch { console.error('无效参数。用法：betterlearn-mcp [--home DIR] [--help]'); process.exitCode=1; return }
if(values.help){console.log('BetterLearn MCP stdio connector\nUsage: node mcp.mjs [--home DIR]\n请先启动 BetterLearn；生成使用其自身配置的 API。');return}
const home=resolve(values.home??join(homedir(),'.betterlearn-web'))
const server=createMcpServer(async(name,args)=>{
 const info=JSON.parse(await readFile(join(home,'mcp-connection.json'),'utf8'))
 const url=new URL(info.url)
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.port||! /^[a-f0-9]{64}$/.test(info.token))throw new Error('INVALID_CONNECTION')
 const response=await fetch(new URL('/api/mcp/call',url),{method:'POST',redirect:'error',headers:{'content-type':'application/json',origin:url.origin,authorization:`Bearer ${info.token}`},body:JSON.stringify({name,args}),signal:AbortSignal.timeout(60000)})
 if(!response.ok)throw new BridgeError('BETTERLEARN_UNAVAILABLE: 请确认 BetterLearn 已启动；生成请求重试时保留 request_id')
 const body=await response.json() as {data?:unknown;error?:string}
 if(body.error)throw new BridgeError(body.error)
 return body.data
})
await server.connect(new StdioServerTransport())

}
main().catch(()=>{console.error('BetterLearn MCP 启动失败，请检查本机运行环境。');process.exitCode=1})
