import assert from 'node:assert/strict'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { resolve,join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const {values}=parseArgs({options:{codex:{type:'string'},claude:{type:'string'}}})
const root=await mkdtemp(join(tmpdir(),'betterlearn-plugins-')), clients=[]
let service,fake,stopped
try {
 const fixture=join(root,'provider.mjs')
 await build({entryPoints:['test/fixtures/standalone-provider.ts'],outfile:fixture,bundle:true,platform:'node',format:'esm'})
 fake=await (await import(pathToFileURL(fixture).href)).startFakeProvider()
 service=spawn(process.execPath,[resolve('dist/standalone/betterlearn.mjs'),'start','--home',root,'--python',resolve('.venv-phase1b/bin/python'),'--quiz-python',resolve('services/quiz/.venv/bin/python'),'--port','0'],{stdio:['ignore','pipe','pipe']})
 stopped=new Promise(r=>service.once('close',r));service.stderr.resume()
 const url=await new Promise((res,rej)=>{
  let output='';const timer=setTimeout(()=>rej(new Error('Backend startup timeout')),15000)
  service.once('error',e=>{clearTimeout(timer);rej(e)})
  service.once('exit',()=>{clearTimeout(timer);rej(new Error('Backend exited'))})
  service.stdout.on('data',data=>{output+=data;const found=/BetterLearn (http:\/\/127\.0\.0\.1:\d+)/.exec(output);if(found){clearTimeout(timer);res(found[1])}})
 })
 for(const host of ['codex','claude']) {
  const config=JSON.parse(await readFile(resolve(values[host]??`dist/plugins/${host}/betterlearn/.mcp.json`),'utf8')).mcpServers.betterlearn
  assert.ok(!config.args.includes('--home'),'Verification expects the default-home plugin configuration')
  const client=new Client({name:`${host}-installed-package-verifier`,version:'1.0'})
  clients.push(client)
  await client.connect(new StdioClientTransport({command:config.command,args:[...config.args,'--home',root],stderr:'pipe'}))
  assert.equal((await client.listTools()).tools.length,17)
 }
 async function call(client,name,args={}) {
  const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result))
  const text=result.content[0].text;assert.ok(!text.includes('plugin-test-key'));return JSON.parse(text)
 }
 for(const client of clients){
  assert.equal((await call(client,'betterlearn_status')).text_model_configured,false)
  assert.deepEqual((await call(client,'betterlearn_list_learning_goals')).items,[])
  const assessment=await call(client,'betterlearn_knowledge_assessment',{knowledge_point_id:'kp_'+'a'.repeat(20),content_version:'b'.repeat(64)})
  assert.equal(assessment.evidence_score,null)
  assert.equal(assessment.evidence_state,'no_evidence')
  assert.deepEqual(assessment.basis,[])
 }
 assert.equal(fake.calls.length,0)
 const response=await fetch(url+'/api/settings',{method:'PUT',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({text:{baseUrl:fake.url,model:'fake',apiKey:'plugin-test-key'}})})
 assert.equal(response.status,200)
 const args={request_id:randomUUID(),user_input:'光合作用',question_count:3}
 const tasks=await Promise.all(clients.map(c=>call(c,'betterlearn_generate_quiz',args)))
 assert.deepEqual(tasks[0],tasks[1])
 let task
 for(let i=0;i<250;i++) {task=await call(clients[0],'betterlearn_get_task',{task_id:tasks[0].task_id});if(['completed','failed'].includes(task.status))break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(task.status,'completed');assert.ok(fake.calls.length>0)
 const charged=fake.calls.length
 for(const client of clients) {
  assert.equal((await call(client,'betterlearn_list_quizzes')).total,1)
  await call(client,'betterlearn_read_quiz',{quiz_id:task.result.quiz_id})
 }
 assert.equal(fake.calls.length,charged)
 console.log('Both plugin configs verified: 17 tools, readonly assessment without model configuration, shared backend, own API generation, cross-client deduplication, shared history, no credentials returned.')
} finally {
 await Promise.allSettled(clients.map(c=>c.close()))
 if(service && service.exitCode===null){service.kill('SIGTERM');await stopped}
 await fake?.close();await rm(root,{recursive:true,force:true})
}
