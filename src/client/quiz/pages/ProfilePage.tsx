import { KnowledgeStatistics } from '../components/KnowledgeStatistics.js'
import { useEffect, useState } from 'react'
import type { QuizApi } from '../services/contracts.js'
import type { UserProfile } from '../types.js'

export function ProfilePage({ api, onSaved, onAttempt }: { api: QuizApi; onSaved(): void; onAttempt(quizId:string,attemptId:string):void }) {
  const [profile, setProfile] = useState<UserProfile>()
  const [nickname, setNickname] = useState(''); const [avatar, setAvatar] = useState('')
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => { let active = true; api.getProfile().then(p => { if (active) { setProfile(p); setNickname(p.nickname); setAvatar(p.avatar_url); setError('') } }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [api, revision])
  return <><header className="zl-heading"><div className="zl-eyebrow">个人中心</div><h1>学习统计</h1><p>查看练习次数、正确率和学习记录。</p></header>{error && <div className="zl-error" role="alert">{error}<button onClick={() => setRevision(n => n+1)}>重新加载</button></div>}
    {profile && <><div className="zl-stats">{[['完成练习',profile.quiz_count],['答对题目',profile.correct_count],['平均正确率',`${profile.average_accuracy}%`],['学习经验',profile.total_xp]].map(([label,value]) => <div className="zl-panel zl-stat" key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <KnowledgeStatistics api={api} onAttempt={onAttempt}/>
    <form className="zl-panel zl-profile-form" onSubmit={async e => { e.preventDefault(); setSaving(true); setNotice(''); setError(''); try { await api.updateProfile({ nickname: nickname.trim(), avatar_url: avatar.trim() }); setProfile({ ...profile, nickname: nickname.trim(), avatar_url: avatar.trim() }); onSaved(); setNotice('个人资料已保存。') } catch (err) { setError((err as Error).message) } finally { setSaving(false) } }}><h2>个人资料</h2><label className="zl-field">昵称<input value={nickname} onChange={e => setNickname(e.target.value)} maxLength={100} required /></label><label className="zl-field">头像网址（可选）<input type="url" placeholder="https://…" value={avatar} onChange={e => setAvatar(e.target.value)} maxLength={500}/></label><p className="zl-muted">使用本机学习身份。知识库、练习记录和经验值保存在本地数据库中。</p><button className="zl-primary" disabled={saving || !nickname.trim()}>{saving ? '保存中…' : '保存资料'}</button>{notice && <p className="zl-success" role="status">{notice}</p>}</form></>}
  </>
}
