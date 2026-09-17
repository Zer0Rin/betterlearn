import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { SettingsStore } from '../src/standalone/config.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p=>rm(p,{recursive:true,force:true}))) })
async function store() { const home = await mkdtemp(join(tmpdir(),'bl-settings-')); roots.push(home); return {home, settings: await SettingsStore.open(home)} }
test('settings mask secrets, preserve omitted keys, clear explicit empty and persist privately', async()=>{
 const {home,settings}=await store()
 expect(settings.public().text.apiKeySet).toBe(false)
 expect(settings.selection()).toBeNull()
 await settings.update({text:{baseUrl:'http://127.0.0.1:8999/v1',model:'test',apiKey:'private-key'}})
 const selection=settings.selection()!
 expect(JSON.stringify(settings.public())).not.toContain('private-key')
 expect((await stat(join(home,'settings.json'))).mode & 0o777).toBe(0o600)
 await settings.update({text:{model:'next'}})
 expect(settings.connection(selection).model).toBe('test')
 expect(settings.connection(settings.selection()!).apiKey).toBe('private-key')
 expect((await SettingsStore.open(home)).selection()).toEqual(settings.selection())
 await settings.update({text:{apiKey:''}})
 expect(settings.selection()).toBeNull()
})
test('invalid config does not overwrite stored settings', async()=>{
 const {home,settings}=await store()
 const before=await readFile(join(home,'settings.json'),'utf8')
 await expect(settings.update({text:{baseUrl:'file:///tmp/key'}})).rejects.toThrow()
 await expect(settings.update({text:{apiKey:'secret\nINJECT=true'}})).rejects.toThrow()
 await expect(settings.update({unknown:{}})).rejects.toThrow()
 expect(await readFile(join(home,'settings.json'),'utf8')).toBe(before)
})
