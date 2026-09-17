import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicJson } from './config.js'
import { readLearningBooks, writeLearningBooks, type LearningBook } from '../client/learning-book-library.js'
function validate(value:unknown):{books:LearningBook[]}{
 if(!value||typeof value!=='object'||!Array.isArray((value as {books?:unknown}).books))throw new Error('无效学习书数据')
 const books=(value as {books:LearningBook[]}).books
 let raw:string|null=null
 const storage:Storage={getItem:()=>raw,setItem:(_key:string,v:string)=>{raw=v},length:0,key:()=>null,clear:()=>{raw=null},removeItem:()=>{raw=null}}
 if(!writeLearningBooks(storage,books))throw new Error('无效学习书数据')
 const checked=readLearningBooks(storage)
 if(checked.length!==books.length||new Set(checked.map(b=>b.bookId)).size!==books.length)throw new Error('无效或重复的学习书')
 return {books:checked}
}
export class LibraryStore {
 private queue:Promise<unknown>=Promise.resolve()
 constructor(private readonly home:string){}
 async read():Promise<{books:LearningBook[]}>{try{return validate(JSON.parse(await readFile(join(this.home,'library.json'),'utf8')))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {books:[]};throw error}}
 write(value:unknown):Promise<{books:LearningBook[]}>{const checked=validate(value);const op=this.queue.then(async()=>{await atomicJson(join(this.home,'library.json'),checked);return checked});this.queue=op.catch(()=>{});return op}
}
