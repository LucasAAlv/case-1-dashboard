import type { PipeViewDescriptor } from './pipefy/sdk';

/** Como o dashboard aparece no seletor de visões do pipe. */
export const PIPE_VIEW: PipeViewDescriptor = {
  icon: './icon.svg',
  text: 'Dashboard',
  url: './pipe-view.html',
};

// Página de `init_url`: só registra a feature `pipe-view`, sem UI.
window.PipefyApp?.initCall({ 'pipe-view': () => PIPE_VIEW });
