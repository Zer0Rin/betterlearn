export const goalTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone || '本地时区'
export function goalTime(value:string){
  // Legacy SQLite answer timestamps are UTC even without an explicit suffix.
  const utc=/([zZ]|[+-]\d{2}:\d{2})$/.test(value)?value:value.replace(' ','T')+'Z'
  return new Date(utc).toLocaleString('zh-CN',{hour12:false})
}
export function goalDeadline(value:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw Error('请选择完整的截止日期与时间。')
  const date=new Date(value)
  const parts=[date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes()]
  if(!Number.isFinite(date.getTime()) || parts.some((p,i)=>p!==Number(value.split(/[-T:]/)[i])))throw Error('截止时间不存在，请重新选择。')
  if(date.getTime()<=Date.now())throw Error('截止时间必须晚于当前时间。')
  return date.toISOString()
}
