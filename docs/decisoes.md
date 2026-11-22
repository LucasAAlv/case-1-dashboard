# Decisões

Registro das decisões do Case 1, com data, opção escolhida, alternativas e motivo.

---

## D1. App só de front-end, rodando no `pipe-view` (19/11/2026)

**Escolha:** o app inteiro roda no navegador, dentro do iframe do `pipe-view`. O sync chama a API pelo `p.query` do SDK, o cache fica no IndexedDB e a agregação é local. Não há backend.

**Alternativas:**
- Backend com token de Service Account: um token compartilhado lê tudo o que a conta de serviço enxerga, e o isolamento por permissão teria de ser reimplementado à mão. Isso viola a regra de que cada usuário só vê o que as próprias permissões deixam.
- Backend com o token de `p.getAuthToken()`: a documentação não diz o formato, a validade nem se o token serve para chamar a API como o usuário. Fica como evolução, depois de testado.

**Motivo:** o `p.query` executa "with the full permissions and access rights of whoever is using your app". Com isso, o isolamento de permissões vem da própria Pipefy, e não do código do app. Também não há segredo para guardar nem servidor para manter.

---

## D2. Stack: TypeScript, Vite, Vitest e Chart.js (19/11/2026)

**Escolha:** TypeScript estrito sem framework de UI, Vite para o build com várias páginas, Vitest para os testes e Chart.js para os gráficos. A dependência `idb` faz um wrapper fino sobre o IndexedDB.

**Alternativas:**
- React ou Vue: a UI é um formulário e uma grade de gráficos, e um framework acrescentaria peso e conceitos sem ganho real.
- ECharts: mais recursos, mas o bundle é maior. O Chart.js cobre barra, linha, pizza e rosca, que é o que o construtor oferece.
- SQL no navegador (sql.js ou DuckDB-wasm): a agregação de 20 mil linhas em TypeScript leva milissegundos, e o WASM acrescentaria megabytes.

**Motivo:** a vaga pede TypeScript, e o conjunto é pequeno, testável e fácil de explicar.

---

## D3. Um banco IndexedDB por usuário e pipe (19/11/2026)

**Escolha:** o nome do banco é `pipefy-dashboard:<me.id>:<pipeId>`. O app só abre o banco do `me.id` devolvido pela Pipefy.

**Alternativas:** um banco único com a coluna `userId`. Funciona, mas o isolamento passaria a depender de cada query lembrar de filtrar.

**Motivo:** o isolamento fica estrutural. Apagar o cache de um usuário é um `deleteDB`.

**Limitação:** dois usuários no mesmo perfil de navegador dividem o disco. A separação é do app, não do sistema operacional.

---

## D4. Marca d'água = início do último sync completo (19/11/2026, substitui o "último `updated_at` visto")

**Escolha:** depois de um sync completo, a marca d'água passa a ser o instante em que ele começou. O próximo incremental filtra `updated_at gte <marca - 5 min>` e faz upsert por id.

**Alternativa original:** a marca seria o último `updated_at` visto, menos alguns segundos.

**Motivo:** os testes mostraram um problema com a base real. Os 20 mil cards têm `updated_at` dentro do mesmo minuto (12/11/2026, entre 18h56 e 18h57 UTC). Com a marca no último `updated_at` visto, ela ficaria parada nesse minuto, e todo incremental baixaria de novo os cards dentro da margem até que alguém editasse um card. Com o início do sync, a marca sempre avança.

**Por que é seguro:** tudo o que mudou antes do início do sync já estava visível quando o pipe foi paginado. O que mudou durante ou depois do sync tem `updated_at` posterior e entra no próximo incremental. A margem de 5 min cobre a diferença de relógio entre o navegador e a Pipefy e as gravações que ficam visíveis com atraso.

**Detalhes:**
- Na carga inicial retomada, vale o início da **primeira** tentativa.
- Se o incremental cair no meio, a marca não avança.
- A marca nunca anda para trás.

**Limitação:** depende de o relógio do navegador estar a menos de 5 min do relógio da Pipefy, o que vale para máquinas com NTP. Um relógio adiantado além da margem pode perder alterações.

---

## D5. Reconciliação de exclusões pelo `cards_count` (19/11/2026)

**Escolha:** a cada sync, o app compara o `cards_count` do pipe com a contagem do cache. Se forem diferentes, pagina o pipe inteiro, faz upsert de tudo e remove do cache o que não veio. O `cards_count` usado fica salvo, e a reconciliação só roda de novo quando ele mudar.

**Motivo:** exclusões não aparecem no filtro por `updated_at`. Baixar os cards completos custa o mesmo número de chamadas que baixar só os ids, porque o `allCards` devolve 50 por página de qualquer jeito. Assim, na mesma passada, a reconciliação também recupera um card que falte no cache com `updated_at` antigo.

**Ponto a observar:** um usuário que não enxerga todos os cards teria sempre contagens diferentes. Guardar o `cards_count` da última reconciliação evita refazer ~400 chamadas a cada abertura nesse caso.

**Custo:** a reconciliação custa o mesmo número de páginas de uma carga completa, já que o `allCards` não tem outro jeito de listar ids.

**Limitações:**
- Uma criação somada a uma exclusão no mesmo intervalo mantém a contagem igual e esconde a exclusão. O listener `onCardDeleted` do `pipe-view` cobre as exclusões feitas com o app aberto.
- Quando muda a visibilidade do usuário (ele passa a enxergar cards antigos ou perde acesso a eles), nenhuma das duas contagens muda, e o app não detecta isso sozinho. O botão "Limpar cache local" força uma carga completa.

---

## D6. Queries com literais escapados em vez de variáveis (19/11/2026)

**Escolha:** o `pipeId`, o cursor e a data entram na query como literais. O `pipeId` é validado como numérico, e as strings passam por `JSON.stringify`.

**Motivo:** o nome do tipo do argumento `filter` do `allCards` no schema não foi verificado. O formato literal foi testado no GraphiQL. Não usar o tipo evita inventar API.

---

## D7. Retry só para erros retentáveis (19/11/2026)

**Escolha:** backoff exponencial para falha de transporte (o `errors` vem como um único `Error`) e para `USAGE_LIMIT_EXCEEDED`. Os outros códigos, como erro de permissão ou de sintaxe, falham na hora.

**Revisto em 22/11/2026:** a primeira versão também repetia `TIMEOUT` e `INTERNAL_SERVER_ERROR`, que não estão na tabela de códigos da Pipefy ([Status codes and Error Handling](https://developers.pipefy.com/reference/status-and-error-handling)). Nessa tabela, 5xx e 429 são status HTTP, e não `extensions.code`. A documentação do SDK não diz como o `p.query` entrega esses status; a hipótese, não verificada, é que cheguem como falha de transporte, que é repetida. As páginas da Pipefy também divergem sobre o `USAGE_LIMIT_EXCEEDED`: a de status o descreve como limite de requisições por período, e outras duas o ligam ao limite de envio de e-mail. O app o trata como estouro de cota.

**Motivo:** o `p.query` nunca rejeita a promise. O erro vem em `errors`, como array ou como um único `Error`, e pode vir com HTTP 200. Uma resposta parcial (`data` junto com `errors`) também conta como erro, porque o sync precisa de páginas completas.

---

## D8. Situação de vencimento calculada na hora do gráfico (19/11/2026)

**Escolha:** a dimensão "situação de vencimento" (vencido, vence em até 7 dias, a vencer) é a única calculada na renderização. As demais dimensões derivadas são calculadas uma vez, no sync.

**Motivo:** ela depende do dia de hoje, então gravá-la no cache a deixaria desatualizada no dia seguinte.

---

## D9. Correções da revisão de código (19/11/2026)

Uma revisão no nível *high* encontrou 14 pontos. Foram corrigidos, com teste quando cabia:

- **Carga retomada não vale como reconciliação.** Um card excluído entre as tentativas, numa página já gravada, ficaria para sempre no cache.
- **O sync confere o usuário da sessão.** O `me { id }` vai na mesma query do `cards_count`. Se a sessão da Pipefy mudar de usuário entre um sync e outro, o sync seguinte aborta antes de gravar, porque os dados de B não podem entrar no cache de A. A conferência é feita no início de cada sync, e não a cada página: uma troca no meio de uma carga longa ficou registrada como limitação.
- **A divergência de contagem é confirmada antes de reconciliar.** Um card criado entre a leitura do `cards_count` e o incremental dispararia ~400 chamadas sem necessidade; a confirmação custa 1.
- **`hasNextPage` sem `endCursor` é tratado como erro, não como fim.** Tratar como fim marcaria uma carga incompleta como pronta e faria a reconciliação apagar os cards não vistos.
- **Commit sem estado.** A exclusão por evento e as páginas do incremental não reescrevem o estado do sync.
- **Visões salvas.** Uma falha ao ler deixa de virar lista vazia (salvar depois apagaria as visões) e as gravações entram numa fila.
- **Concorrência na tela:**
  - o sync e a limpeza do cache compartilham o mesmo mutex;
  - um sync pedido durante outro roda em seguida;
  - limpar o cache não trava com outra aba aberta;
  - os gráficos são criados junto com o redesenho, sem instâncias perdidas.
- **Rosca por mês** fica bloqueada, porque teria mais fatias que cores.

**Não corrigido:** um cursor salvo recusado pela API faz a retomada falhar sempre. É improvável e "Limpar cache local" resolve; ficou documentado em limitações.

**A verificar:** se o `cards_count` respeita as permissões de quem consulta. Isso exige um segundo usuário com visão parcial.

---

## D10. Tema claro fixo dentro da Pipefy (19/11/2026)

**Escolha:** dentro da Pipefy, o app usa sempre o tema claro. Fora dela, com o SDK falso, continua seguindo o tema do sistema operacional.

**Alternativa:** seguir o `prefers-color-scheme` em qualquer lugar, como na primeira versão.

**Motivo:** a validação no pipe mostrou o problema. Num sistema em modo escuro, o dashboard ficava escuro dentro da tela clara da Pipefy. O tema do iframe segue o sistema operacional, não a Pipefy, e a documentação do SDK não mostra um jeito de saber o tema da Pipefy. O tema escuro continua nos tokens, validado, e volta a valer se essa informação aparecer.

---

## D11. Testes separados em unitários e de integração (21/11/2026)

**Escolha:** os testes ficam em `test/unit` e `test/integration`, e cada pasta espelha a estrutura de `src/`. Os scripts `test:unit` e `test:integration` rodam cada grupo, e o CI roda os dois em etapas separadas. O `npm test` continua rodando tudo.

**Critério:**
- **Unitário:** uma unidade isolada. Função pura, ou um módulo com o SDK simulado por `vi.fn`.
- **Integração:** mais de um módulo real trabalhando junto (motor de sync, parser e marca d'água), ou a biblioteca de armazenamento real (`idb` sobre o `fake-indexeddb`).

**Alternativas:**
- Manter uma pasta por módulo e só documentar a classificação: custo zero, mas a separação não aparece na estrutura nem no CI.
- Separar por sufixo (`*.int.test.ts`) sem mover arquivos: menos mudança, mas a separação fica menos visível.

**Motivo:** a separação fica explícita na estrutura e no CI. Uma falha mostra de cara se quebrou uma regra isolada ou a combinação dos módulos. Com cerca de 80 testes, todos em menos de 1 s, não há ganho de tempo; o ganho é de clareza.
