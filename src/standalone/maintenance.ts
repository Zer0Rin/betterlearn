import { mkdir, readdir, lstat, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, dirname } from 'node:path'
import { createHash,randomUUID } from 'node:crypto'
import { acquireHomeLock } from './home.js'
import { atomicJson } from './config.js'
const entries=['core','quiz-data','settings.json','identity.json','library.json','library-delete.json']
function separate(a:string,b:string){const r=relative(resolve(a),resolve(b));if(!r||(!r.startsWith('..')&&!isAbsolute(r)))throw new Error('备份目标必须位于数据目录之外')}
async function absent(path:string){try{await lstat(path);throw new Error('目标已存在，请选择全新目录')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}}
async function files(root:string,prefix=''):Promise<string[]>{const output:string[]=[];for(const name of await readdir(join(root,prefix))){const path=join(prefix,name);const s=await lstat(join(root,path));if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))throw new Error('拒绝备份特殊文件');if(s.isDirectory())output.push(...await files(root,path));else output.push(path)}return output.sort()}
async function copyFile(source:string,target:string){await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,await readFile(source),{mode:0o600,flag:'wx'})}
export async function backupHome(home:string,target:string,python:string){
 separate(home,target);separate(target,home);await absent(target);const unlock=await acquireHomeLock(home,python);const temporary=target+'.'+randomUUID()+'.tmp'
 try{
  await mkdir(temporary,{recursive:true,mode:0o700});const hashes:Record<string,string>={}
  for(const entry of entries){let paths:string[];try{const info=await lstat(join(home,entry));if(info.isSymbolicLink())throw new Error('拒绝备份符号链接');paths=info.isDirectory()?(await files(join(home,entry))).map(p=>join(entry,p)):[entry]}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e}
   for(const path of paths){if(path.endsWith('.nobei-core.lock'))continue;await copyFile(join(home,path),join(temporary,path));hashes[path]=createHash('sha256').update(await readFile(join(temporary,path))).digest('hex')}
  }
  await atomicJson(join(temporary,'backup.json'),{version:1,createdAt:new Date().toISOString(),containsSecrets:true,files:hashes});await rename(temporary,target)
 }finally{await rm(temporary,{recursive:true,force:true});await unlock()}
}
export async function restoreHome(source:string,home:string,python:string){
 separate(source,home);separate(home,source);await absent(home)
 const manifest=JSON.parse(await readFile(join(source,'backup.json'),'utf8')) as {version:number;files:Record<string,string>}
 if(manifest.version!==1||!manifest.files||typeof manifest.files!=='object')throw new Error('无效备份')
 const actual=(await files(source)).filter(p=>p!=='backup.json')
 if(actual.length!==Object.keys(manifest.files).length)throw new Error('备份文件数量不匹配')
 for(const path of actual){if(!entries.includes(path.split('/')[0]!)||createHash('sha256').update(await readFile(join(source,path))).digest('hex')!==manifest.files[path])throw new Error('备份校验失败')}
 const temporary=home+'.'+randomUUID()+'.tmp';await mkdir(temporary,{recursive:true,mode:0o700})
 try{for(const path of actual)await copyFile(join(source,path),join(temporary,path));await rename(temporary,home)}finally{await rm(temporary,{recursive:true,force:true})}
}
