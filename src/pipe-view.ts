import './ui/styles.css';
import { startDashboard } from './app/dashboard-app';

const root = document.getElementById('app')!;

async function main() {
  // Fora da Pipefy não há `appID` na URL e o SDK real não funciona. Em
  // desenvolvimento, troca pelo SDK falso; o import dinâmico mantém o mock fora
  // do build de produção.
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has('appID')) {
    const { installMockSdk } = await import('./pipefy/mock-sdk');
    installMockSdk();
  }

  const sdk = window.PipefyApp;
  if (!sdk) {
    root.textContent = 'O SDK da Pipefy não carregou. Abra o app pela visão do pipe.';
    return;
  }

  const p = sdk.init();
  // `render` avisa a Pipefy que a página carregou; sem ele, o usuário volta ao
  // Kanban. Não usar `p.render()`: está quebrado segundo a documentação.
  sdk.render(() => {
    startDashboard(sdk, p, root).catch((error: unknown) => {
      console.error('[dashboard] falha ao iniciar', error);
      root.textContent = `Não foi possível iniciar o dashboard: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

void main();
