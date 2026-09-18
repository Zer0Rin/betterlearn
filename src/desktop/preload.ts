import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('betterlearnSetup', {
  getState: () => ipcRenderer.invoke('betterlearn:setup-state'),
  usePython: (path: string) => ipcRenderer.invoke('betterlearn:use-python', path),
  selectPython: () => ipcRenderer.invoke('betterlearn:select-python'),
  prepare: () => ipcRenderer.invoke('betterlearn:prepare'),
  retry: () => ipcRenderer.invoke('betterlearn:retry'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on('betterlearn:setup-state', listener)
    return () => ipcRenderer.removeListener('betterlearn:setup-state', listener)
  },
})

contextBridge.exposeInMainWorld('betterlearnDesktop', { platform: process.platform, setFrost: (value: number) => ipcRenderer.invoke('betterlearn:appearance', value) })
