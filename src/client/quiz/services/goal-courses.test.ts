import {it,expect,vi} from 'vitest'
import {loadGoalCourses} from './goal-courses.js'
import {goalCourse} from '../pages/goals.fixture.js'
it('deduplicates sources and skips deleted or archived courses without hiding valid courses',async()=>{
 const read=vi.fn(async(id:string)=>{if(id==='deleted')throw Object.assign(Error('missing'),{status:404});return {...goalCourse,status:id==='archived'?'archived' as const:'active' as const}})
 expect(await loadGoalCourses(['deleted','active','active','archived'],read)).toEqual([goalCourse])
 expect(read).toHaveBeenCalledTimes(3)
})
it('surfaces service failures instead of claiming there are no courses',async()=>{
 await expect(loadGoalCourses(['a'],async()=>{throw Object.assign(Error('offline'),{status:503})})).rejects.toThrow('offline')
})
