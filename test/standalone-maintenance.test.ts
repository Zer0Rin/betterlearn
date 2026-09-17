import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test,expect } from 'vitest'
import { backupHome,restoreHome } from '../src/standalone/maintenance.js'
import { acquireHomeLock } from '../src/standalone/home.js'
test('backup refuses running app and restores verified data into empty home',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bl-backup-'));const home=join(root,'home'),backup=join(root,'backup'),target=join(root,'restored'),python=resolve('.venv-phase1b/bin/python')
 try{
  await mkdir(join(home,'quiz-data'),{recursive:true});await writeFile(join(home,'settings.json'),'{}');await writeFile(join(home,'quiz-data','quiz.sqlite'),'database')
  const unlock=await acquireHomeLock(home,python)
  await expect(backupHome(home,backup,python)).rejects.toThrow()
  await unlock();await backupHome(home,backup,python);await restoreHome(backup,target,python)
  expect(await readFile(join(target,'quiz-data','quiz.sqlite'),'utf8')).toBe('database')
  await expect(restoreHome(backup,target,python)).rejects.toThrow()
  await writeFile(join(backup,'quiz-data','quiz.sqlite'),'changed')
  await expect(restoreHome(backup,join(root,'bad'),python)).rejects.toThrow()
 }finally{await rm(root,{recursive:true,force:true})}
})
