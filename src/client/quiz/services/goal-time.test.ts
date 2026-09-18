import {expect,it} from 'vitest'
import {goalTime} from './goal-time.js'
it('interprets legacy SQLite evidence timestamps as UTC before local display',()=>{
 expect(goalTime('2026-09-18 04:36:49')).toBe(goalTime('2026-09-18T04:36:49Z'))
})
it('renders absent and malformed legacy timestamps without crashing',()=>{
 expect(goalTime(null)).toBe('时间未知')
 expect(goalTime(undefined)).toBe('时间未知')
 expect(goalTime('bad-date')).toBe('时间未知')
})
