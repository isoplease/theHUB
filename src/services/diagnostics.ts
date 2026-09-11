import { invoke } from '@tauri-apps/api/core';

type FrontendFault = 'frontend-error' | 'unhandled-rejection';

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window;
}

export function startFrontendDiagnostics(): () => void {
  if (!isTauri()) return () => undefined;
  const lastReported = new Map<FrontendFault, number>();
  const report = (kind: FrontendFault) => {
    const now = Date.now();
    if (now - (lastReported.get(kind) ?? 0) < 60_000) return;
    lastReported.set(kind, now);
    void invoke('record_diagnostic_event', { kind }).catch(() => undefined);
  };
  const reportError = () => report('frontend-error');
  const reportRejection = () => report('unhandled-rejection');
  window.addEventListener('error', reportError);
  window.addEventListener('unhandledrejection', reportRejection);
  const heartbeat = () => void invoke('renderer_heartbeat').catch(() => undefined);
  heartbeat();
  const heartbeatTimer = window.setInterval(heartbeat, 3_000);
  return () => {
    window.clearInterval(heartbeatTimer);
    window.removeEventListener('error', reportError);
    window.removeEventListener('unhandledrejection', reportRejection);
  };
}
