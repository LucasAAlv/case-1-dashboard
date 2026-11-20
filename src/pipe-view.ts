import './ui/styles.css';
import { startDashboard } from './app/dashboard-app';

const root = document.getElementById('app')!;

async function main() {
  // Fora da Pipefy não há `appID` na URL e o SDK real não funciona. Em
  // desenvolvimento, troca pelo SDK falso; o import dinâmico mantém o mock fora
  // do build de produção.
  const insidePipefy = new URLSearchParams(location.search).has('appID');
  if (import.meta.env.DEV && !insidePipefy) {
    const { installMockSdk } = await import('./pipefy/mock-sdk');
    installMockSdk();
  } else if (!insidePipefy) {
    // A URL publicada aberta direto no navegador: sem `appID`, o `init()` do
    // SDK real lança erro e a página ficaria em branco.
    root.textContent = 'Este app roda dentro da Pipefy. Abra o pipe e escolha a visão Dashboard.';
    return;
  }

  const sdk = window.PipefyApp;
  if (!sdk) {
    root.textContent = 'O SDK da Pipefy não carregou. Abra o app pela visão do pipe.';
    return;
  }

  let p: ReturnType<typeof sdk.init>;
  try {
    p = sdk.init();
  } catch (error) {
    console.error('[dashboard] falha no init do SDK', error);
    root.textContent = 'Não foi possível conectar à Pipefy. Recarregue a visão Dashboard do pipe.';
    return;
  }
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
