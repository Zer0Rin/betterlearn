import {expect,it} from 'vitest'
import {goalTime} from './goal-time.js'
it('interprets legacy SQLite evidence timestamps as UTC before local display',()=>{
 expect(goalTime('2026-09-18 04:36:49')).toBe(goalTime('2026-09-18T04:36:49Z'))
})
