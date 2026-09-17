// LEGO Frontend Framework-Agnostic Contract (Islands Architecture)
export interface LegoComponentMessage<T = unknown> {
  type: 'EVENT' | 'COMMAND' | 'STATE_CHANGE';
  source: 'CANVAS_WASM' | 'NODE_FORM' | 'CATALOG' | 'SHELL';
  payload: T;
  timestamp: number;
}

export interface CanvasPositionEvent {
  nodeId: string;
  x: number;
  y: number;
}

export function dispatchLegoMessage(msg: LegoComponentMessage): void {
  // Pure message passing IPC decoupled from Vue Reactivity / Pinia
  if (typeof window !== 'undefined') {
    window.postMessage({ channel: 'N8N_LEGO_IPC', data: msg }, '*');
  }
}
