import { Component, JSX, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import styles from './ContextMenu.module.css';

export interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  children: JSX.Element;
  label?: string;
}

/**
 * Unified context menu component with edge detection.
 * - Desktop: positioned at cursor with automatic viewport boundary adjustment
 * - Mobile: bottom sheet style with slide-up animation
 */
const ContextMenu: Component<ContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined;
  const [adjustedPosition, setAdjustedPosition] = createSignal({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = createSignal(false);
  const [canClose, setCanClose] = createSignal(true);

  // Check if mobile on mount and resize
  const checkMobile = () => {
    setIsMobile(window.innerWidth <= 768);
  };

  onMount(() => {
    checkMobile();
    window.addEventListener('resize', checkMobile);
  });

  onCleanup(() => {
    window.removeEventListener('resize', checkMobile);
  });

  // Adjust position to stay within viewport bounds (desktop only)
  createEffect(() => {
    if (!props.isOpen || !menuRef || isMobile()) {
      return;
    }

    // Use requestAnimationFrame to ensure the menu is rendered before measuring
    requestAnimationFrame(() => {
      if (!menuRef) return;
      
      const rect = menuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let x = props.position.x;
      let y = props.position.y;
      
      // Check right edge
      if (x + rect.width > viewportWidth - 8) {
        x = Math.max(8, props.position.x - rect.width);
      }
      
      // Check bottom edge
      if (y + rect.height > viewportHeight - 8) {
        y = Math.max(8, props.position.y - rect.height);
      }
      
      // Ensure minimum margins
      x = Math.max(8, Math.min(x, viewportWidth - rect.width - 8));
      y = Math.max(8, Math.min(y, viewportHeight - rect.height - 8));
      
      setAdjustedPosition({ x, y });
    });
  });

  // Initialize position when menu opens + add protection period for mobile
  createEffect(() => {
    if (props.isOpen) {
      setAdjustedPosition({ x: props.position.x, y: props.position.y });
      
      // On mobile, add a short protection period to prevent immediate close
      // This happens because long-press opens menu, then touchend fires on backdrop
      if (isMobile()) {
        setCanClose(false);
        setTimeout(() => setCanClose(true), 300);
      }
    }
  });

  // Handler that checks if closing is allowed
  const handleClose = () => {
    if (canClose()) {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <div 
        class={`${styles.contextBackdrop} ${isMobile() ? styles.mobileBackdrop : ''}`}
        onClick={handleClose}
        onContextMenu={(e) => { e.preventDefault(); handleClose(); }}
      >
        <div 
          ref={menuRef}
          class={`${styles.contextMenu} ${isMobile() ? styles.mobileMenu : ''}`}
          style={isMobile() ? {} : { 
            left: `${adjustedPosition().x}px`, 
            top: `${adjustedPosition().y}px` 
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <Show when={props.label}>
            <div class={styles.contextMenuLabel}>{props.label}</div>
          </Show>
          {props.children}
        </div>
      </div>
    </Show>
  );
};

// Sub-components for consistent menu structure
export const ContextMenuButton: Component<{
  onClick: () => void;
  icon?: JSX.Element;
  children: JSX.Element;
  danger?: boolean;
  disabled?: boolean;
}> = (props) => {
  return (
    <button 
      class={`${styles.menuButton} ${props.danger ? styles.dangerButton : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Show when={props.icon}>
        {props.icon}
      </Show>
      {props.children}
    </button>
  );
};

export const ContextMenuDivider: Component = () => {
  return <div class={styles.contextMenuDivider} />;
};

export const ContextMenuSection: Component<{
  label?: string;
  children: JSX.Element;
}> = (props) => {
  return (
    <div class={styles.contextMenuSection}>
      <Show when={props.label}>
        <div class={styles.contextMenuLabel}>{props.label}</div>
      </Show>
      {props.children}
    </div>
  );
};

export default ContextMenu;
