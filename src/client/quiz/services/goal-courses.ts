import type {LearningCourse} from '../../types.js'
/** A course removed outside the bookshelf must not hide other valid sources. */
export async function loadGoalCourses(ids:string[],read:(id:string)=>Promise<LearningCourse>):Promise<LearningCourse[]> {
 const courses=await Promise.all([...new Set(ids)].map(async id=>{
  try{return await read(id)}catch(error){
   if(error && typeof error==='object' && 'status' in error && error.status===404)return undefined
   throw error
  }
 }))
 return courses.filter((course):course is LearningCourse=>!!course && course.status==='active')
}
