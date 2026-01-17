/**
 * Backdrop close utilities - ensures modal is only closed when mouse is pressed AND released on the backdrop
 * This prevents accidental closes when user starts a drag inside the modal and releases outside.
 */

/**
 * Creates handlers for proper backdrop close behavior.
 * The modal will only close if the user clicks (mousedown + mouseup) on the backdrop.
 * 
 * Usage:
 * ```tsx
 * const backdropClose = createBackdropClose(onClose);
 * <div class={styles.backdrop} onMouseDown={backdropClose.onMouseDown} onMouseUp={backdropClose.onMouseUp}>
 *   <div class={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
 *     ...content...
 *   </div>
 * </div>
 * ```
 */
export function createBackdropClose(onClose: () => void) {
  let mouseDownOnBackdrop = false;

  return {
    onMouseDown: (e: MouseEvent) => {
      // Only register if the target is the backdrop itself (not bubbled from children)
      if (e.target === e.currentTarget) {
        mouseDownOnBackdrop = true;
      }
    },
    onMouseUp: (e: MouseEvent) => {
      // Only close if mouse was pressed on backdrop AND released on backdrop
      if (mouseDownOnBackdrop && e.target === e.currentTarget) {
        onClose();
      }
      mouseDownOnBackdrop = false;
    }
  };
}
