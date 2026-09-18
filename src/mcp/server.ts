import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { toolDefinitions } from './tools.js'
export function createMcpServer(call:(name:string,args:unknown)=>Promise<unknown>) {
 const server=new McpServer({name:'betterlearn',version:'0.1.0'})
 for(const [name,definition] of Object.entries(toolDefinitions)) {
  server.registerTool(name,{description:definition.description,inputSchema:definition.schema,
   annotations:{readOnlyHint:definition.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:!definition.readOnly}},async (args:Record<string,unknown>)=>{
    try {const data=await call(name,args);return {content:[{type:'text' as const,text:JSON.stringify(data)}]}}
    catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof BridgeError?error.message:'BETTERLEARN_UNAVAILABLE: 请先打开 BetterLearn，再重试相同请求'}]}}
   })
 }
 return server
}
export class BridgeError extends Error {}
