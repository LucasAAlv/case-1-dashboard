# Case 1: App de dashboard

App que roda dentro da Pipefy, como uma visão do pipe, e permite montar gráficos (dimensão + métrica + agregação + tipo) sobre um pipe de ~20 mil cards. A carga completa acontece uma vez; depois, cada abertura faz só um sync incremental, a partir de um cache local separado por usuário.

- Arquitetura, custo em chamadas, limitações e boas práticas: [docs/arquitetura.md](docs/arquitetura.md)
- Decisões, com alternativas e motivos: [docs/decisoes.md](docs/decisoes.md)
- Leitura da documentação do SDK de Apps: [docs/pesquisa-sdk-apps.md](docs/pesquisa-sdk-apps.md)

**Stack:** TypeScript, Vite, Vitest, Chart.js e IndexedDB (via `idb`). Não há backend: as chamadas à API passam pelo SDK de Apps, com as permissões do usuário logado.

## Requisitos

- Node.js 22 (veja `.nvmrc`)
- Para rodar dentro da Pipefy: ser admin da org (para registrar o app) e uma URL HTTPS pública que sirva o build

## Rodar localmente, sem a Pipefy

```bash
npm ci
```

```bash
npm run dev
```

Abra `http://localhost:5173/pipe-view.html`. Fora da Pipefy não existe `appID` na URL, e o app usa um **SDK falso** com dados sintéticos parecidos com os do pipe do case. Nada é lido da Pipefy.

- Parâmetros opcionais na URL: `?mockCards=20000&mockLatency=100&mockUser=outro-usuario`.
- No console do navegador, `__mockUpdateCard('1477000007')` simula uma edição e `__mockDeleteCard('1477000009')` simula uma exclusão. Depois, clique em "Sincronizar agora".
- O console mostra um erro do SDK real (`Cannot read properties of null`) porque não há `appID` na URL. Fora da Pipefy, isso é esperado.

## Testes e build

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

O build sai em `dist/`, com `manifest.json`, a página de init (`index.html`) e a página do dashboard (`pipe-view.html`). Todos os caminhos são relativos, então o mesmo build funciona em qualquer host. O CI (GitHub Actions) roda typecheck, testes e build a cada push e pull request.

## Rodar dentro da Pipefy

1. **Publique o `dist/` em HTTPS.** Serve qualquer hospedagem estática (GitHub Pages, Cloudflare Pages, Netlify) ou um túnel apontando para `npm run preview`, por exemplo:

   ```bash
   npm run build && npm run preview -- --port 4173
   ```

   ```bash
   cloudflared tunnel --url http://localhost:4173
   ```

   O host não pode mandar `X-Frame-Options: DENY/SAMEORIGIN`. Se houver CSP, o `frame-ancestors` precisa incluir `https://app.pipefy.com`. O `manifest.json` precisa responder com `application/json` e aceitar CORS de `https://app.pipefy.com`.

2. **Registre o app** em https://app.pipefy.com/developers/apps → "Add new app", com um nome e a URL do manifest (`https://<host>/manifest.json`). Um app privado fica visível só na org e não passa por revisão.

3. **Abra o pipe** e escolha a visão **Dashboard** no seletor de visões, ao lado de Kanban, lista e calendário.

A primeira abertura de cada usuário faz a carga completa (~400 chamadas, com progresso na tela). As aberturas seguintes custam cerca de 3 chamadas.

> A Pipefy relê o manifest a cada carregamento. Um deploy quebrado afeta todos os usuários na hora, e um túnel temporário muda de URL a cada reinício. Para a demo, prefira uma hospedagem estática.

## Como usar

1. Escolha a **dimensão** (estado, cidade, empresa sem sufixo, domínio do e-mail, mês da data limite, situação de vencimento...).
2. Escolha a **métrica**: quantidade de cards, ou soma, média, mínimo ou máximo do Valor Total.
3. Escolha o **gráfico** (barras verticais ou horizontais, linha, rosca) e o máximo de grupos. O resto vira "Outros".
4. Clique em **Adicionar visão**. As visões ficam salvas só para você, neste pipe.

"Ver dados" mostra a tabela com os números de cada gráfico. "Limpar cache local" apaga o cache do usuário atual e refaz a carga completa.
