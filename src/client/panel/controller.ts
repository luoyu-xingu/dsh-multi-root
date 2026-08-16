/**
 * The panel controller: a tiny store driving the sidebar entry highlight and
 * the panel view visibility. Plain TS so both the DOM-level sidebar entry and
 * the React panel can subscribe without a shared runtime.
 * @module @luoyu_xingu/dsh-multi-root/client/panel/controller
 */

/** One controller snapshot. */
export interface PanelSnapshot {
  /** Whether the multi-root panel currently owns the center column. */
  panelOpen: boolean
}

/** Listener over the controller snapshot. */
type Listener = () => void

/** Toggle/open/close the multi-root panel. */
export class PanelController {
  private panelOpen = false
  private readonly listeners = new Set<Listener>()

  /** The current snapshot. */
  getSnapshot(): PanelSnapshot {
    return { panelOpen: this.panelOpen }
  }

  /** Subscribe to snapshot changes; returns the unsubscriber. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Flip the panel visibility. */
  toggle(): void {
    this.panelOpen = !this.panelOpen
    this.emit()
  }

  /** Open the panel. */
  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.emit()
  }

  /** Close the panel. */
  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.emit()
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
