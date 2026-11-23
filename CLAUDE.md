# CLAUDE.md

Guia para agentes (Claude Code) que trabalham neste repositório. Documentação, comentários e mensagens em **português do Brasil**; nomes no código (variáveis, funções, arquivos) em inglês.

## Objetivo

App de dashboard que roda **dentro da Pipefy**, como uma visão (`pipe-view`) do pipe, feito com o SDK de Apps. O usuário monta os próprios gráficos (dimensão + métrica + agregação + tipo) sobre um pipe de ~20 mil cards.

- A carga completa acontece uma vez. Depois, cada abertura faz só o sync incremental.
- O cache é local e **separado por usuário**: um usuário nunca vê dados que vieram com as permissões de outro.
- Não há backend. Toda chamada à API passa pelo `p.query` do SDK, com as permissões de quem está logado. O app não guarda token.

Antes de propor qualquer mudança de desenho, leia:

- [docs/decisoes.md](docs/decisoes.md): decisões D1 a D12, com alternativas e motivos;
- [docs/arquitetura.md](docs/arquitetura.md): fluxo de sync, custo em chamadas, limitações e testes;
- [docs/pesquisa-sdk-apps.md](docs/pesquisa-sdk-apps.md): o que foi lido e testado do SDK de Apps;
- [docs/debito-tecnico.md](docs/debito-tecnico.md): DT1 a DT9, o que se sabe que falta.

## Stack

- TypeScript estrito (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), sem framework de UI.
- Vite com duas páginas: `index.html` (init, só registra a feature) e `pipe-view.html` (o dashboard). `base: './'`, então o build roda em qualquer host.
- Vitest, com `fake-indexeddb` nos testes de integração.
- Chart.js para os gráficos e `idb` sobre o IndexedDB.
- Node 22 (`.nvmrc`). Versões exatas no `package.json` (`.npmrc` com `save-exact=true`).
- CI no GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)): typecheck, testes unitários, testes de integração e build, a cada push na `main` ou na `develop` e a cada PR.

## Comandos

```bash
npm ci                    # instala exatamente o lock
npm run dev               # http://localhost:5173/pipe-view.html, com o SDK falso
npm run typecheck         # tsc --noEmit
npm test                  # todos os testes
npm run test:unit         # só test/unit
npm run test:integration  # só test/integration
npm run build             # gera dist/ (manifest, init e pipe-view)
```

Fora da Pipefy não há `appID` na URL, e o app usa o SDK falso ([src/pipefy/mock-sdk.ts](src/pipefy/mock-sdk.ts)) com dados sintéticos. Os parâmetros, os atalhos no console e o erro esperado estão no [README](README.md#rodar-localmente-sem-a-pipefy).

Antes de dar uma tarefa por concluída, rode `npm run typecheck`, `npm test` e `npm run build`.

## Estrutura

| Pasta | Responsabilidade | Arquivo de referência |
| --- | --- | --- |
| `src` (raiz) | Pontos de entrada: `init.ts` registra a feature `pipe-view`; `pipe-view.ts` escolhe entre o SDK real e o falso, avisa quando a página abre fora da Pipefy e fixa o tema claro (D10) | `init.ts`, `pipe-view.ts` |
| `src/domain` | Card normalizado, parser e conversões | `normalize.ts`, `card-parser.ts` |
| `src/sync` | Cliente GraphQL sobre o `p.query`, queries do `allCards`, marca d'água e motor de sync | `pipefy-api.ts`, `sync-engine.ts` |
| `src/cache` | Contrato do cache (`CardStore`) e implementação em IndexedDB | `card-store.ts`, `idb-store.ts` |
| `src/analytics` | Agregação com limite de grupos e "Outros" | `aggregate.ts` |
| `src/charts` | Definição e validação das visões, persistência no `p.set` e render com Chart.js | `chart-spec.ts`, `chart-repository.ts` |
| `src/ui`, `src/app` | Tela e orquestração | `dashboard-view.ts`, `dashboard-app.ts` |
| `src/pipefy` | Tipos do SDK e SDK falso | `sdk.ts`, `mock-sdk.ts` |

O motor de sync depende só das interfaces `PipefyApi` e `CardStore`, e não do SDK nem do IndexedDB. Mantenha isso: é o que permite testar o sync com um pipe falso.

## Schema

### Pipe de origem (API)

Pipe 307434671, uma fase ("Concluded", `done: true`). Todos os campos estão no formulário inicial. **Mapeie sempre pelo `field.id`**: a ordem de `fields` muda de card para card. A API devolve todo `value` como string.

| `field.id` | Valor na API | Vira no cache |
| --- | --- | --- |
| `nome_contato` | string | `contactName` |
| `email` | string | `email` e a derivada `emailDomain` |
| `empresa` | string, com sufixo ("Acme Holding") | `company` e a derivada `companyBase` |
| `cidade` | string sem acento | `city` |
| `estado` | UF | `state` |
| `valor_total` | string com ponto decimal ("1285947.3") | `totalValue` (number) |
| `data_limite` | string DD/MM/AAAA | `dueDate` (ISO) e a derivada `dueMonth` (AAAA-MM) |

Fatos da API que o código já trata e que não podem ser quebrados:

- `allCards(pipeId, first: 50)`. O máximo é 50 por página, e uma carga completa custa ~401 chamadas.
- Paginação por cursor (`pageInfo { hasNextPage endCursor }`, `after`), em ordem crescente de id.
- O filtro só aceita `updated_at` e `due_date`. O `updated_at` vem em UTC, com resolução de segundo.
- **Erros vêm com HTTP 200** e um array `errors`. O `p.query` nunca rejeita: sempre verifique `errors`.
- Valores dinâmicos entram na query como literais escapados com `JSON.stringify`, e o `pipeId` é validado como numérico (D6).

### Cache local (IndexedDB)

- Um banco por usuário e pipe: `pipefy-dashboard:<me.id>:<pipeId>` (D3). Nunca crie um banco compartilhado nem filtre por usuário numa query.
- `VERSION = 1` em [src/cache/idb-store.ts](src/cache/idb-store.ts), com dois stores:
  - `cards`: `CardRecord` ([src/domain/card.ts](src/domain/card.ts)), chave `id`;
  - `meta`: chave `'sync'`, valor `SyncState` ([src/cache/card-store.ts](src/cache/card-store.ts)), com `phase`, `cursor`, `startedAt`, `watermark`, `lastSyncAt` e `reconciledPipeCount`.
- Cards e estado gravam **na mesma transação** (`commit`): o cursor nunca fica à frente dos dados.
- A marca d'água é o início do último sync concluído, com margem de 5 min, e nunca anda para trás (D4).
- Campo novo no `CardRecord` **não** muda o `VERSION`: o IndexedDB guarda o objeto inteiro, sem schema. Os registros antigos só ficam sem o campo (ver DT3).
- Criar, remover ou alterar um store ou índice exige subir o `VERSION`. O `upgrade()` atual cria os dois stores sem condição e lançaria `ConstraintError` num banco que já existe: ele precisa passar a ramificar por `oldVersion`. É mudança no modelo de dados: proponha antes.

### Visões (SDK)

- `p.set('pipe', 'private', 'charts', <JSON de ChartSpec[]>)`, ou seja, por usuário e por pipe.
- Tudo o que vem do `p.get` é validado item a item ([src/charts/chart-spec.ts](src/charts/chart-spec.ts)). Se a leitura falhar, a edição fica bloqueada, para não sobrescrever as visões salvas.
- Limites: `MAX_CHARTS = 24`, `MAX_TITLE = 80`, `MAX_LIMIT = 50`.

## Testes

A pasta `test/` espelha a estrutura de `src/` (D11):

- **`test/unit`**: uma unidade isolada. Função pura, ou um módulo com o SDK simulado por `vi.fn`. Exemplo: [test/unit/domain/normalize.test.ts](test/unit/domain/normalize.test.ts).
- **`test/integration`**: mais de um módulo real junto (motor de sync, parser e marca d'água) ou a biblioteca de armazenamento real (`idb` sobre o `fake-indexeddb`). O pipe falso fica em [test/integration/helpers/fake-pipe.ts](test/integration/helpers/fake-pipe.ts).

Convenções:

- `describe` com o nome da função ou do módulo, e `it` com uma frase em português que diz o comportamento ("devolve null para vazio, nulo ou texto não numérico").
- Toda regra nova de parser, conversão, marca d'água ou agregação ganha teste, incluindo campo vazio ou nulo e campos fora de ordem.
- A tela, a orquestração e a entrada da página (`src/app`, `src/ui`, `render-chart.ts`, `pipe-view.ts`) não têm teste automatizado (DT7). Mudanças nelas são validadas no `npm run dev` com o SDK falso e, quando dependem da Pipefy, dentro do pipe.

## Padrão para novas funcionalidades

**Sempre se baseie em algo que já existe.** Antes de criar um arquivo, leia o vizinho do mesmo domínio (tabela de Estrutura) e siga o mesmo padrão. Não invente convenção nova.

Caminhos já usados no código:

- **Nova dimensão derivada** (calculada no sync):
  1. função pura em `src/domain/normalize.ts`, com teste em `test/unit/domain/normalize.test.ts`;
  2. campo novo em `CardRecord` e cálculo em `parseCard`;
  3. entrada no tipo `Dimension` e no `ORDER` de `src/analytics/aggregate.ts`;
  4. rótulo em `DIMENSIONS` de `src/charts/chart-spec.ts`.

  Os caches existentes não são reprocessados (DT3). Nenhum sync refaz a carga completa sozinho, então o campo novo fica nulo nos caches que já existem até o usuário usar "Limpar cache local". Diga isso ao propor.
- **Nova dimensão que depende de hoje**: siga o `dueStatus`, calculado no `keyOf` da agregação e nunca gravado no cache (D8).
- **Nova agregação**: `Aggregation` e `finalize` em `aggregate.ts`, depois `AGGREGATIONS` em `chart-spec.ts`, com teste em `test/unit/analytics/aggregate.test.ts`.
- **Novo tipo de gráfico**: `ChartType` e `CHART_TYPES` em `chart-spec.ts`, depois o mapeamento em `src/charts/render-chart.ts`.
- **Nova leitura da API**: método novo na interface `PipefyApi` (`src/sync/pipefy-api.ts`), com query literal escapada, implementação no pipe falso dos testes e no SDK falso.

Regras de código que já valem no projeto:

- Texto vindo de card entra no DOM só por `textContent`. Nunca use `innerHTML` com dado externo.
- Normalização acontece uma vez, na entrada do sync. O gráfico não reprocessa string da API.
- Campo ausente ou vazio vira `null`, sem quebrar o parser.
- Comentários explicam o porquê e citam a decisão (`D4 em docs/decisoes.md`) quando ela existe.
- Estilo do código atual: 2 espaços, aspas simples, ponto e vírgula, LF. Não há formatador configurado (DT8).

## Como trabalhar aqui

- **Decisão de desenho vem antes do código.** Mudança de arquitetura, biblioteca nova, mudança no modelo de dados ou no schema do cache: proponha as opções com os trade-offs e espere a decisão. Na dúvida, pergunte antes de assumir.
- Escopo exato do pedido: não refatore código adjacente e não acrescente comentário em código que não foi tocado. Dependência nova só com necessidade real, e com decisão.
- **Não invente API.** O que não estiver testado em `docs/` ou no código sobre o SDK de Apps ou a API GraphQL deve ser conferido em https://developers.pipefy.com e https://api-docs.pipefy.com, ou testado no GraphiQL.
- **Os dados da org pertencem à banca.** Nada de mutation em cards, pipes ou databases sem pedido explícito. Toda alteração de teste é revertida.
- **Segredos nunca entram no repositório**, que é público. O app não usa token. Se um dia precisar, vai para `.env` (já no `.gitignore`), com um `.env.example` sem valores.
- Decisão relevante entra em `docs/decisoes.md` (próximo `D<n>`, com data, escolha, alternativas e motivo). Limitação ou débito novo entra em `docs/arquitetura.md` ou `docs/debito-tecnico.md`. O README e a pasta `docs/` são atualizados junto com o código.
- Respostas sem preâmbulo e sem resumo final. Texto só para decisões que não são óbvias.

## Git, PRs e deploy

- **Nunca faça commit, push, PR, merge ou deploy sem pedido explícito, a cada vez.** Ao fim de uma unidade de trabalho, sugira a mensagem de commit.
- O histórico é avaliado: commits pequenos, com uma ideia cada, em Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`) e mensagem curta em português. Exemplo: `fix: contador do cache acompanha a carga inicial`. Mantenha a linha `Co-Authored-By: Claude` nos commits feitos pelo agente.
- Branches `<tipo>/<assunto>` (`feat/parser-cards`, `docs/arquitetura`). Os PRs têm base `develop` e entram com **merge commit**, nunca squash nem rebase, para preservar os commits. A `main` recebe a `develop` por um PR de release.
- **Deploy (GitHub Pages):** a branch `gh-pages` guarda só o build, num commit por publicação. Publique **só a partir da `main`, depois do release, e só com pedido explícito**, seguindo o passo a passo do [README](README.md#rodar-dentro-da-pipefy). Depois de publicar, confira o manifest em https://lucasaalv.github.io/case-1-dashboard/manifest.json e abra a visão Dashboard no pipe. A Pipefy relê o manifest a cada carregamento, então um deploy quebrado afeta todos os usuários na hora.
