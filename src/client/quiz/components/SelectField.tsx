import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

interface Option { value: string; label: string }
interface Props { label: string; value: string; options: Option[]; onChange(value: string): void; disabled?: boolean }

/** A select-only combobox keeps the menu in the page's coordinate and font system. */
export function SelectField({ label, value, options, onChange, disabled }: Props) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState({ above: false, height: 240 })
  const selected = options.findIndex(option => option.value === value)
  const choose = (index: number) => {
    if (options[index]) onChange(options[index].value)
    setOpen(false)
    trigger.current?.focus()
  }
  const show = () => { setActive(Math.max(0, selected)); setOpen(true) }

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const useAbove = below < Math.min(240, options.length * 38 + 10) && above > below
      setPlacement({ above: useAbove, height: Math.max(40, Math.min(240, useAbove ? above : below)) })
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    position()
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open, options.length])

  useEffect(() => {
    if (!open) return
    const item = list.current?.children[active] as HTMLElement | undefined
    if (item && list.current) {
      const top = item.offsetTop
      const bottom = top + item.offsetHeight
      if (top < list.current.scrollTop) list.current.scrollTop = top
      else if (bottom > list.current.scrollTop + list.current.clientHeight) list.current.scrollTop = bottom - list.current.clientHeight
    }
  }, [active, open])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      if (!open) {
        show()
        if (event.key === 'Home') setActive(0)
        if (event.key === 'End') setActive(options.length - 1)
      } else if (event.key === 'Enter' || event.key === ' ') choose(active)
      else if (event.key === 'Home') setActive(0)
      else if (event.key === 'End') setActive(options.length - 1)
      else setActive(index => Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <div className="zl-field zl-select" ref={root}>
    <span id={`${id}-label`}>{label}</span>
    <div className="zl-select-control"><button ref={trigger} type="button" role="combobox" className="zl-select-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-list` : undefined} aria-activedescendant={open && options[active] ? `${id}-option-${active}` : undefined} disabled={disabled || !options.length} onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown} onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node)) setOpen(false) }}>
      <span id={`${id}-value`}>{options[selected]?.label ?? '请选择'}</span><ChevronDown size={15} />
    </button>
    {open && <div ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className={`zl-select-menu${placement.above ? ' zl-select-menu-above' : ''}`} style={{ maxHeight: placement.height }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} className={`zl-select-option${index === active ? ' zl-select-active' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}><span>{option.label}</span>{option.value === value && <Check size={14} />}</div>)}
    </div>}</div>
  </div>
}
