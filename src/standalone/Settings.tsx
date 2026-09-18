import { AppearanceSettings, type GlassAppearance } from './AppearanceSettings.js'
import { useEffect, useState, type FormEvent } from 'react'

type Connection = { baseUrl: string; model: string; apiKeySet: boolean }
export interface PublicSettings {
  text: Connection
  embedding: Connection
  image: Connection
  search: { enabled: boolean; apiKeySet: boolean }
}
type Capability = keyof PublicSettings
const labels: Record<Capability, string> = {text:'文本模型',embedding:'Embedding 模型',image:'图片模型',search:'联网检索'}
export class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'RequestError' }
}
export async function requestJson<T>(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init)
  if (!response.ok) {
    let message = `请求失败（${response.status}），请检查本地服务后重试。`
    if (response.status === 400 || response.status === 409) {
      const detail: unknown = await response.json().catch(() => null)
      if (detail && typeof detail === 'object' && 'message' in detail
        && typeof detail.message === 'string' && detail.message.trim() && detail.message.length <= 500) {
        message = detail.message
      }
    }
    throw new RequestError(response.status, message)
  }
  return response.json() as Promise<T>
}
export function Settings({ fetcher = globalThis.fetch, onSaved, appearance }: { fetcher?: typeof fetch; onSaved(): void | Promise<void>; appearance?: GlassAppearance }) {
  const [settings,setSettings] = useState<PublicSettings>()
  const [secrets,setSecrets] = useState<Partial<Record<Capability,string>>>({})
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [busy,setBusy] = useState(false)
  const [revision,setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    requestJson<PublicSettings>(fetcher,'/api/settings').then(value => {if (active) setSettings(value)})
      .catch(() => {if (active) setError('设置加载失败，请重试。')})
    return () => {active = false}
  },[fetcher,revision])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!settings || busy) return
    setBusy(true); setError(''); setNotice('')
    const body = Object.fromEntries((Object.keys(labels) as Capability[]).map(key => {
      const {apiKeySet: _, ...fields} = settings[key]
      return [key,{...fields,...(secrets[key] !== undefined ? {apiKey:secrets[key]} : {})}]
    }))
    try {
      const updated = await requestJson<PublicSettings>(fetcher,'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      setSettings(updated); setSecrets({}); setNotice('设置已保存。新的任务将使用更新后的模型。')
      await onSaved()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '保存失败，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="standalone-settings" aria-label="模型与能力设置">
    <header className="standalone-page-heading"><h1>{appearance ? '设置' : '模型与能力设置'}</h1><span>{appearance ? '让工作台更适合你的习惯。' : '密钥保存在本机，页面只显示配置状态。保存不会调用模型。'}</span></header>
    {appearance && <AppearanceSettings {...appearance}/>}
    {appearance && <header className="standalone-model-heading"><h2>模型与能力</h2><p>密钥保存在本机，保存配置不会调用模型。</p></header>}
    {error && <p role="alert">{error}<button type="button" onClick={() => setRevision(n=>n+1)}>重新加载设置</button></p>}
    {!settings ? <p role="status">正在读取设置…</p> : <form onSubmit={submit}>
      <fieldset disabled={busy} className="standalone-settings-fields">
      {(Object.keys(labels) as Capability[]).map(key => <section className="standalone-connection" key={key}>
        <header><h2>{labels[key]}</h2><span>{key === 'text' ? '知识提取、课程与练习' : '可选能力'}</span></header>
        {key === 'embedding' && <p>用于知识库检索。已有知识库的向量模型不能直接替换；请先处理索引重建。</p>}
        {key === 'image' && <p>未配置时可继续使用文字学习与练习。</p>}
        {key !== 'search' ? <div className="standalone-field-row">
          <label>服务地址<input aria-label={`${labels[key]}服务地址`} type="url" placeholder="https://api.example.com/v1" value={settings[key].baseUrl}
            onChange={e => setSettings({...settings,[key]:{...settings[key],baseUrl:e.currentTarget.value}})}/></label>
          <label>模型名称<input aria-label={`${labels[key]}名称`} value={settings[key].model} placeholder="模型 ID"
            onChange={e => setSettings({...settings,[key]:{...settings[key],model:e.currentTarget.value}})}/></label>
        </div> : <label className="standalone-checkbox"><input type="checkbox" checked={settings.search.enabled}
          onChange={e=>setSettings({...settings,search:{...settings.search,enabled:e.currentTarget.checked}})}/>启用联网检索</label>}
        <div className="standalone-secret"><label>API 密钥 <small>{settings[key].apiKeySet ? '已配置' : '未配置'}</small>
          <input type="password" aria-label={`${labels[key]}密钥`} autoComplete="new-password" value={secrets[key] ?? ''}
            placeholder={secrets[key] === '' ? '保存后清除' : '留空保留现有密钥'}
            onChange={e=>{const value=e.currentTarget.value;setSecrets(current=>{const next={...current}; if(value) next[key]=value; else delete next[key];return next})}}/></label>
          <button type="button" aria-label={`清除${labels[key]}密钥`} onClick={()=>setSecrets({...secrets,[key]:''})}>清除密钥</button>
          {secrets[key] === '' && <button type="button" onClick={()=>setSecrets(current=>{const next={...current};delete next[key];return next})}>撤销清除</button>}
        </div>
      </section>)}
      </fieldset>
      <footer className="standalone-settings-footer"><button className="standalone-primary" type="submit" disabled={busy}>{busy ? '正在保存…' : '保存设置'}</button><p role="status">{notice}</p></footer>
    </form>}
  </section>
}
