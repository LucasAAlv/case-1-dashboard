# Débito técnico

O que ficou de fora por escolha de prazo e o que eu faria com mais tempo. As limitações que vêm do próprio desenho (exclusões, relógio do navegador, cota da API) estão em [arquitetura.md](arquitetura.md#limitações-conhecidas). As decisões estão em [decisoes.md](decisoes.md).

Cada item traz o estado atual, o risco, a proposta e o custo estimado.

## Resumo

| Item | Prioridade | Custo | Muda o banco? |
| --- | --- | --- | --- |
| [DT1](#dt1-auditoria-histórico-de-chamadas-erros-e-usuário-20112026). Auditoria de chamadas, erros e usuário | Média | Meio dia | Sim |
| [DT2](#dt2-falha-de-conversão-vira-null-sem-aviso-21112026). Falha de conversão vira `null` sem aviso | Média | 1 h (aviso) a meio dia (log) | Só no log completo |
| [DT3](#dt3-regra-de-derivação-nova-não-reprocessa-o-cache-21112026). Regra de derivação nova não reprocessa o cache | Média | 2 a 3 h | Não (só um campo no `meta`) |
| [DT4](#dt4-retry-não-espera-o-bloqueio-da-cota-21112026). Retry não espera o bloqueio da cota | Alta | 1 a 2 h | Não |
| [DT5](#dt5-armazenamento-sem-pedido-de-persistência-21112026). Armazenamento sem pedido de persistência | Baixa | 1 h | Não |
| [DT6](#dt6-gráficos-vazios-durante-a-carga-inicial-21112026). Gráficos vazios durante a carga inicial | Baixa | 1 a 2 h | Não |
| [DT7](#dt7-tela-e-orquestração-sem-teste-automatizado-21112026). Tela e orquestração sem teste automatizado | Média | 1 a 2 dias | Não |
| [DT8](#dt8-formatação-sem-ferramenta-que-a-garanta-21112026). Formatação sem ferramenta que a garanta | Baixa | 1 a 2 h | Não |

---

## DT1. Auditoria: histórico de chamadas, erros e usuário (20/11/2026)

### Estado atual

- Depois de cada sync, a barra de status mostra só o **último** resultado: o modo, as chamadas, os cards gravados, removidos e ignorados, e a hora (`describe` em `src/app/dashboard-app.ts`). O sync seguinte apaga essa linha.
- Os erros vão para o `console.error` do navegador (`src/app/dashboard-app.ts`) e, na tela, viram uma mensagem curta. Fechou a aba, perdeu o registro.
- O `GraphQLRequestError` (`src/sync/graphql-client.ts`) guarda a mensagem e os códigos, mas **descarta o `correlation_id`** que a Pipefy manda em `extensions`. É esse id que o suporte da Pipefy pede para rastrear uma falha.
- **As novas tentativas não aparecem na contagem.** O motor de sync conta uma chamada por pedido (`call` em `src/sync/sync-engine.ts`), e o retry acontece por baixo, no cliente (`retrying` em `src/sync/graphql-client.ts`, até 4 tentativas extras). Num estouro de cota, a tela mostra menos chamadas do que a API recebeu.
- O usuário de cada sync é conhecido (`me.id`, conferido a cada sync), mas não é exibido.

### Risco

- Não há como responder, depois do fato, "quando foi o último sync completo deste usuário, quanto custou e por que falhou", nem mostrar isso na demo além da última linha de status.
- Diagnóstico de cota fica impreciso: a contagem exibida subestima o consumo quando há retry.
- Sem o `correlation_id`, um erro da API não pode ser levado ao suporte da Pipefy.

### Proposta

1. **Registro por sync**, gravado no próprio banco IndexedDB do usuário, num store novo `sync_log`: início, fim, modo (carga, retomada, incremental, reconciliação), chamadas lógicas, **tentativas reais** (com retry), cards gravados, removidos e ignorados, marca d'água antes e depois, e, se falhar, a mensagem, os códigos e o `correlation_id`.
2. **Retenção limitada:** manter as últimas 100 entradas, apagando as mais antigas na mesma transação.
3. **Painel "Histórico de sincronização"** na tela: tabela com essas colunas e o usuário (`me.id`; nome e e-mail exigem pedir `me { name email }`, o que **não foi verificado**). Opção de exportar em JSON.
4. **Contar as tentativas reais** passando um contador para o `retrying`, e mostrar as duas contagens quando forem diferentes.

### Cuidados

- **Isolamento:** o log fica no banco do próprio usuário, então herda o isolamento da D3. Nenhum usuário vê o histórico de outro.
- **Privacidade:** registrar só contagens, ids técnicos e códigos de erro. Nada do conteúdo dos cards (nome, e-mail, valor).
- **Alcance:** é um log local, por navegador. Uma auditoria central, com o consumo de todos os usuários, exigiria um backend, o que a D1 descartou. Para o consumo da org inteira, o admin já tem a query `apiUsageStats` (ver [arquitetura.md](arquitetura.md#limitações-conhecidas)).

### Custo

- Store novo no IndexedDB: sobe a versão do banco e muda o modelo de dados. **Precisa de decisão** antes de implementar. Se o DT2 completo também for feito, as duas mudanças entram numa versão só.
- Estimativa: meio dia, com testes do registro, da retenção e da contagem de tentativas.

---

## DT2. Falha de conversão vira `null` sem aviso (21/11/2026)

### Estado atual

- O parser converte o Valor Total (`parseDecimal`) e a Data Limite (`parseBrDate`) em `src/domain/normalize.ts`. Um valor preenchido que não converte, como `"1.285.947,30"` ou `"2027-02-27"`, vira `null`, igual a um campo vazio.
- O card entra no cache normalmente. O contador de "ignorados" só conta card sem id ou sem `updated_at` válido.

### Risco

Se a Pipefy mudar o formato de um campo, as somas e médias caem e os cards somem do eixo de datas **sem nenhum aviso**. O usuário vê um número errado e acha que está certo.

### Proposta

Em dois passos, do mais barato para o mais completo:

1. **Aviso mínimo:** o sync conta os campos preenchidos que não converteram e mostra "N campos não convertidos" na linha de status. O card, o campo e o valor cru vão para o console. Não muda o banco nem cria tela nova.
2. **Log de divergência:** o `parseCard` devolve o registro e a lista de problemas (`cardId`, `fieldId`, valor cru). Um store novo, `parse_issues`, com chave `cardId:fieldId`, é gravado na mesma transação da página. Quando o card volta a converter, o problema é apagado, então a lista mostra o que está quebrado agora. A reconciliação apaga os problemas dos cards excluídos. Na tela, o aviso abre uma tabela com o card, o campo, o valor cru e quando o problema apareceu. A contagem também entra no `sync_log` do DT1.

Nenhum dos dois passos trava o sync: o card continua entrando, com o campo nulo.

### Custo

- Aviso mínimo: cerca de 1 h, com testes. Exige publicar de novo.
- Log completo: meio dia. Muda o modelo de dados (store novo) e **precisa de decisão**.

---

## DT3. Regra de derivação nova não reprocessa o cache (21/11/2026)

### Estado atual

As dimensões derivadas (`companyBase`, `emailDomain`, `dueMonth`) são calculadas no sync e gravadas no cache. Se a regra mudar (um sufixo novo no `companyBaseName`, por exemplo), os caches que já existem continuam com os valores antigos. O incremental só corrige os cards que mudaram, e o resultado fica misturado. Hoje, a saída é "Limpar cache local", que custa uma carga completa (~401 chamadas) por usuário e navegador.

### Proposta

- Uma constante `NORMALIZATION_VERSION` no código, incrementada quando uma regra de derivação muda.
- Um campo `normalizationVersion` no estado do sync (`meta`), com a versão com que o cache foi gerado.
- Ao abrir, se as duas forem diferentes, o app lê os cards **do próprio IndexedDB**, recalcula os campos derivados a partir dos valores de origem que já estão gravados (`company`, `email`, `dueDate`), grava tudo numa transação e atualiza a versão. **Nenhuma chamada à API.**
- Uma carga completa só é necessária se a regra nova depender de um dado que o cache não guarda (um campo que o app não busca, ou o texto cru do Valor Total). Para esse caso, a versão pode indicar "exige carga completa".

**A decidir:** guardar também o `fields` cru de cada card. Assim, qualquer regra futura pode ser recalculada sem a API, ao custo de mais ou menos o dobro do espaço.

### Custo

2 a 3 h, com testes da migração. Não cria store: é um campo a mais no `meta`.

---

## DT4. Retry não espera o bloqueio da cota (21/11/2026)

### Estado atual

O `withRetry` (`src/sync/graphql-client.ts`) repete os erros retentáveis até 4 vezes, com esperas de 1, 2, 4 e 8 s (15 s no total). Segundo a Central de Ajuda, quem passa de 500 requisições em 30 s fica **5 min** sem acesso à API.

### Risco

Num `USAGE_LIMIT_EXCEEDED`, as 4 tentativas caem dentro do bloqueio e o sync falha do mesmo jeito. O progresso fica salvo, mas as tentativas são inúteis e mandam mais requisições durante o bloqueio. Na carga sequencial (cerca de 86 requisições a cada 30 s), o estouro é improvável, mas pode acontecer se outras integrações usarem a mesma cota.

### Proposta

- Tratar o `USAGE_LIMIT_EXCEEDED` à parte: não repetir e interromper o sync, com o progresso salvo.
- Mostrar "Limite da API atingido. Nova tentativa às HH:MM." e agendar a retomada para depois de 5 min.
- Manter o backoff curto para a falha de transporte (D7).

### Custo

1 a 2 h, com testes.

---

## DT5. Armazenamento sem pedido de persistência (21/11/2026)

### Estado atual

O app não chama `navigator.storage.persist()`. Por padrão, o armazenamento do navegador é *best-effort*: com o disco apertado, o navegador pode apagar o IndexedDB dos sites usados há mais tempo. O próximo acesso refaz a carga completa (~401 chamadas e ~2 min e 20 s). As visões não se perdem, porque ficam no `p.set`.

### Proposta

Pedir a persistência na primeira carga e mostrar o resultado no status. O pedido não protege contra a limpeza feita pelo usuário, e o navegador pode negar. **Não verificado:** se o pedido é aceito num iframe de terceiro, como o do `pipe-view`.

### Custo

Cerca de 1 h, incluindo testar dentro da Pipefy.

---

## DT6. Gráficos vazios durante a carga inicial (21/11/2026)

### Estado atual

A carga inicial é assíncrona e mostra o progresso, mas os cards em memória só são lidos do cache antes e depois do sync (`src/app/dashboard-app.ts`). Na primeira abertura, as visões ficam vazias por ~2 min e 20 s e se completam de uma vez no fim.

### Proposta

Redesenhar os gráficos a cada N páginas gravadas (por exemplo, a cada 20 páginas, ou cerca de 1.000 cards), no `onProgress`. Os gráficos vão se completando enquanto a carga avança.

### Custo

1 a 2 h, com teste. O cuidado é não reler o cache inteiro a cada página.

---

## DT7. Tela e orquestração sem teste automatizado (21/11/2026)

### Estado atual

Os testes cobrem o domínio, o sync e o cache (ver [arquitetura.md](arquitetura.md#testes)). Não têm teste automatizado:

- `src/app/dashboard-app.ts`: o mutex entre sync e limpeza, o sync pedido durante outro, a troca de sessão, a remoção por `onCardDeleted` e o tratamento de falha ao ler as visões. Várias correções da D9 estão aqui.
- `src/ui/dashboard-view.ts` e `src/charts/render-chart.ts`: o construtor de gráficos e a renderização.
- `src/pipe-view.ts`: o aviso fora da Pipefy, o tema claro fixo dentro dela e a falha no `init` do SDK.
- O fluxo ponta a ponta no navegador.

Os testes rodam em Node, sem DOM.

### Proposta

1. Testes da orquestração com um ambiente de DOM (`happy-dom` ou `jsdom`) e o SDK falso de `src/pipefy/mock-sdk.ts`.
2. Um teste ponta a ponta com Playwright sobre o `npm run dev`, que já usa o SDK falso: abrir, esperar a carga, criar uma visão, recarregar e conferir que ela continua lá.

Dentro da Pipefy real, a validação continua manual, porque o SDK só funciona no iframe, com o `appID`.

### Custo

1 a 2 dias. Acrescenta dependências de desenvolvimento, então **precisa de decisão**.

---

## DT8. Formatação sem ferramenta que a garanta (21/11/2026)

### Estado atual

O código está consistente: indentação de 2 espaços, sem tabs, sem espaço no fim das linhas, LF, quebra no fim de todos os arquivos, aspas simples e ponto e vírgula. Mas nada garante isso: não há `.editorconfig`, Prettier nem ESLint, e o CI não confere a formatação. O comprimento de linha não tem limite definido: 81 linhas passam de 100 caracteres e 5 passam de 120.

### Proposta

1. `.editorconfig` com 2 espaços, LF e quebra no fim do arquivo. Sem dependência nova.
2. Prettier configurado no estilo atual (aspas simples, limite de 120 caracteres) e um `format:check` no CI. Antes, medir quantos arquivos ele reformataria.
3. ESLint com typescript-eslint, que pega problemas de verdade, além de estilo.

### Custo

1 a 2 h para os itens 1 e 2. O item 3 depende de quantos avisos aparecerem. Os itens 2 e 3 acrescentam dependências de desenvolvimento e **precisam de decisão**.
