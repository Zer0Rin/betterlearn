import type { Readable, Writable } from 'node:stream'
export interface SubprocessSpawnSpec {
 argv: readonly string[];cwd:string;env?:Readonly<Record<string,string|undefined>>;graceMs:number
 stdio:{stdin:'ignore'|'pipe';stdout:'pipe';stderr:{maxBytes:number}}
}
export interface SubprocessHandle {
 stdin?:Writable;stdout?:Readable
 done:Promise<{exitCode:number|null;signal:string|null}>
 terminate():void
 waitForExit():Promise<boolean>
}
