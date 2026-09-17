import { BookOpen } from 'lucide-react'
import { GlassBackdrop } from './GlassBackdrop.js'

export interface GlassAppearance {
  frost: number
  onChange(value: number): void
  saved: boolean
}

export function AppearanceSettings({ frost, onChange, saved }: GlassAppearance) {
  const description = frost === 0 ? '通透液态' : frost === 100 ? '磨砂玻璃' : `磨砂 ${frost}%`
  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <header><h2 id="appearance-title">外观</h2><span>玻璃质感</span></header>
    <div className="glass-preview" aria-label="玻璃效果实时预览">
      <div className="glass-preview-scene" aria-hidden="true"><i/><i/><i/><span>BetterLearn</span></div>
      <div className="glass-preview-lens">
        <GlassBackdrop frost={frost} radius={20}/>
        <BookOpen size={24} strokeWidth={1.5}/><strong>专注于学习</strong><span>{description}</span>
      </div>
      <span className="glass-preview-caption">实时预览</span>
    </div>
    <div className="appearance-slider-heading"><label htmlFor="glass-frost">玻璃质感</label><output htmlFor="glass-frost">{description}</output></div>
    <input id="glass-frost" type="range" min="0" max="100" step="1" value={frost}
      aria-valuetext={description} aria-describedby="glass-frost-help"
      onChange={event=>onChange(Number(event.currentTarget.value))}/>
    <div className="appearance-slider-labels" aria-hidden="true"><span>通透液态</span><span>磨砂玻璃</span></div>
    <p id="glass-frost-help">调节标题栏、侧栏和收起入口的透明与磨砂程度。内容区保持清晰。</p>
    <p className="appearance-save-status" role="status">{saved ? '实时生效，自动记住你的选择。' : '已生效，但浏览器未能保存。下次打开可能恢复默认。'}</p>
    <p className="appearance-transparency-note">系统已启用“减少透明效果”，当前使用不透明背景；关闭后会恢复所选质感。</p>
  </section>
}
