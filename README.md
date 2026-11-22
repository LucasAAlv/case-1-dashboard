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

1. **Publique o `dist/` em HTTPS.** O app do case está publicado no GitHub Pages:

   - manifest: https://lucasaalv.github.io/case-1-dashboard/manifest.json
   - a branch `gh-pages` guarda só o build, num commit por publicação, separada do código-fonte

   Para publicar uma nova versão, só a partir da `main`, depois do release:

   ```bash
   git switch main && git pull && npm ci && npm run build
   ```

   O worktree parte do `gh-pages` remoto, e não do local, que pode estar desatualizado e fazer o push ser recusado:

   ```bash
   git fetch origin gh-pages && git worktree add --force -B gh-pages ../gh-pages-publish origin/gh-pages
   ```

   ```bash
   git -C ../gh-pages-publish rm -rq . && cp -r dist/. ../gh-pages-publish/ && touch ../gh-pages-publish/.nojekyll
   ```

   ```bash
   git -C ../gh-pages-publish add -A && git -C ../gh-pages-publish commit -m "chore: publica o build do app" && git -C ../gh-pages-publish push origin gh-pages
   ```

   ```bash
   git worktree remove ../gh-pages-publish
   ```

   O GitHub Pages serve o `manifest.json` como `application/json`, com `Access-Control-Allow-Origin: *`, e não manda `X-Frame-Options`, então o app pode abrir no iframe da Pipefy. Qualquer outra hospedagem estática serve, desde que não mande `X-Frame-Options: DENY/SAMEORIGIN`; se houver CSP, o `frame-ancestors` precisa incluir `https://app.pipefy.com`.

2. **Registre o app** em https://app.pipefy.com/developers/apps → "Add new app", com um nome e a URL do manifest (`https://<host>/manifest.json`). Um app privado fica visível só na org e não passa por revisão.

3. **Ative o app no pipe:** no pipe, **Manage → Tools → Apps**, encontre "Dashboard de Cards" e ative. A documentação de desenvolvedor não descreve esse passo; sem ele, a Pipefy nem carrega o manifest.

4. **Abra a visão Dashboard**, que passa a aparecer na barra de visões do pipe, ao lado de Kanban, List e Reports.

A primeira abertura de cada usuário faz a carga completa, com progresso na tela. No pipe do case (20.000 cards), ela custou 401 chamadas e levou cerca de 2 min e 20 s. As aberturas seguintes custam 3 chamadas: `me`, mais `cards_count` e o incremental.

> A Pipefy relê o manifest a cada carregamento. Um deploy quebrado afeta todos os usuários na hora. Antes da demo, publique, confira e não publique mais nada.

## Como usar

1. Escolha a **dimensão** (estado, cidade, empresa sem sufixo, domínio do e-mail, mês da data limite, situação de vencimento...).
2. Escolha a **métrica**: quantidade de cards, ou soma, média, mínimo ou máximo do Valor Total.
3. Escolha o **gráfico** (barras verticais ou horizontais, linha, rosca) e o máximo de grupos. O resto vira "Outros".
4. Clique em **Adicionar visão**. As visões ficam salvas só para você, neste pipe.

"Ver dados" mostra a tabela com os números de cada gráfico. "Limpar cache local" apaga o cache do usuário atual e refaz a carga completa.
