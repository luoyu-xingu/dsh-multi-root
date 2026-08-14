/**
 * The multi-root management panel: lists the roots attached to the current
 * workspace (with live status), attaches folders via a path input or a host
 * directory browser, and supports rename / remove / reorder. All state is
 * plain React — the workspace binding is passed in by the mount wiring.
 * @module dsh-multi-root/client/panel/MultiRootPanel
 */

import { useEffect, useRef, useState } from 'react'
import type { BrowseDir, RootView } from '../../core/types.ts'
import type { MultiRootApi } from '../api.ts'
import { errorMessage, tt } from '../locales.ts'
import type { PanelController } from './controller.ts'
import css from './panel.module.css'

/** Panel props: the controller, the wire client, and the bound workspace cwd. */
export interface MultiRootPanelProps {
  controller: PanelController
  api: MultiRootApi
  /** The active session's cwd ('' when no workspace is bound). */
  workspace: string
}

/** One root row: status, name, path, and the action buttons. */
function RootRow(props: {
  root: RootView
  index: number
  count: number
  renaming: boolean
  renameValue: string
  busy: boolean
  onRenameValue: (value: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
}): React.ReactElement {
  const { root, index, count, renaming, renameValue, busy } = props
  return (
    <div className={css.rootRow} data-root-id={root.id}>
      <span className={root.status === 'ok' ? css.statusDot : `${css.statusDot} ${css.statusMissing}`} title={root.status === 'ok' ? tt('panel.root.statusOk') : tt('panel.root.statusMissing')} />
      <div className={css.rootInfo}>
        {renaming
          ? (
              <div className={css.renameRow}>
                <input className={css.renameInput} value={renameValue} onChange={event => { props.onRenameValue(event.target.value) }} onKeyDown={event => {
                  if (event.key === 'Enter') props.onCommitRename()
                  if (event.key === 'Escape') props.onCancelRename()
                }} autoFocus />
                <button type="button" className={css.miniButton} onClick={props.onCommitRename} disabled={busy || renameValue.trim() === ''}>{tt('panel.root.saveName')}</button>
                <button type="button" className={css.miniButton} onClick={props.onCancelRename} disabled={busy}>{tt('panel.root.cancel')}</button>
              </div>
            )
          : (
              <span className={css.rootName}>{root.name}</span>
            )}
        <span className={css.rootPath} title={root.path}>{root.path}</span>
      </div>
      <div className={css.rootActions}>
        {!renaming && (
          <button type="button" className={css.iconButton} title={tt('panel.root.rename')} onClick={props.onStartRename} disabled={busy}>R</button>
        )}
        <button type="button" className={css.iconButton} title={tt('panel.root.moveUp')} onClick={() => { props.onMove(-1) }} disabled={busy || index === 0}>{'\u2191'}</button>
        <button type="button" className={css.iconButton} title={tt('panel.root.moveDown')} onClick={() => { props.onMove(1) }} disabled={busy || index === count - 1}>{'\u2193'}</button>
        <button type="button" className={css.iconButton} title={tt('panel.root.remove')} onClick={props.onRemove} disabled={busy}>{'\u00d7'}</button>
      </div>
    </div>
  )
}

/** The host directory browser overlay. */
function BrowseDialog(props: {
  path: string
  dirs: BrowseDir[]
  busy: boolean
  onEnter: (path: string) => void
  onUp: () => void
  onSelect: () => void
  onClose: () => void
}): React.ReactElement {
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label={tt('panel.browse.title')}>
      <div className={css.dialog}>
        <div className={css.dialogHeader}>
          <span>{tt('panel.browse.title')}</span>
          <button type="button" className={css.iconButton} onClick={props.onClose} disabled={props.busy}>{'\u00d7'}</button>
        </div>
        <div className={css.dialogPath} title={props.path}>{tt('panel.browse.current')}: {props.path}</div>
        <div className={css.dialogDirs}>
          {props.dirs.map(dir => (
            <button type="button" key={dir.path} className={css.dirRow} disabled={props.busy} onClick={() => { props.onEnter(dir.path) }}>
              <span className={css.dirIcon}>D</span>
              <span className={css.dirName}>{dir.name}</span>
            </button>
          ))}
          {props.dirs.length === 0 && <div className={css.dirEmpty}>{tt('panel.empty')}</div>}
        </div>
        <div className={css.dialogFooter}>
          <button type="button" className={css.miniButton} onClick={props.onUp} disabled={props.busy}>{tt('panel.browse.up')}</button>
          <span className={css.dialogSpacer} />
          <button type="button" className={css.miniButton} onClick={props.onClose} disabled={props.busy}>{tt('panel.browse.cancel')}</button>
          <button type="button" className={css.primaryButton} onClick={props.onSelect} disabled={props.busy}>{tt('panel.browse.select')}</button>
        </div>
      </div>
    </div>
  )
}

/** The multi-root management panel. */
export function MultiRootPanel(props: MultiRootPanelProps): React.ReactElement {
  const { controller, api, workspace } = props
  const [roots, setRoots] = useState<RootView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [addName, setAddName] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browsePath, setBrowsePath] = useState('')
  const [browseDirs, setBrowseDirs] = useState<BrowseDir[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const loadSeq = useRef(0)

  const reload = async (): Promise<void> => {
    const seq = ++loadSeq.current
    if (workspace === '') {
      setRoots([])
      setLoadError(null)
      return
    }
    try {
      const result = await api.roots(workspace)
      if (seq !== loadSeq.current) return
      setRoots(result.roots)
      setLoadError(null)
    } catch (error) {
      if (seq !== loadSeq.current) return
      setRoots([])
      setLoadError(errorMessage(error))
    }
  }

  useEffect(() => {
    void reload()
    // The workspace binding changes when the user switches sessions.
  }, [workspace])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      await reload()
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const add = (): void => {
    void run(async () => {
      await api.add(workspace, addPath.trim(), addName.trim())
      setAddPath('')
      setAddName('')
    })
  }

  const remove = (id: string): void => {
    void run(async () => { await api.remove(workspace, id) })
  }

  const commitRename = (id: string): void => {
    void run(async () => {
      await api.rename(workspace, id, renameValue.trim())
      setRenamingId(null)
    })
  }

  const move = (id: string, direction: -1 | 1): void => {
    if (roots === null) return
    const index = roots.findIndex(root => root.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= roots.length) return
    const ids = roots.map(root => root.id)
    ids.splice(index, 1)
    ids.splice(target, 0, id)
    void run(async () => { await api.reorder(workspace, ids) })
  }

  const openBrowse = (): void => {
    setBrowseOpen(true)
    setBrowsePath('')
    void api.browse('').then(result => { setBrowsePath(result.path); setBrowseDirs(result.dirs) }).catch(error => { setLoadError(errorMessage(error)) })
  }

  const enterBrowse = (path: string): void => {
    setBrowsePath(path)
    void api.browse(path).then(result => { setBrowsePath(result.path); setBrowseDirs(result.dirs) }).catch(error => { setLoadError(errorMessage(error)) })
  }

  const browseUp = (): void => {
    const separator = browsePath.includes('\\') ? '\\' : '/'
    const trimmed = browsePath.replace(/[\\/]+$/, '')
    const cut = Math.max(trimmed.lastIndexOf(separator), trimmed.indexOf(':') + 1)
    const parent = cut > 0 ? trimmed.slice(0, cut) : browsePath
    if (parent !== browsePath) enterBrowse(parent)
  }

  const selectBrowse = (): void => {
    setAddPath(browsePath)
    setBrowseOpen(false)
  }

  return (
    <div className={css.panel} data-dsh-multi-root-panel="">
      <div className={css.header}>
        <span className={css.title}>{tt('panel.title')}</span>
        <button type="button" className={css.iconButton} title="close" onClick={() => { controller.close() }}>{'\u00d7'}</button>
      </div>

      {workspace === ''
        ? <div className={css.empty}>{tt('panel.noWorkspace')}</div>
        : (
            <>
              <div className={css.workspaceRow}>
                <span className={css.workspaceLabel}>{tt('panel.workspace')}</span>
                <span className={css.workspacePath} title={workspace}>{workspace}</span>
              </div>

              <div className={css.addSection}>
                <div className={css.addTitle}>{tt('panel.add.title')}</div>
                <div className={css.addRow}>
                  <input className={css.addInput} value={addPath} placeholder={tt('panel.add.pathPlaceholder')} onChange={event => { setAddPath(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') add() }} />
                  <button type="button" className={css.miniButton} onClick={openBrowse} disabled={busy}>{tt('panel.add.browse')}</button>
                  <button type="button" className={css.primaryButton} onClick={add} disabled={busy || addPath.trim() === ''}>{tt('panel.add.submit')}</button>
                </div>
                <div className={css.addRow}>
                  <input className={css.addInput} value={addName} placeholder={tt('panel.add.namePlaceholder')} onChange={event => { setAddName(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') add() }} />
                </div>
                <div className={css.hint}>{tt('panel.add.hint')}</div>
              </div>

              {loadError !== null && <div className={css.error}>{tt('panel.error.load')}: {loadError}</div>}

              <div className={css.rootsList}>
                {roots === null && <div className={css.empty}>...</div>}
                {roots !== null && roots.length === 0 && <div className={css.empty}>{tt('panel.empty')}</div>}
                {roots?.map((root, index) => (
                  <RootRow
                    key={root.id}
                    root={root}
                    index={index}
                    count={roots.length}
                    busy={busy}
                    renaming={renamingId === root.id}
                    renameValue={renameValue}
                    onRenameValue={setRenameValue}
                    onStartRename={() => { setRenamingId(root.id); setRenameValue(root.name) }}
                    onCommitRename={() => { commitRename(root.id) }}
                    onCancelRename={() => { setRenamingId(null) }}
                    onRemove={() => { remove(root.id) }}
                    onMove={direction => { move(root.id, direction) }}
                  />
                ))}
              </div>

              <div className={css.footer}>{tt('panel.footer.hint')}</div>
            </>
          )}

      {browseOpen && (
        <BrowseDialog
          path={browsePath}
          dirs={browseDirs}
          busy={busy}
          onEnter={enterBrowse}
          onUp={browseUp}
          onSelect={selectBrowse}
          onClose={() => { setBrowseOpen(false) }}
        />
      )}
    </div>
  )
}
