import { BookOpen } from 'lucide-react'
import { GlassBackdrop } from './GlassBackdrop.js'

export interface GlassAppearance {
  frost: number
  onChange(value: number): void
  componentOpacity?: number
  onComponentChange?(value:number): void
  saved: boolean
}

export function AppearanceSettings({ frost, onChange, saved, componentOpacity = 85, onComponentChange }: GlassAppearance) {
  const desktop = typeof window !== 'undefined' && 'betterlearnDesktop' in window
  const description = `不透明度 ${frost}%`
  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <header><h2 id="appearance-title">外观</h2><span>两层独立调节</span></header>
    {!desktop && <div className="glass-preview" aria-label="玻璃效果实时预览">
      <div className="glass-preview-scene" aria-hidden="true"><i/><i/><i/><span>BetterLearn</span></div>
      <div className="glass-preview-lens">
        <GlassBackdrop frost={frost} radius={20}/>
        <BookOpen size={24} strokeWidth={1.5}/><strong>专注于学习</strong><span>{description}</span>
      </div>
      <span className="glass-preview-caption">实时预览</span>
    </div>
    }
    {desktop && <p>下层是整个窗口的玻璃背景，上层是导航、卡片和表单。两层可分别调节。</p>}
    <div className="appearance-slider-heading"><label htmlFor="glass-frost">窗口背景</label><output htmlFor="glass-frost">{description}</output></div>
    <input id="glass-frost" type="range" min="0" max="100" step="1" value={frost}
      aria-valuetext={description} aria-describedby="glass-frost-help"
      onChange={event=>onChange(Number(event.currentTarget.value))}/>
    <div className="appearance-slider-labels" aria-hidden="true"><span>通透</span><span>不透明</span></div>
    <p id="glass-frost-help">调节整个窗口下层背景，包含主内容区。不会改变上层组件的底色浓度。</p>
    {onComponentChange && <div className="component-appearance">
      <div className="appearance-slider-heading"><label htmlFor="component-opacity">组件底色</label><output htmlFor="component-opacity">不透明度 {componentOpacity}%</output></div>
      <input id="component-opacity" type="range" min="0" max="100" step="1" value={componentOpacity}
        aria-valuetext={`不透明度 ${componentOpacity}%`} aria-describedby="component-opacity-help"
        onChange={event=>onComponentChange(Number(event.currentTarget.value))}/>
      <div className="appearance-slider-labels" aria-hidden="true"><span>通透</span><span>实色</span></div>
      <p id="component-opacity-help">调节导航、卡片、表单和输入框的底色。文字、图标及操作按钮保持清晰。</p>
    </div>}
    <p className="appearance-save-status" role="status">{saved ? '实时生效，自动记住你的选择。' : '已生效，但浏览器未能保存。下次打开可能恢复默认。'}</p>
    <p className="appearance-transparency-note">系统已启用“减少透明效果”，当前使用不透明背景；关闭后会恢复所选质感。</p>
  </section>
}
