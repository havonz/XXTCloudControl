import type { TouchPoint } from './multiTouchSession';

const physicalKeyMapping: Readonly<Record<string, string>> = {
  Enter: 'return',
  NumpadEnter: 'return',
  Escape: 'escape',
  Backspace: 'backspace',
  Tab: 'tab',
  Space: 'space',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'homebutton',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ControlLeft: 'command',
  ControlRight: 'command',
  MetaLeft: 'command',
  MetaRight: 'command',
  AltLeft: 'option',
  AltRight: 'option',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  F1: 'f1',
  F2: 'f2',
  F3: 'f3',
  F4: 'f4',
  F5: 'f5',
  F6: 'f6',
  F7: 'f7',
  F8: 'f8',
  F9: 'f9',
  F10: 'f10',
  F11: 'f11',
  F12: 'f12',
};

export function getRemoteKeyFromCode(code: string): string | null {
  // 使用物理键码保留 Shift+2 和不同键盘布局的语义，通道所需的大小写由调用方转换。
  const key = physicalKeyMapping[code];
  if (typeof key === 'string') return key;
  if (code.startsWith('Key') && code.length === 4) return code[3].toLowerCase();
  return null;
}

export function createRemoteMouseMoveBatcher(send: (point: TouchPoint) => void, moveEpsilon: number) {
  let pending: TouchPoint | null = null;
  let frameId: number | null = null;
  let lastSent: TouchPoint | null = null;

  const emitPending = () => {
    if (!pending) return;
    const point = pending;
    pending = null;
    if (lastSent) {
      const dx = point.x - lastSent.x;
      const dy = point.y - lastSent.y;
      // 与已发送位置比较，细小移动累积超过阈值后仍能继续拖动。
      if (dx * dx + dy * dy < moveEpsilon * moveEpsilon) return;
    }
    send(point);
    lastSent = point;
  };

  return {
    schedule(point: TouchPoint) {
      pending = point;
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        emitPending();
      });
    },
    flush() {
      // touch up 之前补发当前帧的末尾坐标，避免拖动终点丢失。
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      emitPending();
    },
    clear() {
      pending = null;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      lastSent = null;
    },
  };
}
