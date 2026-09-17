import { createContext, useContext, type AnchorHTMLAttributes } from 'react'
const Navigation = createContext<(path: string) => void>(() => {})
export const RouteProvider = Navigation.Provider
export const useNavigate = () => useContext(Navigation)
/** Host-owned navigation: links never write to the harness URL. */
export function LocalLink({ href = '/', children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate()
  const route = href.replace(/^#/, '')
  return <a {...props} href={route} onClick={event => { event.preventDefault(); navigate(route) }}>{children}</a>
}
