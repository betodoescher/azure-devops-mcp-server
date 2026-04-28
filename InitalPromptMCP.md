# Azure DevOps MCP Server — Completo

## Contexto
Crie um MCP Server completo para integração com Azure DevOps no diretório `#AzureDevops`.

A organização de acesso é: `https://dev.azure.com/ecoagro-tech`
A autenticação é via Personal Access Token (PAT) usando Basic Auth no header.

---

## Stack e Requisitos Técnicos

- **Runtime:** Node.js 20+ com TypeScript (strict mode)
- **MCP SDK:** `@modelcontextprotocol/sdk` (versão mais recente)
- **HTTP Client:** `axios` com interceptors para retry e timeout
- **Validação:** `zod` para todos os schemas de input/output
- **Qualidade:** ESLint + Prettier configurados
- **Build:** `tsup` para bundling

---

## Segurança (crítico)

1. O PAT jamais deve estar hardcoded — ler **apenas** via variável de ambiente `AZURE_DEVOPS_PAT`
2. Criar um `.env.example` com todas as variáveis necessárias documentadas
3. Adicionar `.env` e `*.env` no `.gitignore`
4. Usar um módulo `config.ts` centralizado que valida com `zod` todas as envs na inicialização — se alguma estiver ausente, o processo deve falhar com mensagem clara
5. Sanitizar todos os inputs antes de enviar para a API (sem injeção de parâmetros)
6. Nunca logar o valor do PAT, nem parcialmente

---

## Estrutura de Diretórios

```
AzureDevops/
├── src/
│   ├── index.ts                  # entrypoint MCP
│   ├── config.ts                 # validação de envs com zod
│   ├── azureClient.ts            # cliente axios com retry/timeout/auth
│   ├── tools/
│   │   ├── projects.ts           # ferramentas de projetos
│   │   ├── workItems.ts          # criação, edição, listagem de work items
│   │   ├── boards.ts             # boards e sprints
│   │   ├── pipelines.ts          # pipelines CI/CD
│   │   ├── repos.ts              # repositórios, commits, PRs
│   │   ├── teams.ts              # times e membros
│   │   ├── queries.ts            # WIQL queries
│   │   ├── analytics.ts          # métricas de fluxo e qualidade
│   │   ├── reports.ts            # relatórios de sprint e release notes
│   │   ├── bulk.ts               # operações em lote
│   │   ├── templates.ts          # templates e scaffolding
│   │   ├── standup.ts            # daily standup helper
│   │   └── audit.ts              # auditoria e alertas
│   └── types/
│       └── azure.ts              # tipos compartilhados
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── eslint.config.js
└── README.md
```

---

## Ferramentas MCP a Implementar

### 1. Projects
- `list_projects` — lista todos os projetos da organização
- `get_project` — detalhes de um projeto pelo id/nome

### 2. Work Items
- `create_work_item` — cria qualquer tipo (Bug, Task, User Story, Epic, Feature, etc.) com todos os campos suportados (título, descrição, assignee, priority, tags, área, iteração, relações)
- `get_work_item` — retorna work item por ID com todos os campos
- `update_work_item` — atualiza campos via JSON Patch
- `list_work_items` — lista por projeto com filtros (tipo, estado, assignee, sprint, área)
- `delete_work_item` — move para lixeira
- `add_comment` — adiciona comentário em work item
- `get_work_item_history` — histórico de atualizações
- `bulk_create_work_items` — criação em lote
- `link_work_items` — cria relações entre work items

### 3. Boards & Sprints
- `list_boards` — boards do projeto
- `get_board_columns` — colunas e WIP limits
- `list_sprints` — sprints do time
- `get_current_sprint` — sprint ativa
- `get_sprint_work_items` — itens de uma sprint

### 4. Pipelines
- `list_pipelines` — pipelines do projeto
- `get_pipeline` — detalhes de um pipeline
- `run_pipeline` — dispara uma execução
- `get_pipeline_runs` — histórico de execuções
- `get_pipeline_run_details` — logs e status de uma execução

### 5. Repositórios & Git
- `list_repositories` — repos do projeto
- `get_repository` — detalhes do repositório
- `list_pull_requests` — PRs com filtros (estado, autor, branch)
- `get_pull_request` — detalhes de um PR
- `create_pull_request` — cria novo PR
- `list_commits` — commits de um repo com filtros de data/autor
- `get_file_content` — conteúdo de um arquivo do repo

### 6. Times
- `list_teams` — times do projeto
- `get_team_members` — membros de um time

### 7. Queries (WIQL)
- `run_wiql_query` — executa query WIQL customizada
- `list_saved_queries` — queries salvas do projeto

### 8. Métricas de Fluxo & Qualidade (analytics.ts)
- `get_cycle_time` — calcula cycle time médio por tipo de work item em um período
- `get_lead_time` — calcula lead time médio (criação até fechamento)
- `get_team_throughput` — throughput da equipe por sprint ou período (itens entregues/semana)
- `get_velocity_history` — velocity histórico por time (story points ou contagem de itens)
- `get_sprint_burndown` — dados de burndown da sprint atual ou passada em formato tabular
- `get_quality_metrics` — taxa de bugs reabertos, MTTR (tempo médio de resolução de bugs), PRs sem review há mais de N dias, work items sem critério de aceite
- `get_work_distribution` — distribuição de trabalho por membro do time em um período

### 9. Relatórios de Sprint & Release Notes (reports.ts)
- `get_sprint_summary` — resumo completo da sprint: planejado vs concluído, itens carregados para próxima sprint, bugs abertos/fechados no período
- `generate_release_notes` — gera release notes a partir de work items fechados em um período ou sprint, agrupados por tipo (features, bug fixes, melhorias), exportável em Markdown ou HTML, com suporte a filtros por tag, área ou sprint
- `get_incomplete_items_report` — relatório de itens não concluídos com motivo e dias em aberto

### 10. Operações em Lote (bulk.ts)
- `bulk_move_sprint_items` — move todos os itens de uma sprint para outra (com filtros opcionais por estado/tipo)
- `bulk_reassign_work_items` — reatribui work items de um membro para outro (com filtros opcionais)
- `bulk_close_work_items` — fecha/resolve múltiplos itens por lista de IDs ou critério de query
- `bulk_apply_tags` — aplica ou remove tags em múltiplos itens por critério (tipo, área, sprint, estado)
- `bulk_update_field` — atualiza um campo específico em múltiplos work items de uma vez

### 11. Templates & Scaffolding (templates.ts)
- `create_sprint_from_template` — cria uma sprint completa (goals, capacity, datas) a partir de um template JSON configurável
- `scaffold_epic_hierarchy` — cria uma hierarquia completa Epic → Feature → User Stories a partir de uma estrutura de input, linkando automaticamente os itens
- `duplicate_sprint_structure` — duplica a estrutura de itens de uma sprint anterior (sem clonar dados, apenas estrutura) para a sprint atual
- `list_work_item_templates` — lista templates de work item disponíveis por tipo
- `create_from_work_item_template` — cria um work item a partir de um template com campos pré-preenchidos

### 12. Daily Standup Helper (standup.ts)
- `get_standup_summary` — gera resumo estruturado de standup: o que cada pessoa fez ontem (itens movidos para Done), o que está planejado para hoje (itens In Progress + To Do atribuídos), e itens com tag "impedimento" ou estado "Blocked" ativos no projeto
- `export_standup_agenda` — exporta a pauta do standup em Markdown formatado, pronto para colar no Slack ou Teams

### 13. Auditoria, Alertas & Compliance (audit.ts)
- `get_blocked_items_alert` — lista work items com estado "Blocked" ou tag "impedimento" há mais de N dias (configurável), com responsável e última atualização
- `get_sprint_health_alert` — avalia risco de entrega da sprint: calcula % concluído vs % de dias decorridos e sinaliza risco (baixo/médio/alto) com recomendações
- `get_stale_prs_alert` — PRs abertos sem atividade há mais de N dias com autor e reviewers pendentes
- `get_failing_pipelines_alert` — pipelines com execuções falhando em sequência (configurável: N falhas consecutivas)
- `get_audit_log` — quem alterou o quê e quando em work items (baseado no history da API)
- `get_items_without_estimation` — work items sem story points ou estimativa de esforço por sprint/área
- `get_prs_without_required_review` — PRs mergeados sem aprovação obrigatória (baseado em políticas da branch)
- `get_items_without_acceptance_criteria` — work items do tipo User Story sem campo de critério de aceite preenchido

---

## Padrões de Implementação

### Cliente HTTP (azureClient.ts)
- Instância axios com `baseURL`, auth header e `Content-Type` configurados
- Interceptor de retry automático (3 tentativas, backoff exponencial) para erros 429 e 5xx
- Timeout de 30s por request
- Interceptor de log estruturado (nunca logar o PAT)

### Tools MCP
- Cada tool deve ter nome, descrição detalhada em inglês e schema de input com `zod`
- Retornar erros da API com mensagem amigável e o código HTTP original
- Usar `inputSchema` do MCP SDK para validação automática
- Tools de analytics e relatórios devem aceitar parâmetros de período (`startDate`, `endDate`) no formato ISO 8601

### Config (config.ts)
```typescript
const envSchema = z.object({
  AZURE_DEVOPS_PAT: z.string().min(1),
  AZURE_DEVOPS_ORG: z.string().url().default('https://dev.azure.com/ecoagro-tech'),
  AZURE_DEVOPS_API_VERSION: z.string().default('7.1'),
  STALE_PR_DAYS: z.coerce.number().default(3),
  BLOCKED_ITEM_DAYS: z.coerce.number().default(2),
  FAILING_PIPELINE_THRESHOLD: z.coerce.number().default(3),
})
export const config = envSchema.parse(process.env)
```

---

## README.md

Deve conter:
1. Pré-requisitos e instalação (`npm install`)
2. Como gerar o PAT no Azure DevOps (passo a passo com permissões mínimas necessárias por categoria de tool)
3. Configuração do `.env` com todas as variáveis incluindo thresholds de alerta
4. Como adicionar ao MCP de um cliente (Claude Desktop, Kiro, etc.)
5. Lista completa de todas as ferramentas disponíveis por categoria com exemplos de uso
6. Como rodar em modo desenvolvimento

---

## Restrições
- Usar apenas a API REST do Azure DevOps (`_apis/`) — api-version padrão `7.1`
- Não usar bibliotecas de alto nível como `azure-devops-node-api` — implementar chamadas diretas
- Todo o código deve compilar sem erros com `strict: true` no tsconfig
- Nenhum `any` explícito — tipar tudo corretamente
- Tools de analytics devem calcular métricas no lado do MCP (não delegar ao LLM) — buscar os dados brutos e retornar já agregados