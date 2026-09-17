import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
export const sourceText='绿色植物通过光合作用将光能转化为化学能。叶绿体是光合作用的主要场所。'
export const questions=Array.from({length:3},(_,i)=>({id:`q${i+1}`,type:'single',stem:`第${i+1}题：光合作用将光能转化为什么？`,options:[{key:'A',text:'化学能'},{key:'B',text:'声能'}],answer:['A'],explanation:'光合作用将光能转化为化学能。',knowledge_point:'光合作用',difficulty:'easy'}))
export async function startFakeProvider(){
 const calls:string[]=[]
 const server=createServer(async(req,res)=>{try{
  let text='';for await(const chunk of req)text+=chunk
  const body=JSON.parse(text);calls.push(req.url??'')
  res.setHeader('content-type','application/json')
  if(req.url?.endsWith('/embeddings')){const inputs=Array.isArray(body.input)?body.input:[body.input];res.end(JSON.stringify({object:'list',model:'fake',data:inputs.map((_:unknown,index:number)=>({object:'embedding',index,embedding:[0.1,0.2,0.3,0.4]})),usage:{prompt_tokens:1,total_tokens:1}}));return}
  const tools=body.tools??[];let message:any;let finish_reason='stop'
  if(tools.some((t:any)=>t.function.name==='structured_output')){finish_reason='tool_calls';message={role:'assistant',content:null,tool_calls:[{id:'extract',type:'function',function:{name:'structured_output',arguments:JSON.stringify({schemaVersion:1,candidates:[{type:'concept',title:'光合作用',statement:'绿色植物通过光合作用将光能转化为化学能。',evidence:[{quote:'绿色植物通过光合作用将光能转化为化学能。',prefix:'',suffix:''}]}]})}}]}}
  else if(tools.some((t:any)=>t.function.name==='search_knowledge_base')&&!body.messages.some((m:any)=>m.role==='tool')){finish_reason='tool_calls';message={role:'assistant',content:null,tool_calls:[{id:'rag',type:'function',function:{name:'search_knowledge_base',arguments:JSON.stringify({query:'光合作用'})}}]}}
  else if(tools.length){message={role:'assistant',content:sourceText}}
  else{const system=String(body.messages[0]?.content??'');const report=system.includes('复盘')||system.includes('报告');message={role:'assistant',content:JSON.stringify(report?{accuracy:100,mastered_points:['光合作用'],weak_points:[],three_line_summary:['光能转化为化学能','叶绿体参与光合作用','结合证据学习'],advice:['继续复习'],share_quote:'用证据理解知识。'}:{title:'光合作用练习',summary:sourceText,questions})}}
  res.end(JSON.stringify({id:'fake-completion',object:'chat.completion',created:1,model:'fake',choices:[{index:0,message,finish_reason}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}))
 }catch{res.writeHead(500);res.end('{}')}})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {url:`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,calls,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()})}
}
