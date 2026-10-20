import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { useMediaController } from '../services/media';
import { TaskbarDock, type DockTab } from './TaskbarDock';

const SIZE_KEY = 'dashboard-size-v1';
const SIZES = ['small', 'medium', 'large'];

function storedSize(): string {
  try {
    const stored = window.localStorage.getItem(SIZE_KEY);
    return stored && SIZES.includes(stored) ? stored : 'medium';
  } catch {
    return 'medium';
  }
}

/** Ana şerit dışındaki ekranların görev çubuğuna konan şerit penceresi (?view=strip&monitor=N). */
export function StripView() {
  const [active, setActive] = useState<DockTab | null>(null);
  const media = useMediaController(true, true);
  const monitor = Number.parseInt(new URLSearchParams(window.location.search).get('monitor') ?? '0', 10);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme');
    document.documentElement.dataset.theme = storedTheme === 'light' ? 'light' : 'dark';
    const stop = listen('dock-closed', () => setActive(null));
    return () => {
      void stop.then((dispose) => dispose());
    };
  }, []);

  const change = (tab: DockTab | null) => {
    setActive(tab);
    if (tab) void invoke('open_panel', { tab, monitor, size: storedSize() }).catch(() => undefined);
    else void invoke('close_panel').catch(() => undefined);
  };

  return (
    <TaskbarDock
      active={active}
      onActiveChange={change}
      onSwitchLayout={() => void emit('strip-switch-layout')}
      onNextSize={() => void emit('strip-next-size')}
      monitorCount={1}
      onNextMonitor={() => undefined}
      media={media}
    />
  );
}
