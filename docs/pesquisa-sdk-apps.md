# Pesquisa: SDK de Apps da Pipefy

Leitura da documentação oficial em [developers.pipefy.com](https://developers.pipefy.com), feita em 18/11/2026 para embasar a escolha da stack do Case 1.

O texto vem da documentação e **não foi testado na prática**, salvo onde o próprio trecho traz uma data posterior, do que foi medido ou lido depois. Quando a documentação não cobre um ponto, isso está dito como "não documentado".

---

## 1. O que decide a arquitetura

### 1.1. O dashboard entra como `pipe-view`

- `pipe-view` é a única feature de página inteira: "a full-width view replacing the Kanban board". Ela aparece no seletor de visões, ao lado de Kanban, tabela e calendário.
- Outras features existentes: `card-badges`, `card-buttons`, `card-tab` e `pipe-buttons`. Nenhuma serve para um dashboard.
- No manifest:

  ```json
  {
    "name": "...",
    "init_url": "./",
    "features": ["pipe-view"]
  }
  ```

  Os campos obrigatórios são `name`, `init_url` e `features`. O `init_url` é relativo à URL do manifest.
- Na página de `init_url`, que não renderiza UI:

  ```js
  PipefyApp.initCall({
    'pipe-view': function (p, pipe) {
      return { icon: './images/icon.svg', text: 'Dashboard', url: './pipe-view.html' };
    }
  });
  ```

- A página do `pipe-view` recebe `p` e `pipe` (`{ id, name }`) e **precisa chamar `PipefyApp.render(cb)`** quando terminar de carregar. Sem isso, a Pipefy devolve o usuário ao Kanban.
- **Não use `p.render()`.** A documentação diz que está quebrado e devolve uma promise rejeitada.
- `PipefyApp.resizeTo` dá erro no `pipe-view`, porque o frame já ocupa a largura toda. A documentação não fala de altura nem de rolagem.
- **Medido em 20/11/2026:** a Pipefy cria o iframe do `pipe-view` com `scrolling="no"` e altura fixa (a área visível abaixo das abas do pipe). A página do app nunca rola sozinha: o app precisa de um contêiner de rolagem próprio. Aqui, é o `body` (ver `src/ui/styles.css`).

### 1.2. As chamadas pelo SDK rodam como o usuário logado

- `p.query(query, variables)` e `p.mutation(...)` executam "with the full permissions and access rights of whoever is using your app". A documentação resume assim: "no tokens to manage, no CORS to configure".
- Consequência: se o sync rodar **no navegador, via SDK**, a regra "cada usuário só vê o que as próprias permissões deixam" vem de graça.
- O app **não roda num escopo reduzido**: ele tem todas as permissões do usuário.
- O id do usuário vem de `p.query('{ me { id } }')`. Nome e e-mail não aparecem como métodos do SDK; pedir outros campos de `me` via GraphQL deve funcionar, mas não foi verificado.

### 1.3. Com backend, a identidade do usuário é o problema

- Existe `p.getAuthToken()`, na página *User interface functions*, seção "Authentication". Ele devolve uma promise com "an authentication token for the current user, which you can forward to your own backend to identify who is using the app".
- **Não documentado:** o tipo do token (token de API, OAuth, JWT), a validade, como o backend verifica o token e se ele serve para chamar `api.pipefy.com`.
- Ao contrário de `p.query`, o `getAuthToken()` rejeita a promise quando falha.
- Para chamadas feitas por um backend, a documentação manda usar um **token de Service Account** ("Personal Access Tokens are deprecated"). Esse token é o mesmo para todos os usuários e lê tudo o que a conta de serviço enxerga, o que **contraria o requisito do case**: um usuário não pode ver dados que vieram com as permissões de outro.
- Conclusão: um backend só se sustenta se o `getAuthToken()` servir para chamar a API **como o usuário**. Isso precisa ser testado.

---

## 2. Hospedagem e ambiente de desenvolvimento

- **Tudo precisa ser servido em HTTPS.** Conteúdo misto "silently fails". O manifest precisa responder em HTTPS com `application/json`.
- **Localhost puro não funciona.** A documentação recomenda "Serve your app over HTTPS from a tunnel (ngrok, cloudflared, or similar) and register that tunnel URL". Uma hospedagem estática com HTTPS também resolve.
- **Exibição em iframe:**
  - não use `X-Frame-Options: DENY` nem `SAMEORIGIN`;
  - se houver CSP, o `frame-ancestors` precisa incluir `https://app.pipefy.com`;
  - o FAQ pede que o servidor aceite CORS de `https://app.pipefy.com`. Isso contradiz o "no CORS to configure" da página de chamadas à API; na dúvida, siga o FAQ.
- **SDK:** carregado por `<script src="https://platform.staticpipefy.com/pipefy-app.js"></script>` e lido em `window.PipefyApp`. **Não está no npm.**
- **`appID`:** a Pipefy acrescenta `?appID=...` à URL do iframe. Abrir o app direto no navegador dá o erro `PipefyApp: no "appID" query parameter found on this page...`. Desenvolver fora da Pipefy exige um **mock do SDK**.
- **Registro:** um admin da org cadastra o app em https://app.pipefy.com/developers/apps, em "Add new app", com nome e URL do `manifest.json`.
  - Um **app privado** fica visível só na org e não passa por revisão. É o caso aqui.
  - O app aparece no menu Tools, no canto superior direito, e nas superfícies declaradas em `features`.
  - Instalação por pipe: não documentada.
- **O manifest é relido a cada carregamento.** Um deploy quebrado atinge todo mundo na hora, inclusive durante a demo.

---

## 3. Armazenamento do SDK (`p.set` / `p.get`)

- Assinatura: `p.set(scope, visibility, key, value)` e `p.get(scope, visibility, key)`, as duas com promise.
- Escopos: `organization`, `pipe` e `card`.
- Visibilidade: `private` ("only the current user") ou `public`. O `get` precisa usar o mesmo escopo e a mesma visibilidade do `set`.
- Os valores são guardados como string. Para JSON, serialize antes.
- Limite: não há número documentado. A documentação diz "keep stored values small" e recomenda um backend próprio acima de "a few kilobytes per key".
- Pegadinha: o `p.set` resolve de forma inconsistente (às vezes com o valor, às vezes `undefined`). Trate o `.then` só como sinal de conclusão e, se precisar do valor, releia com `p.get`.
- **Uso:** não serve para os 20 mil cards, mas é uma boa opção para **as definições de gráficos de cada usuário** (`pipe` + `private`).

---

## 4. Limites da API GraphQL

| Limite | Valor |
| --- | --- |
| Complexidade por query | 50.000. Os filhos de uma conexão são multiplicados por `first` |
| Profundidade | 15 |
| Tempo por query | 33 s |
| Tamanho da página | "usually 50". Pedir mais devolve 50, mas a complexidade é calculada sobre o número pedido |
| Requisições por período | **não está em developers.pipefy.com**. Fica na seção "Request Limits" de https://help.pipefy.com/en/articles/5580799-how-to-use-pipefy-s-api, lida em 19/11/2026: 500 a cada 30 s, mais uma cota mensal por plano (ver [arquitetura.md](arquitetura.md#limitações-conhecidas)) |

- Estouro de cota: HTTP 429 ou `extensions.code: "USAGE_LIMIT_EXCEEDED"` dentro de `errors`, com HTTP 200.
- **Lido em 22/11/2026:** a tabela de códigos ("Status codes and Error Handling") não tem `TIMEOUT` nem `INTERNAL_SERVER_ERROR`. 5xx e 429 aparecem só como status HTTP, sem orientação de retry. Duas outras páginas ligam o `USAGE_LIMIT_EXCEEDED` ao limite de envio de e-mail (2 por minuto).
- Cada erro traz `message`, `locations`, `path` e `extensions { code, correlation_id }`.
- `Retry-After` e backoff: não documentados.
- Existe uma query de uso da API por org e por token, só para Super Admin ou Admin. A resposta de exemplo traz `limit: 1000`, sem período informado. Pode servir para mostrar o custo em chamadas na apresentação.
- Timeout, tamanho e concorrência do `p.query`: não documentados. Não se sabe se as chamadas via SDK contam na mesma cota.

### Pegadinhas do `p.query`

- **Nunca rejeita a promise.** O erro vem em `result.errors`, que pode ser um array **ou um único `Error`**, e pode vir junto com `data`.
- Use **`p.app.pipeId`** como id do pipe nas queries, e não `p.pipeId`. O `p.organizationId` pode ser usado direto.
- `p.query` recusa mutations, e `p.mutation` recusa queries.
- `p.card()`, `p.pipe()` e `p.fields()` resolvem `null` quando falham, então `null` é ambíguo. Não use esses métodos para detectar erro.
- `p.pipe()` devolve `id`, `name`, `organization_name` e `cards_count`. Comparado com a contagem do cache, o `cards_count` pode servir para detectar exclusões.

---

## 5. Eventos do `pipe-view` (úteis para o sync)

- `PipefyApp.registerListener(name, cb)` funciona só no `pipe-view`, com os eventos `onCardCreated`, `onCardDeleted`, `onCardUpdated` e `onFilterChanged`.
- `PipefyApp.pipeFilter(p.app.pipeId)` aplica os filtros atuais do pipe.
- O `onCardDeleted` ajuda no problema das exclusões **sem precisar de webhook**.
- Ressalvas:
  - segundo a documentação, o `onCardUpdated` cobre só mudanças de data de vencimento;
  - os eventos só disparam com o app aberto.
- Eles **complementam** o incremental por `updated_at`, mas não o substituem.

---

## 6. Implicação para a stack

Na data desta pesquisa, a stack ainda não estava decidida. A documentação favorece um **app só de front-end**:

- **sync** no navegador via `p.query`, com as permissões do próprio usuário;
- **cache** no IndexedDB, com o `me.id` como chave;
- **agregação** local;
- **definições de gráficos** em `p.set('pipe', 'private', ...)`;
- **hospedagem** estática com HTTPS, ou um túnel durante o desenvolvimento.

Riscos levantados na pesquisa:

- O IndexedDB dentro de um iframe de terceiro fica particionado pelo site de topo (`app.pipefy.com`). O Safari pode apagar esses dados depois de alguns dias. **Verificado em 19/11/2026:** no Chrome, o cache persiste dentro do iframe da Pipefy.
- Dois usuários no mesmo navegador dividem o mesmo IndexedDB. A separação por `user_id` funciona como regra do app, mas não isola os dados no nível do dispositivo. Isso entra em "limitações".

A alternativa com backend só se sustenta se o `getAuthToken()` servir para chamar a API como o usuário (seção 1.3).

---

## 7. O que ficou em aberto e como foi resolvido

- **Registro do app:** exige um admin da org. O app foi registrado na org do case como "Dashboard de Cards".
- **`getAuthToken()`:** não foi testado. Como o `p.query` já roda com as permissões de quem está logado, a escolha foi o app só de front-end, e o backend com `getAuthToken()` ficou como evolução (decisão D1 em `docs/decisoes.md`).
- **Leituras não feitas nesta pesquisa:** `reference/service-accounts` e `reference/authentication`. A seção "Request Limits" da Central de Ajuda foi lida depois, em 19/11/2026 (seção 4).

---

## Fontes

- [Build your first Pipefy app](https://developers.pipefy.com/docs/build-your-first-pipefy-app)
- [Manifest reference](https://developers.pipefy.com/reference/manifestjson)
- [Getting the SDK](https://developers.pipefy.com/docs/getting-the-sdk)
- [Apps Client SDK](https://developers.pipefy.com/reference/apps-client-sdk)
- [Where each function works](https://developers.pipefy.com/reference/sdk-availability)
- [Features](https://developers.pipefy.com/reference/features)
- [Pipe view](https://developers.pipefy.com/docs/pipe-view)
- [Make API calls](https://developers.pipefy.com/docs/make-api-calls)
- [Get Pipefy data](https://developers.pipefy.com/docs/get-pipefy-data)
- [Store and retrieve custom data](https://developers.pipefy.com/docs/store-retrieve-custom-data)
- [User interface functions](https://developers.pipefy.com/docs/user-interface-functions)
- [Limits and best practices](https://developers.pipefy.com/reference/limits-and-best-practices)
- [Status and error handling](https://developers.pipefy.com/reference/status-and-error-handling)
- [Pagination basics](https://developers.pipefy.com/reference/pagination-basics)
- [API usage stats](https://developers.pipefy.com/reference/api-usage-stats-query)
- [Publishing your app](https://developers.pipefy.com/reference/publishing-you-app)
- [FAQ](https://developers.pipefy.com/docs/frequently-asked-questions)
