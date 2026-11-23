# Arquitetura

App de dashboard que roda **dentro da Pipefy**, como uma visão do pipe (`pipe-view`), e permite montar gráficos sobre um pipe de ~20 mil cards sem buscar tudo a cada abertura.

As decisões, com alternativas e motivos, estão em [decisoes.md](decisoes.md). A leitura da documentação do SDK está em [pesquisa-sdk-apps.md](pesquisa-sdk-apps.md).

---

## Por que um app, se o pipe já tem Reports e Dashboards?

Comparação feita em 20/11/2026: abri o construtor de Dashboards e a aba Reports do pipe 307434671, sem salvar nada, e li a Central de Ajuda ([What are dashboards](https://help.pipefy.com/en/articles/5610976-what-are-dashboards), [How to create dashboards](https://help.pipefy.com/en/articles/6047064-how-to-create-dashboards), [Numeric features](https://help.pipefy.com/en/articles/8451892-numeric-features-transform-data-in-results-with-pipefy)).

**O que o nativo já faz bem, e o app não tenta superar:**

- No pipe, Valor Total é um campo `number` e Data Limite é um campo `date` (conferido com `pipe { start_form_fields { id type } }`). O Dashboard nativo soma, tira média, mínimo, máximo e total acumulado do Valor Total, e usa a Data Limite como eixo de tempo. O texto (`"1285947.3"`, `"27/02/2027"`) é só o formato do JSON da API, e por isso o app converte na entrada.
- Tem 8 formatos (área, barra, calendário, linha, número, pizza, dispersão, tabela). O app tem 4.
- Clicar num ponto do gráfico abre os cards por trás dele.
- Os dados são calculados no servidor, em tempo real, sem carga inicial e sem hospedagem.
- Reports são tabelas com filtros, fórmulas de soma, média, mínimo e máximo, e exportação.

**O que o app faz e o nativo não faz, nas mesmas condições:**

| Necessidade | Dashboard nativo (verificado) | Este app |
| --- | --- | --- |
| Agrupar a empresa sem o sufixo ("Aperture Holding" e "Aperture ME" → "Aperture") | A dimensão é o campo como está: na prévia, "Aperture Holding" e "Aperture ME" saem em linhas separadas. Juntar exigiria criar um campo novo e preenchê-lo nos 20 mil cards, mudando o pipe; as fórmulas de automação documentadas são só numéricas | Dimensões derivadas `Empresa (sem sufixo)` e `Domínio do e-mail`, calculadas no sync, sem tocar no pipe |
| "Vencido / vence em até 7 dias / a vencer" em relação a hoje | Os períodos prontos olham para trás (hoje, últimos 7 dias, mês passado...). Não há "próximos 7 dias". O filtro por data tem "antes de" e "depois de" uma data; não verifiquei se aceita "hoje" como valor relativo | Dimensão `Situação de vencimento`, recalculada a cada dia, com a janela futura |
| Cada usuário monta as próprias visões | Os dashboards são do pipe e compartilhados com admins e membros. Na versão Basic, todos os admins e membros veem todos; permissão por dashboard é do Dashboards Pro | Visões salvas no escopo privado do usuário, pelo SDK |
| Montar gráficos sem licença extra | Segundo a Central de Ajuda, dashboards personalizáveis são do **Dashboards Pro** (US$ 2,99 por usuário por mês, nos planos Business, Enterprise e Unlimited). O Basic traz os dashboards padrão | Não depende do Dashboards Pro. Não verifiquei em quais planos os Apps estão disponíveis |
| Regra de negócio própria | Limitada às medidas, dimensões e filtros da tela | É código: uma dimensão, métrica ou regra nova é uma função testada |

O app não substitui os recursos nativos. Ele cobre o que exige **dados derivados, regras relativas a hoje e visões pessoais**, sem alterar o pipe. O cache local com sync incremental não é vantagem sobre o nativo, que calcula no servidor. É o que permite a um app, que só tem a API, abrir rápido sem baixar 20 mil cards toda vez.

**Não verificado:** se o Dashboard nativo filtra os números pelos cards que cada usuário enxerga. No app, esse isolamento vem do `p.query`, que roda com as permissões de quem está logado.

---

## Visão geral

```mermaid
flowchart LR
  subgraph Pipefy["app.pipefy.com"]
    API[(API GraphQL)]
    subgraph Iframe["iframe do pipe-view (navegador do usuário)"]
      SDK["SDK de Apps<br/>p.query · p.get/p.set · eventos"]
      UI["Construtor de gráficos<br/>+ painel de visões"]
      AGG["Agregação local<br/>count/sum/avg/min/max"]
      SYNC["Motor de sync<br/>carga · incremental · reconciliação"]
      IDB[("IndexedDB<br/>1 banco por usuário e pipe")]
    end
  end
  HOST["Hospedagem estática HTTPS<br/>(manifest + HTML/JS)"]

  HOST -- carrega --> Iframe
  SYNC -- "p.query (permissões do usuário)" --> SDK --> API
  SYNC -- "upsert + estado (mesma transação)" --> IDB
  IDB --> AGG --> UI
  UI -- "definições das visões (p.set privado)" --> SDK
  SDK -- "onCardCreated/Updated/Deleted" --> SYNC
```

Não há backend. Todas as chamadas à API passam pelo `p.query` do SDK, que roda com as permissões de quem está usando o app. É isso que garante que cada usuário só sincroniza os cards que pode ver.

### Módulos

| Pasta | Responsabilidade |
| --- | --- |
| `src/domain` | Card normalizado e parser: mapeia por `field.id`, converte número e data e calcula as dimensões derivadas |
| `src/sync` | Cliente GraphQL sobre o `p.query` (erros e retry), queries do `allCards`, marca d'água e motor de sync |
| `src/cache` | Contrato do cache e implementação em IndexedDB |
| `src/analytics` | Agregação (group by) com limite de grupos e "Outros" |
| `src/charts` | Definições de gráficos (validação e persistência no `p.set`) e renderização com Chart.js |
| `src/ui`, `src/app` | Tela e orquestração: identifica o usuário, abre o cache, sincroniza e redesenha |
| `src/pipefy` | Tipos do SDK e um SDK falso para desenvolver fora da Pipefy |

O motor de sync depende de duas interfaces, `PipefyApi` e `CardStore`, e não do SDK nem do IndexedDB. Por isso os testes rodam com um pipe falso e um store em memória.

---

## Fluxo ao abrir o app

```mermaid
sequenceDiagram
  participant U as Usuário
  participant App
  participant API as API (via p.query)
  participant DB as IndexedDB do usuário

  U->>App: abre a visão "Dashboard"
  App->>API: { me { id } }
  App->>DB: abre pipefy-dashboard:<me.id>:<pipeId>
  App->>DB: lê cards + visões salvas
  App-->>U: desenha o que já está no cache
  App->>API: { me { id } pipe { cards_count } }
  Note over App: aborta se a sessão mudou de usuário
  alt cache vazio ou carga interrompida
    loop até hasNextPage = false
      App->>API: allCards(first: 50, after: cursor)
      App->>DB: upsert da página + cursor (1 transação)
    end
  else cache pronto
    App->>API: allCards(filter: updated_at gte marca - 5 min)
    App->>DB: upsert por id
  end
  opt cards_count ≠ cards no cache (e ≠ do total já reconciliado)
    App->>API: allCards paginado (reconciliação)
    App->>DB: upsert + remove os ausentes
  end
  App-->>U: redesenha as visões
```

### Carga inicial

- Pagina o `allCards` com 50 cards por página, o máximo aceito.
- Cada página é gravada **na mesma transação** que o cursor. Se a aba fechar ou a rede cair, a próxima abertura retoma do último cursor salvo, sem baixar de novo o que já está no cache.
- Card com dado inválido (sem id ou com `updated_at` ilegível) é contado e ignorado, sem derrubar o sync.

### Incremental

- Filtra `updated_at gte <marca d'água − 5 min>` e faz upsert por id.
- A marca d'água é o **início do último sync concluído**. Tudo o que mudou antes desse instante já foi lido; o que mudou durante ou depois tem `updated_at` posterior e entra no próximo sync (ver D4 em [decisoes.md](decisoes.md)).
- Se o incremental cair no meio, a marca não avança e o próximo sync repete a janela.

### Exclusões

- **Com o app aberto:** o evento `onCardDeleted` do `pipe-view` remove o card do cache na hora.
- **Com o app fechado:** a cada sync, o app compara o `cards_count` do pipe com o cache. Se forem diferentes e o `cards_count` não for o mesmo da última carga ou reconciliação, pagina o pipe de novo, faz upsert e remove os ausentes. Essa guarda evita repetir ~400 chamadas a cada abertura, mas deixa passar um caso (veja as limitações).

### Eventos ao vivo e concorrência

- `onCardCreated` e `onCardUpdated` agendam um incremental 2 s depois, juntando rajadas de eventos.
- Um trabalho por vez em cada aba (sync ou limpeza do cache). Um sync pedido durante outro roda logo depois que o primeiro termina, então nenhum evento se perde.
- Entre abas, o Web Locks serializa os syncs do mesmo usuário e pipe. A segunda aba espera a primeira e depois faz um incremental barato, que já recarrega o cache.
- O `onCardDeleted` remove o card sem tocar no estado do sync, para não sobrescrever o que um sync em andamento gravou.

### Troca de sessão

Todo sync relê o `me.id` na mesma chamada do `cards_count`, sem custo extra. Se alguém sair da conta e entrar com outro usuário em outra aba, o próximo sync do dashboard aberto para antes de gravar no cache do usuário anterior e pede para recarregar a página.

A conferência acontece no início de cada sync, e não a cada página. Uma troca no meio de uma carga inicial ou de uma reconciliação, que levam cerca de 2 min, não é detectada por ela (veja as limitações).

---

## Custo em chamadas à API

Valores para o pipe do case (20 mil cards, 50 por página):

| Situação | Chamadas |
| --- | --- |
| Identificar o usuário (`me`) | 1 por abertura |
| Carga inicial completa | 1 (`me` + `cards_count`) + 400 páginas = **401** |
| Sync sem mudanças | 1 (`me` + `cards_count`) + 1 (incremental vazio) = **2** |
| Sync com *k* cards alterados (*k* ≥ 1) | 1 + ⌈*k*/50⌉, +1 se as contagens divergirem (confirmação antes de reconciliar) |
| Reconciliação (só quando o `cards_count` difere do cache e do total já reconciliado) | +400 |

Uma abertura comum custa **3 chamadas**, contra cerca de 400 se o app baixasse tudo a cada vez. O app mostra, depois de cada sync, quantas chamadas ele fez.

### Medido dentro da Pipefy (19/11/2026, pipe 307434671)

| Situação | Resultado |
| --- | --- |
| Carga inicial | **401 chamadas**, 20.000 cards gravados, cerca de **2 min e 20 s** (~0,35 s por página de 50 cards) |
| "Sincronizar agora" sem mudanças | **2 chamadas** |
| Recarregar a página | 20.000 cards lidos do cache e visões restauradas, mais 1 sync de 2 chamadas |

Também ficou confirmado na prática:
- o `PipefyApp.init()`/`render` e o `p.query` funcionam no iframe;
- o IndexedDB persiste dentro do iframe da Pipefy;
- o `p.set`/`p.get` privado guarda as visões.

---

## Isolamento por usuário

1. O usuário é o `me.id` devolvido pela própria Pipefy, e não um valor que o app recebe pela URL.
2. Cada usuário tem um **banco IndexedDB próprio** (`pipefy-dashboard:<me.id>:<pipeId>`). Não existe query que leia dados de dois usuários.
3. O conteúdo do cache vem do `p.query` com as permissões **desse** usuário. Um usuário com menos acesso baixa menos cards.
4. As visões ficam em `p.set('pipe', 'private', ...)`, visíveis só para o próprio usuário.

---

## Limitações conhecidas

- **A primeira carga é lenta:** são cerca de 400 chamadas em sequência. Ela é retomável e mostra o progresso, mas a primeira abertura de cada usuário em cada navegador paga esse custo. No pipe do case, foram 401 chamadas e cerca de 2 min e 20 s (ver "Medido dentro da Pipefy").
- **Cota da API** (Central de Ajuda, lida em 19/11/2026):
  - **Por período:** 500 requisições a cada 30 s; quem passa disso fica 5 min sem acesso à API. A carga é sequencial e fica bem abaixo desse ritmo.
  - **Por mês, conforme o plano:** até 20 chamadas à API no Starter, 500 no Business e 10.000 no Enterprise; no Unlimited, o limite é sob medida. Num plano Business, uma única carga completa gastaria quase o mês todo; é o argumento mais forte para o cache e o sync incremental.
  - **Na org do case:** a query `apiUsageStats` (só admin) devolveu `limit: null`, sem limite configurado, e `Counter: 0` em novembro, mesmo depois de chamadas feitas pelo GraphiQL. A hipótese é que chamadas feitas com a sessão do navegador não entram nesse contador. É uma inferência, não está documentado; resta confirmar se as chamadas do SDK (`p.query`) contam.
  - **Estouro:** é repetido com backoff exponencial, até 4 vezes. Se ainda falhar, o progresso fica salvo e o sync pode ser retomado.
- **Relógio do navegador:** a marca d'água usa o relógio local com margem de 5 min. Um relógio adiantado além disso pode perder alterações.
- **Mudança de visibilidade:** se o usuário passar a enxergar cards antigos ou perder acesso a eles sem que o `cards_count` mude, o app não detecta. "Limpar cache local" força uma carga completa.
- **Exclusão que devolve o total a um valor já reconciliado:** com o app fechado, um card excluído pode ficar no cache. O `cards_count` e o cache divergem, mas o total é igual ao da última carga ou reconciliação, e a guarda pula a conferência. Acontece de três formas:
  - depois da carga inicial, que já guarda o total: criar um card num intervalo entre syncs e excluir um card (o mesmo ou outro) no seguinte;
  - depois de uma reconciliação: excluir um card (o app reconcilia e guarda o total), criar outro e depois excluir mais um, em syncs separados;
  - criar um card e excluir outro no mesmo intervalo, quando o total do pipe é o já reconciliado.

  A divergência fica até um sync encontrar um total diferente do guardado. Com o app aberto, o evento `onCardDeleted` cobre o caso. "Limpar cache local" também resolve. O conserto está no [DT9](debito-tecnico.md#dt9-exclusão-que-devolve-o-total-a-um-valor-já-reconciliado-22112026).
- **Troca de sessão durante uma carga longa:** o `me.id` é conferido no início de cada sync. Se a sessão mudar de usuário no meio de uma carga inicial ou de uma reconciliação, as páginas seguintes, já com as permissões do novo usuário, entram no cache do anterior. Conferir a cada página custaria uma chamada a mais por página. "Limpar cache local" refaz a carga.
- **Mesmo navegador, vários usuários:** os bancos são separados por usuário, mas ficam no mesmo disco. O isolamento é do app, não do sistema operacional.
- **Armazenamento do navegador:** o IndexedDB de um iframe de terceiro fica particionado pelo site de topo. O Safari pode apagar esses dados depois de alguns dias sem uso, e aí acontece uma nova carga completa.
- **Cursor recusado:** se a API passar a recusar o cursor salvo de uma carga interrompida, a retomada falha sempre com o mesmo erro. "Limpar cache local" recomeça do zero.
- **Semântica do `cards_count`:** foi confirmado que ele conta os cards da fase concluída (deu 20.000, todos em "Concluded"). Não foi testado se ele respeita as permissões de quem consulta. Se não respeitar, um usuário com visão parcial faz uma reconciliação (~400 chamadas) a cada mudança no total do pipe.
- **Eventos do pipe-view:** segundo a documentação, o `onCardUpdated` cobre só mudanças de vencimento. As demais edições chegam pelo incremental, quando o app abre ou quando o usuário clica em "Sincronizar agora".

---

## Testes

Os testes ficam em duas pastas, e cada uma espelha a estrutura de `src/` (D11 em [decisoes.md](decisoes.md)). O CI roda os dois grupos em etapas separadas.

| Grupo | Arquivos | O que exercita |
| --- | --- | --- |
| **Unitários** (`test/unit`) | `domain/normalize`, `domain/card-parser`, `sync/watermark`, `analytics/aggregate` | Funções puras: conversão de número e data, sufixo da empresa, campos fora de ordem ou vazios, marca d'água, agregação com "Outros" e situação de vencimento |
| | `sync/graphql-client`, `sync/pipefy-api`, `charts/chart-spec` | Uma unidade com o SDK simulado (`vi.fn`): formatos de `errors`, retry e backoff, texto e escape da query, validação do `pipeId`, visões salvas e fila de gravação |
| **Integração** (`test/integration`) | `sync/sync-engine` | O motor de sync real, com o parser e a marca d'água reais, sobre um pipe falso (paginação por cursor e filtro por `updated_at`) e um cache em memória: carga retomável, incremental, reconciliação, troca de usuário e página sem cursor |
| | `cache/idb-store` | A biblioteca `idb` real sobre o `fake-indexeddb`: upsert por id, cards e estado na mesma transação, um banco por usuário e limpeza com outra aba aberta |

**O que não tem teste automatizado:**

- A tela e a orquestração (`src/app`, `src/ui`, `src/charts/render-chart.ts`): mutex do sync, sync pedido durante outro, troca de sessão na tela e listeners do `pipe-view`.
- A entrada da página (`src/pipe-view.ts`): aviso fora da Pipefy, tema claro fixo dentro dela e falha no `init` do SDK.
- Ponta a ponta no navegador.
- O comportamento real da API e do iframe da Pipefy. O SDK só funciona dentro do iframe, com o `appID` que a Pipefy coloca na URL, então isso foi validado à mão dentro do pipe e medido (ver "Medido dentro da Pipefy").

---

## Boas práticas aplicadas

- **Testes primeiro nos pontos críticos:** parser com ordem variável de campos e campos vazios, marca d'água, retomada da carga, reconciliação, isolamento do cache e validação das visões salvas. O CI roda typecheck, testes e build.
- **Normalização na entrada:** número, data ISO e dimensões derivadas são calculados uma vez, no sync.
- **Gravação atômica:** cards e estado do sync na mesma transação, então o cursor nunca fica à frente dos dados.
- **Erros da API tratados como dados:** o `p.query` nunca rejeita a promise. O cliente verifica `errors` (array ou `Error`, mesmo com HTTP 200), trata resposta parcial como erro e só repete o que é retentável.
- **Sem injeção na query:** valores dinâmicos entram escapados com `JSON.stringify`, e o `pipeId` é validado como numérico.
- **Sem XSS:** todo texto vindo dos cards entra no DOM por `textContent`. Os gráficos são desenhados em `<canvas>`.
- **Dados salvos tratados como não confiáveis:** as definições lidas do `p.get` são validadas item a item.
- **Sem segredos:** o app não guarda token nenhum; o SDK cuida da autenticação.
- **Acessibilidade:** cada gráfico tem uma tabela "Ver dados" com os mesmos números. As cores categóricas seguem uma paleta validada para daltonismo, em ordem fixa, com tema claro e escuro.
