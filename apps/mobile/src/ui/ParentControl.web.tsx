/** @file Connects browser pointer and keyboard input to the timed parent unlock control. */

import { useParentHold } from './useParentHold';
import { theme } from './theme';
import type { ParentControlProps } from './ParentControl';
/**
 * Render the web unlock button with shared readiness timing, cancelling interrupted holds before
 * requesting exit.
 */
export function ParentControl({ cancelToken, onExitRequest }: ParentControlProps) {
  const hold = useParentHold(cancelToken);
  return <button type="button" data-testid="parent-control" aria-label="Hold to unlock. Hold for two seconds and release." style={{ minWidth: 130, minHeight: 48, border: 0, borderRadius: 15, background: theme.accentSoft, color: theme.accent, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 14, fontWeight: 700, padding: '10px 16px', touchAction: 'none', userSelect: 'none', cursor: 'pointer' }}
    onContextMenu={event => event.preventDefault()}
    onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); hold.down(event.pointerId, { x: event.clientX, y: event.clientY }); }}
    onPointerMove={event => hold.move(event.pointerId, { x: event.clientX, y: event.clientY })}
    onPointerUp={event => { if (hold.up(event.pointerId)) onExitRequest(); }}
    onPointerCancel={event => hold.cancelContact(event.pointerId)} onLostPointerCapture={event => hold.cancelContact(event.pointerId)}
    onClick={event => { if (event.detail === 0) onExitRequest(); }}>{hold.label}</button>;
}
