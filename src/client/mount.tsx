/**
 * Panel view mounting (the dsh-web-ui family pattern, re-implemented): the
 * center column is single-occupant at the DOM level, so the panel appends a
 * container inside `[data-pane="conversation"]` (a trailing child React never
 * manages) and toggles its visibility with a data attribute on <html> — the
 * conversation subtree underneath stays mounted and stateful. Opening this
 * panel evicts sibling plugin panels via their activation attributes and the
 * shared activation event.
 * @module @luoyu_xingu/dsh-multi-root/client/mount
 */

import { createRoot, type Root } from 'react-dom/client'
import type { MultiRootApi } from './api.ts'
import { MultiRootPanel } from './panel/MultiRootPanel.tsx'
import type { PanelController } from './panel/controller.ts'
import css from './panel/panel.module.css'

/** The injected panel container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-dsh-multi-root-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"]'
const ACTIVE_ATTR = 'data-dsh-multi-root-active'
/** The sibling panels' activation attributes, removed when this panel opens. */
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active', 'data-dsh-terminal-active']
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'multi-root'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the panel React tree into the center column and bind its visibility
 * to the controller's panelOpen state.
 * @param controller - the panel controller driving the view.
 * @param api - the wire client the panel operates through.
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountPanel(controller: PanelController, api: MultiRootApi): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const render = (): void => {
    if (root === undefined) return
    root.render(<MultiRootPanel controller={controller} api={api} />)
  }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) {
        render()
        return
      }
      // The conversation pane was replaced; drop the stale tree and remount.
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshMultiRootView = ''
    container.className = css.view
    column.appendChild(container)
    root = createRoot(container)
    render()
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if (detail !== PANEL_NAME && controller.getSnapshot().panelOpen) controller.close()
  }
  // Jump out on sidebar context clicks (the family behavior): clicking a
  // session/workspace row hands the center column back to the conversation.
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
