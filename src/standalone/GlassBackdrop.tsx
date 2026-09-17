import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { glassParameters } from './glass-preference.js'

/** A neutral displacement field with refraction confined to the rounded edges. */
function edgeMap(width: number, height: number, radius: number): string {
  const ratio = Math.min(1, 480 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const context = canvas.getContext('2d')
  if (!context) return ''
  const pixels = context.createImageData(canvas.width, canvas.height)
  const r = Math.min(radius, width / 2, height / 2)
  const rim = Math.max(1, Math.min(18, r || 18, width / 4, height / 4))
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + .5) / canvas.width * width - width / 2
      const py = (y + .5) / canvas.height * height - height / 2
      const qx = Math.abs(px) - (width / 2 - r)
      const qy = Math.abs(py) - (height / 2 - r)
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0)
      const length = Math.hypot(ox, oy)
      const distance = length + Math.min(Math.max(qx, qy), 0) - r
      const nx = length > 0 ? ox / length : qx > qy ? 1 : 0
      const ny = length > 0 ? oy / length : qx > qy ? 0 : 1
      const bend = distance <= 0 && distance > -rim ? Math.cos(-distance / rim * Math.PI / 2) ** 2 : 0
      const offset = (y * canvas.width + x) * 4
      pixels.data[offset] = 128 - Math.sign(px) * nx * bend * 112
      pixels.data[offset + 1] = 128 - Math.sign(py) * ny * bend * 112
      pixels.data[offset + 2] = 128
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas.toDataURL()
}

export function glassVariables(frost: number): CSSProperties {
  const value = glassParameters(frost)
  return {
    '--glass-blur': `${value.blur}px`,
    '--glass-tint': value.tint,
    '--glass-saturation': value.saturation,
    '--glass-rim': .85 - frost / 100 * .45,
  } as CSSProperties
}

/** Only the sampled backdrop is distorted; controls and text stay in a separate layer. */
export function GlassBackdrop({ frost, radius = 12 }: { frost: number; radius?: number }) {
  const id = `glass-${useId().replace(/:/g, '')}`
  const surface = useRef<HTMLSpanElement>(null)
  const [map, setMap] = useState('')
  const [size, setSize] = useState({width: 1, height: 1})
  useEffect(() => {
    const element = surface.current
    if (!element || typeof window === 'undefined') return
    // CSS.supports alone cannot detect SVG backdrop painting. WebKit/Gecko use the blur fallback.
    if (!/(Chrome|Chromium|Edg)\//.test(navigator.userAgent)) return
    const transparency = window.matchMedia?.('(prefers-reduced-transparency: reduce)')
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      if (transparency?.matches) { setMap(''); return }
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        setSize({width: bounds.width, height: bounds.height})
        setMap(edgeMap(bounds.width, bounds.height, radius))
      })
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(element)
    window.addEventListener('resize', update)
    transparency?.addEventListener('change', update)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      transparency?.removeEventListener('change', update)
    }
  }, [radius])
  return <span ref={surface} className="glass-material" aria-hidden="true">
    {map && <svg className="glass-material-definitions" width="0" height="0" focusable="false">
      <defs><filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width={size.width} height={size.height} preserveAspectRatio="none" result="edge-map" />
        <feDisplacementMap in="SourceGraphic" in2="edge-map" scale={glassParameters(frost).refraction} xChannelSelector="R" yChannelSelector="G" />
      </filter></defs>
    </svg>}
    <span className="glass-material-warp" style={map ? {filter:`url(#${id})`} : undefined} />
    <span className="glass-material-tint" />
    <span className="glass-material-rim" />
  </span>
}
