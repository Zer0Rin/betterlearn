import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import type { ModelSelectionSnapshot } from '../product/types.js'
export interface Connection { baseUrl: string; model: string; apiKey: string }
interface Settings { version: 1; text: Connection; embedding: Connection; image: Connection; search: { apiKey: string; enabled: boolean }; connections: Record<string, Connection> }
const defaults = (): Settings => ({version:1,text:{baseUrl:'https://api.deepseek.com/v1',model:'deepseek-chat',apiKey:''},embedding:{baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'text-embedding-v4',apiKey:''},image:{baseUrl:'https://dashscope.aliyuncs.com/api/v1',model:'qwen-image-2.0',apiKey:''},search:{apiKey:'',enabled:false},connections:{}})
export async function atomicJson(path: string, value: unknown): Promise<void> {
 const temporary=`${path}.${randomUUID()}.tmp`
 await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'})
 await rename(temporary,path)
}
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value==='object' && !Array.isArray(value) }
function cleanString(value: unknown, max=2048): string {
 if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value)) throw new Error('设置包含无效字符或过长内容')
 return value.trim()
}
function url(value: unknown): string {
 const text=cleanString(value); const parsed=new URL(text)
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash) throw new Error('模型地址必须是 HTTP(S) 服务地址')
 return text.replace(/\/+$/,'')
}
function provider(connection: Connection): string {return 'local-'+createHash('sha256').update(JSON.stringify(connection)).digest('hex').slice(0,24)}
export class SettingsStore {
 private queue: Promise<unknown> = Promise.resolve()
 private constructor(readonly home:string,private data:Settings) {}
 static async open(home:string):Promise<SettingsStore>{
  await mkdir(home,{recursive:true,mode:0o700})
  let data=defaults()
  try { const loaded=JSON.parse(await readFile(join(home,'settings.json'),'utf8')); if(loaded.version!==1)throw new Error('不支持的设置版本'); data=loaded }
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; await atomicJson(join(home,'settings.json'),data)}
  return new SettingsStore(home,data)
 }
 public(){ const mask=(c:Connection)=>({baseUrl:c.baseUrl,model:c.model,apiKeySet:!!c.apiKey}); return {text:mask(this.data.text),embedding:mask(this.data.embedding),image:mask(this.data.image),search:{enabled:this.data.search.enabled,apiKeySet:!!this.data.search.apiKey}} }
 selection():ModelSelectionSnapshot|null{const c=this.data.text;return c.apiKey&&c.model?{provider:provider(c),model:c.model}:null}
 connection(selection:ModelSelectionSnapshot):Connection{const c=this.data.connections[selection.provider];if(!c||c.model!==selection.model) throw new Error('模型配置不可用，请检查设置');return {...c}}
 update(value:unknown):Promise<void>{
  const operation=this.queue.then(async()=>{
   if(!record(value)||Object.keys(value).some(k=>!['text','embedding','image','search'].includes(k)))throw new Error('无效设置')
   const next=structuredClone(this.data)
   for(const key of ['text','embedding','image','search'] as const){
    const patch=value[key];if(patch===undefined)continue
    if(!record(patch)||Object.keys(patch).some(k=>!(key==='search'?['apiKey','enabled']:['baseUrl','model','apiKey']).includes(k)))throw new Error('无效设置字段')
    if('apiKey'in patch)next[key].apiKey=cleanString(patch.apiKey)
    if(key==='search'){if('enabled'in patch){if(typeof patch.enabled!=='boolean')throw new Error('无效搜索开关');next.search.enabled=patch.enabled}}
    else{if('baseUrl'in patch)next[key].baseUrl=url(patch.baseUrl);if('model'in patch){next[key].model=cleanString(patch.model,128);if(!next[key].model)throw new Error('模型名称不能为空')}}
   }
   if(next.text.apiKey)next.connections[provider(next.text)]={...next.text}
   await atomicJson(join(this.home,'settings.json'),next);this.data=next
  });this.queue=operation.catch(()=>{});return operation
 }
 async writeQuizEnv():Promise<string>{
  const d=this.data
  const entries:Record<string,string>={QUIZ_DB_PATH:join(this.home,'quiz-data','quiz.sqlite'),DEEPSEEK_BASE_URL:d.text.baseUrl,DEEPSEEK_MODEL:d.text.model,DEEPSEEK_API_KEY:d.text.apiKey,DASHSCOPE_BASE_URL:d.embedding.baseUrl,DASHSCOPE_EMBEDDING_MODEL:d.embedding.model,DASHSCOPE_API_KEY:d.embedding.apiKey,DASHSCOPE_IMAGE_BASE_URL:d.image.baseUrl,DASHSCOPE_IMAGE_MODEL:d.image.model,DASHSCOPE_IMAGE_API_KEY:d.image.apiKey,TAVILY_API_KEY:d.search.apiKey,ENABLE_WEB_SEARCH:String(d.search.enabled),LOCAL_IMAGE_DIR:join(this.home,'quiz-data','images')}
  const path=join(this.home,'quiz.env');await writeFile(path,Object.entries(entries).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600});return path
 }
}
