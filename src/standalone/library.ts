import { readFile, access, rm } from 'node:fs/promises'
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
export class LibraryConflictError extends Error { constructor(){super('书库已在其他页面更新，请重新加载后再操作')} }
export class LibraryStore {
 private queue:Promise<unknown>=Promise.resolve()
 constructor(private readonly home:string){}
 async read():Promise<{books:LearningBook[];revision:number}>{try{const data=JSON.parse(await readFile(join(this.home,'library.json'),'utf8'));const revision=data.revision??0;if(!Number.isSafeInteger(revision)||revision<0)throw new Error('无效书库版本');return {...validate(data),revision}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {books:[],revision:0};throw error}}
 private async ensureNoDeletion(){try{await access(join(this.home,'library-delete.json'));throw new Error('删除操作尚未完成，请重启应用恢复后再修改书库')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 async recoverDelete(deleteCourse:(id:string)=>Promise<void>):Promise<void>{
  const path=join(this.home,'library-delete.json');let pending:{previousRevision:number;next:{books:LearningBook[];revision:number};courseId?:string}
  try{pending=JSON.parse(await readFile(path,'utf8'))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error}
  const current=await this.read()
  if(current.revision===pending.next.revision){await rm(path);return}
  if(current.revision!==pending.previousRevision)throw new Error('删除恢复版本冲突')
  if(pending.courseId)await deleteCourse(pending.courseId)
  await atomicJson(join(this.home,'library.json'),pending.next);await rm(path)
 }
 deleteBook(bookId:string,expectedRevision:number,deleteCourse:(id:string)=>Promise<void>):Promise<{books:LearningBook[];revision:number}>{
  const op=this.queue.then(async()=>{
   await this.ensureNoDeletion();const previous=await this.read()
   if(previous.revision!==expectedRevision)throw new LibraryConflictError()
   const book=previous.books.find(b=>b.bookId===bookId);if(!book)throw new Error('学习书不存在')
   const next={books:previous.books.filter(b=>b.bookId!==bookId),revision:previous.revision+1}
   await atomicJson(join(this.home,'library-delete.json'),{previousRevision:previous.revision,next,courseId:book.courseId})
   await this.recoverDelete(deleteCourse);return next
  });this.queue=op.catch(()=>{});return op
 }
 write(value:unknown):Promise<{books:LearningBook[];revision:number}>{
  const checked=validate(value);const expected=(value as {expectedRevision?:number}).expectedRevision
  if(!Number.isSafeInteger(expected)||expected!<0)throw new Error('缺少书库版本')
  const op=this.queue.then(async()=>{await this.ensureNoDeletion();const previous=await this.read();if(previous.revision!==expected)throw new LibraryConflictError();const saved={...checked,revision:previous.revision+1};await atomicJson(join(this.home,'library.json'),saved);return saved});this.queue=op.catch(()=>{});return op
 }
}
