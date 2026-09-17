import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, expect, test, vi } from 'vitest'
import { registerQuizRoutes } from '../src/product/quiz-routes.js'
import type { QuizServicePort } from '../src/product/quiz-service.js'
const close: Array<()=>Promise<void>>=[]
afterEach(async()=>{await Promise.all(close.splice(0).map(f=>f()))})
async function fixture(){
 let handler:(req:IncomingMessage,res:ServerResponse)=>void=()=>{}
 const server=createServer((req,res)=>handler(req,res))
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 close.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r())}))
 const port=(server.address() as {port:number}).port
 const service:QuizServicePort={start:vi.fn(async()=>{}),dispose:vi.fn(async()=>{}),session:vi.fn(async()=>({user:{id:1}})),request:vi.fn(async()=>Response.json({code:0,message:'success',data:{items:[]}}))}
 registerQuizRoutes({webServer:{port,register:(definition:any)=>{handler=definition.handler;return ()=>{}}}} as any,service)
 return {url:`http://127.0.0.1:${port}`,service}
}
test('exposes a token-free session and refuses cross-origin mutation',async()=>{
 const {url,service}=await fixture()
 expect((await fetch(url+'/nobei/quiz/v1/session',{method:'POST'})).status).toBe(403)
 const response=await fetch(url+'/nobei/quiz/v1/session',{method:'POST',headers:{origin:url}})
 expect(await response.json()).toEqual({code:0,message:'success',data:{user:{id:1}}})
 expect(service.session).toHaveBeenCalledTimes(1)
})
test('forwards only exact business paths and never browser authorization',async()=>{
 const {url,service}=await fixture()
 for(const path of ['/user/local-login','/user/host-session','/docs','/knowledge/documents/doc_a/content?url=evil']){
  expect((await fetch(url+'/nobei/quiz/v1'+path)).status).toBe(404)
 }
 expect((await fetch(url+'/nobei/quiz/v1/user/profile',{headers:{authorization:'Bearer injected'}})).status).toBe(200)
 const call=vi.mocked(service.request).mock.calls[0]
 expect(call[0]).toBe('/user/profile')
 expect(new Headers(call[1]?.headers).has('authorization')).toBe(false)
})
test('forwards multipart document upload with intact bytes and origin checking',async()=>{
 const {url,service}=await fixture()
 const form=new FormData();form.append('file',new Blob(['你好']),'notes.txt')
 const response=await fetch(url+'/nobei/quiz/v1/knowledge/documents',{method:'POST',headers:{origin:url},body:form})
 expect(response.status).toBe(200)
 const call=vi.mocked(service.request).mock.calls[0]
 expect(new Headers(call[1]?.headers).get('content-type')).toContain('multipart/form-data; boundary=')
 expect(Buffer.from(call[1]?.body as ArrayBuffer).toString()).toContain('你好')
})
test('rejects oversized input and incorrect methods before upstream',async()=>{
 const {url,service}=await fixture()
 expect((await fetch(url+'/nobei/quiz/v1/user/profile',{method:'POST',headers:{origin:url}})).status).toBe(405)
 const response=await fetch(url+'/nobei/quiz/v1/quiz/generate/async',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:'x'.repeat(1024*1024+1)})
 expect(response.status).toBe(413)
 expect(service.request).not.toHaveBeenCalled()
})
