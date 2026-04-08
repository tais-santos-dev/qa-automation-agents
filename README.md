# OrangeHRM Playwright Automation

> Framework de automação de testes **profissional** para [OrangeHRM](https://opensource-demo.orangehrmlive.com/) com **Playwright + TypeScript**, Page Object Model, **sistema completo de Agentes de IA** para geração, análise e orquestração do ciclo de qualidade.

🌐 **Português** | [English](README.en.md)

---

## Índice

- [Arquitetura](#arquitetura)
- [Estrutura de Arquivos](#estrutura-de-arquivos)
- [Getting Started](#getting-started)
- [Comandos de Teste](#comandos-de-teste)
- [Sistema de Agentes de IA](#sistema-de-agentes-de-ia)
  - [SDK Agents (TypeScript)](#sdk-agents-typescript--anthropic-api)
  - [Claude Code Agents](#claude-code-agents--claude-agent)
  - [Orquestradores](#orquestradores)
  - [Pipeline completo](#pipeline-completo-de-qualidade)
- [CI/CD](#cicd-github-actions)
- [Conceitos-chave](#conceitos-chave)
- [Tech Stack](#tech-stack)

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         SPEC FILES                              │
│            (Describe + Test + Assertions)                       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ uses
┌──────────────────────▼──────────────────────────────────────────┐
│                    CUSTOM FIXTURES                               │
│          (Pre-instantiated Pages & Components)                  │
└──────┬───────────────────────────────────────┬──────────────────┘
       │ extends                               │ composes
┌──────▼──────────┐                  ┌─────────▼──────────────────┐
│   PAGE OBJECTS  │                  │  COMPONENT OBJECTS         │
│  (BasePage)     │                  │  (BaseComponent)           │
│  LoginPage      │                  │  SidebarComponent          │
│  PimPage        │                  │  TopbarComponent           │
│  AddEmployeePage│                  │  TableComponent            │
└──────┬──────────┘                  └────────────────────────────┘
       │ uses
┌──────▼────────────────────────────────────────────────────────┐
│  CONSTANTS      │  FACTORIES         │  API LAYER             │
│  Routes.ts      │  EmployeeFactory   │  AuthApi               │
│  Messages.ts    │  (faker-powered)   │  (API login bypass)    │
│  SidebarMenu.ts │                    │                        │
└───────────────────────────────────────────────────────────────┘
```

### Decisões de design

| Decisão | Justificativa |
|---|---|
| **POM + Component Pattern** | Pages compõem components; cada fragmento de UI é testável independentemente |
| **BasePage / BaseComponent** | Wrappers DRY com auto-waiting; todas as interações passam por helpers resilientes |
| **Custom Fixtures** | Elimina boilerplate de `beforeEach`; fixtures gerenciam o ciclo de vida da página |
| **API Auth Bypass** | `globalSetup` armazena cookies para que a maioria dos testes pule o login via UI |
| **Enum-driven constants** | Zero magic strings nos specs; autocomplete de IDE para rotas e mensagens |
| **EmployeeFactory + faker** | Dados únicos por execução; evita conflitos na instância demo compartilhada |

---

## Estrutura de Arquivos

```
qa-automation/
├── .claude/
│   └── agents/                         # Claude Code Agents
│       ├──── Especialistas ──
│       ├── test-writer.md              # Gera specs seguindo padrões do projeto
│       ├── page-object-creator.md      # Cria Page Objects / Components
│       ├── failure-analyzer.md         # Diagnostica falhas de teste
│       ├── test-reviewer.md            # Code review de specs (checklist)
│       ├── coverage-advisor.md         # Mapeia cobertura e prioriza automação
│       ├── pr-guardian.md              # Verifica cobertura e bloqueadores em PRs
│       ├── spec-from-ticket.md         # Gera spec a partir de ticket
│       ├── dead-code-detector.md       # Detecta código morto (POs, fixtures, métodos)
│       ├── duplicate-scenario-detector.md  # Encontra testes redundantes
│       ├──── Orquestradores ──
│       ├── qa-daily-orchestrator.md    # Pipeline pós-CI consolidado
│       ├── pr-review-orchestrator.md   # Review completo de PR em paralelo
│       └── release-gate-orchestrator.md    # Bloqueio de release com quality gates
│
├── .github/
│   └── workflows/
│       └── playwright.yml              # CI/CD com coleta de histórico e análise IA
│
├── src/
│   ├── agents/                         # SDK Agents (TypeScript + Anthropic API)
│   │   ├── FailureAnalyzerAgent.ts     # Analisa falhas do results.json
│   │   ├── FlakyTestDetector.ts        # Detecta testes instáveis por histórico
│   │   ├── TestGeneratorAgent.ts       # Navega e gera Page Object + spec
│   │   ├── SelectorHealerAgent.ts      # Detecta e sugere correção de seletores quebrados
│   │   ├── TestDataGeneratorAgent.ts   # Gera dados edge-case com Faker.js + Claude
│   │   ├── RootCauseClusterAgent.ts    # Agrupa falhas de CI por padrão de erro
│   │   ├── QualityTrendReporterAgent.ts # Relatório de tendência de qualidade
│   │   └── ExploratoryAgent.ts         # Navegação autônoma e geração de cenários
│   │
│   ├── api/
│   │   └── AuthApi.ts
│   ├── components/
│   │   ├── SidebarComponent.ts
│   │   ├── TopbarComponent.ts
│   │   └── TableComponent.ts
│   ├── constants/
│   │   ├── Routes.ts                   # AppRoute enum
│   │   ├── Messages.ts                 # ErrorMessage / SuccessMessage enums
│   │   └── SidebarMenu.ts
│   ├── factories/
│   │   └── EmployeeFactory.ts
│   ├── fixtures/
│   │   └── test.fixture.ts
│   ├── pages/
│   │   ├── LoginPage.ts
│   │   ├── PimPage.ts
│   │   └── AddEmployeePage.ts
│   ├── tests/
│   │   └── smoke/auth/login.spec.ts
│   └── utils/
│       ├── BasePage.ts
│       └── BaseComponent.ts
│
├── reports/                            # Relatórios gerados pelos agentes
├── global-setup.ts
├── playwright.config.ts
├── tsconfig.json
├── .env.example
└── package.json
```

---

## Getting Started

### Pré-requisitos

- Node.js ≥ 20
- npm ≥ 9
- `ANTHROPIC_API_KEY` (para os agentes de IA)

### 1. Instalar

```bash
git clone <repo-url>
cd qa-automation
npm install
npx playwright install --with-deps chromium
```

### 2. Configurar ambiente

```bash
cp .env.example .env
```

## Comandos de Teste

```bash
# Testes
npm test                          # Todos os testes (headless)
npm run test:headed               # Com browser visível
npm run test:ui                   # Modo interativo (UI do Playwright)
npm run test:auth                 # Apenas testes de auth
npm run test:pim                  # Apenas testes de PIM
npx playwright test --grep @smoke # Filtrar por tag

# Relatórios
npm run report:html               # Abrir HTML Report
npm run report:allure             # Gerar e abrir Allure Report

# Utilitários
npm run typecheck                 # Verificar tipos TypeScript
npm run clean                     # Limpar artefatos de execução
```

---

## Sistema de Agentes de IA

O projeto possui dois tipos de agentes: **SDK Agents** (TypeScript, executados via `npm run`) e **Claude Code Agents** (arquivos `.md` em `.claude/agents/`, invocados com `@nome-do-agente` no Claude Code).

---

### SDK Agents (TypeScript + Anthropic API)

Agentes programáticos que executam análises automatizadas

#### `npm run analyze` — FailureAnalyzerAgent

Lê `test-results/results.json`, identifica falhas e usa Claude para diagnosticar cada uma com tipo, causa raiz, arquivo/linha e correção.

```bash
npm run analyze               # Analisa o results.json atual
npm run analyze:run           # Executa os testes e depois analisa
npm run analyze -- --project=chromium:authenticated  # Filtra por projeto
```

#### `npm run flaky` — FlakyTestDetector

Detecta testes instáveis analisando múltiplas execuções históricas. Classifica o tipo de flakiness e sugere correções.

```bash
npm run flaky
npm run flaky -- --history-dir=test-results/history --min-runs=3 --threshold=0.15
```

> **Como popular o histórico:** o CI copia `results.json` automaticamente para `test-results/history/` a cada run.

#### `npm run generate` — TestGeneratorAgent

Navega em uma rota do OrangeHRM com Playwright, extrai a estrutura da página e gera Page Object + spec completo.

```bash
npm run generate -- --url=/web/index.php/leave/viewLeaveList
npm run generate -- --url=/web/index.php/admin/viewAdminModule --module=admin
```

#### `npm run explore` — ExploratoryAgent

Navega autonomamente a partir de uma rota, descobre tabs e sub-fluxos, e gera Page Object + spec cobrindo todos os fluxos encontrados.

```bash
npm run explore -- --url=/web/index.php/leave
npm run explore -- --url=/web/index.php/admin --depth=2   # explora links internos
```

#### `npm run heal` — SelectorHealerAgent

Abre cada Page Object, testa os seletores na página real com Playwright e pede ao Claude para sugerir alternativas para os seletores quebrados.

```bash
npm run heal                        # Verifica todos os Page Objects
npm run heal -- --page=LoginPage    # Filtra por arquivo específico
```

Gera relatório em `reports/selector-health.md`.

#### `npm run data-gen` — TestDataGeneratorAgent

Analisa os Page Objects de um módulo e gera uma factory TypeScript com datasets edge-case (limites, XSS, internacionalização, campos vazios, formatos inválidos).

```bash
npm run data-gen -- --module=employee
npm run data-gen -- --module=leave --output=src/factories
```

#### `npm run cluster` — RootCauseClusterAgent

Agrupa falhas de múltiplos runs por padrão de erro (timeout, locator, assertion, auth, rede) e usa Claude para identificar causa raiz comum e plano de ação.

```bash
npm run cluster
npm run cluster -- --history-dir=test-results/history --min-cluster=2
```

Gera relatório em `reports/root-cause-clusters.md`.

#### `npm run eval` — AIEvaluatorAgent

Avalia a qualidade dos outputs de outros agentes usando **LLM-as-Judge** com rubricas explícitas por critério (0–10). O juiz é `claude-opus-4-6` avaliando outputs dos demais agentes. Outputs com score < 7 são sinalizados para revisão.

```bash
npm run eval -- --agent=failure-analyzer --input=reports/last-analysis.md
npm run eval -- --agent=test-reviewer --input=src/tests/smoke/auth/login.spec.ts --save
npm run eval:all   # avalia todos os agentes com seus últimos outputs
```

Agentes suportados: `failure-analyzer` | `test-reviewer` | `coverage-advisor` | `selector-healer` | `test-generator`

Salva resultados em `reports/evals/eval-[agente]-[timestamp].json`.

#### `npm run synthetic` — SyntheticUserAgent

Simula usuários reais com **modelo BDI** (Belief-Desire-Intention) — crenças, objetivos e estado emocional. Navega autonomamente como um humano faria, incluindo erros, frustração e comportamentos inesperados que revelam bugs ocultos de UX.

```bash
npm run synthetic -- --url=/web/index.php/pim/addEmployee --persona=maria-rh
npm run synthetic -- --url=/web/index.php/leave --persona=all --sessions=3
```

**Personas disponíveis:**

| Persona | Perfil | Experiência | Pressão |
|---|---|---|---|
| `maria-rh` | Gerente de RH, 45 anos | Baixa | Alta (reunião em 30min) |
| `joao-dev` | Desenvolvedor, 28 anos | Alta | Nenhuma |
| `ana-mobile` | Analista mobile-only, 32 anos | Média | Conexão instável |
| `carlos-gestor` | Diretor, 55 anos | Baixa | Alta (10min disponíveis) |
| `lucia-acessibilidade` | Baixa visão, zoom 200% | Média | Nenhuma |

Gera relatório em `reports/synthetic/` com bugs encontrados classificados por severidade.

#### `npm run mutation` — Stryker Mutation Testing

Injeta bugs controlados no código e verifica se os testes os detectam. Calcula o **mutation score** — a métrica real de qualidade dos testes (diferente de cobertura de código).

```bash
npm run mutation:install   # instala Stryker (apenas primeira vez)
npm run mutation           # executa mutation testing
```

> **Mutation score:** % de bugs injetados que seus testes detectaram. Meta: ≥ 80%. Use `@mutation-validator` para interpretar os resultados e criar plano de ação.

Relatórios em `reports/mutation/` — HTML interativo + JSON para análise.

#### `npm run trend` — QualityTrendReporterAgent

Lê o histórico de execuções, calcula métricas por run (pass rate, flaky, duração) e gera um relatório executivo de tendência com insights para o time.

```bash
npm run trend
npm run trend -- --days=14 --output=reports/weekly-quality.md
```

---

### Claude Code Agents (`@agente`)

Agentes especializados invocados diretamente no Claude Code. Cada um segue os padrões do projeto e pode ser composto por orquestradores.

#### Agentes de Criação

| Agente | Uso |
|---|---|
| `@test-writer` | Gera specs `.spec.ts` completos seguindo todos os padrões do projeto |
| `@page-object-creator` | Cria Page Objects e Components estendendo BasePage/BaseComponent |
| `@spec-from-ticket` | Recebe título + descrição + critérios de aceite de um ticket e gera spec pronto |

**Exemplo — spec-from-ticket:**
```
@spec-from-ticket

Ticket: [PROJ-123] Adicionar validação de email duplicado no cadastro de funcionário
Critérios de aceite:
- Sistema deve exibir erro ao tentar cadastrar email já existente
- Campo email deve ser destacado em vermelho
- Mensagem de erro: "Email already exists"
```

#### Agentes de Análise

| Agente | Uso |
|---|---|
| `@failure-analyzer` | Diagnostica falhas de teste com causa raiz, arquivo/linha e correção |
| `@test-reviewer` | Code review de specs: estrutura, imports, tags, assertions, anti-patterns |
| `@coverage-advisor` | Mapeia módulos cobertos vs descobertos e recomenda prioridades de automação |

#### Agentes de Manutenção

| Agente | Uso |
|---|---|
| `@pr-guardian` | Verifica cobertura e bloqueadores em arquivos de um PR — emite veredito |
| `@dead-code-detector` | Detecta Page Objects, métodos públicos, factories e fixtures nunca referenciados |
| `@duplicate-scenario-detector` | Identifica testes redundantes e sobrepostos com sugestão de unificação |
| `@mutation-validator` | Analisa relatório do Stryker, prioriza mutantes sobreviventes e gera testes para matá-los |

---

### Orquestradores

Agentes que **coordenam múltiplos agentes especializados**, tomam decisões com base nos resultados e produzem outputs consolidados.

#### `@qa-daily-orchestrator` — Pipeline pós-CI

Execute após qualquer rodada de testes para obter um diagnóstico completo.

```
results.json
    ├── tem falhas?    → @failure-analyzer
    ├── tem histórico? → npm run flaky
    ├── ambos?         → npm run cluster
    ├── sempre         → npm run trend
    └── segunda-feira? → @coverage-advisor
         └── reports/daily-YYYY-MM-DD.md
```

**Status gerado:**

| Status | Critério |
|---|---|
| ✅ SAUDÁVEL | Pass rate ≥ 95%, ≤ 1 flaky, tendência estável |
| ⚠️ ATENÇÃO | Pass rate 80–94% ou 2–5 flaky ou tendência piorando |
| 🚨 CRÍTICO | Pass rate < 80% ou > 5 flaky ou falhas em módulos críticos |

---

#### `@pr-review-orchestrator` — Review completo de PR

Coordena quatro análises em paralelo e emite um único veredito consolidado.

```
arquivos do PR
    ├── @pr-guardian               → cobertura e bloqueadores
    ├── @test-reviewer             → qualidade dos specs
    ├── @dead-code-detector        → Page Objects desconectados
    └── @duplicate-scenario-detector → redundâncias introduzidas
         └── APROVADO / APROVADO COM RESSALVAS / BLOQUEADO
```

**Como usar:**
```
@pr-review-orchestrator

Arquivos alterados no PR #42:
- src/pages/LeavePage.ts (novo)
- src/tests/smoke/leave/leave.spec.ts (novo)
- src/fixtures/test.fixture.ts (modificado)
```

---

#### `@release-gate-orchestrator` — Bloqueio de release

Avalia 6 quality gates objetivos e emite um veredito **GO / NO-GO** auditável.

| Gate | Critério | Peso |
|---|---|---|
| G1 | Pass rate ≥ 95% | 🔴 Crítico |
| G2 | Auth + PIM sem nenhuma falha | 🔴 Crítico |
| G3 | Testes flaky ≤ 3 | 🟡 Importante |
| G4 | Tendência estável ou melhorando | 🟡 Importante |
| G5 | Cobertura dos módulos críticos ok | 🟡 Importante |
| G6 | Sem `test.only` ou `test.skip` | 🔴 Crítico |

> **GO**: todos os críticos aprovados + pelo menos 2 dos 3 importantes
> **NO-GO**: qualquer crítico reprovado OU todos os 3 importantes reprovados

**Como usar:**
```
@release-gate-orchestrator
```

Gera relatório em `reports/release-gate-YYYY-MM-DD-HHmm.md`.

---

### Pipeline Completo de Qualidade

```
┌─────────────────────────────────────────────────────────────────────┐
│  DESENVOLVIMENTO                                                     │
│                                                                      │
│  Ticket criado                                                       │
│      → @spec-from-ticket         gera rascunho de spec              │
│      → @page-object-creator      cria Page Object se necessário     │
│      → @test-writer              refina o spec                      │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  PULL REQUEST                                                        │
│                                                                      │
│      → @pr-review-orchestrator   review completo em paralelo        │
│          ├── @pr-guardian        cobertura e bloqueadores           │
│          ├── @test-reviewer      qualidade do spec                  │
│          ├── @dead-code-detector código morto introduzido           │
│          └── @duplicate-scenario-detector redundâncias              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  CI (GitHub Actions)                                                 │
│                                                                      │
│      typecheck → e2e-tests → allure-report → notify-and-analyze     │
│                     │                              │                 │
│               histórico salvo              npm run correlate         │
│               (90 dias)                    npm run notify            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  PÓS-CI                                                              │
│                                                                      │
│      → @qa-daily-orchestrator    diagnóstico consolidado            │
│          ├── @failure-analyzer   falhas                             │
│          ├── npm run flaky       instabilidade                      │
│          ├── npm run cluster     clusters de causa raiz             │
│          └── npm run trend       tendência da semana                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  RELEASE                                                             │
│                                                                      │
│      → @release-gate-orchestrator  GO / NO-GO com 6 quality gates  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CI/CD (GitHub Actions)

O workflow `.github/workflows/playwright.yml` executa em todo push/PR para `main` ou `develop`:

```
push/PR
  └── typecheck
        └── e2e-tests (matrix: chromium:authenticated | chromium:unauthenticated)
              ├── Upload: HTML Report (30 dias)
              ├── Upload: Allure Results (30 dias)
              ├── Upload: Vídeos/Traces — apenas em falha (7 dias)
              └── Upload: Histórico results.json (90 dias) ← alimenta agentes de análise
                    └── allure-report (consolidado)
                    └── notify-and-analyze
                          ├── npm run correlate   (RootCauseCorrelator)
                          └── npm run notify      (SlackTeamsReporter)
```

## Conceitos-chave

### API Auth Bypass

`globalSetup.ts` executa **uma vez** antes de todos os testes:
1. Obtém o token CSRF via `GET /auth/login`
2. Envia credenciais via `POST /auth/validate`
3. Armazena cookies em `auth/admin-storage-state.json`

Testes no projeto `chromium:authenticated` carregam esse estado automaticamente.

### Factory Pattern

```typescript
const employee = EmployeeFactory.build();               // totalmente aleatório
const employee = EmployeeFactory.build({ firstName: 'Alice' });  // com overrides
const employees = EmployeeFactory.buildMany(5);          // em lote
```

### Custom Fixtures

```typescript
import { test, expect } from '@fixtures/test.fixture';

test('adicionar funcionário', async ({ pimPage, addEmployeePage }) => {
  // Arrange
  const employee = EmployeeFactory.build();
  // Act
  await pimPage.goToAddEmployee();
  await addEmployeePage.createEmployee(employee);
  // Assert
  await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
});
```

### Tags de teste

```bash
npx playwright test --grep @smoke        # Caminhos felizes críticos
npx playwright test --grep @regression   # Regressão completa
npx playwright test --grep @auth         # Módulo de autenticação
npx playwright test --grep @pim          # Módulo PIM
npx playwright test --grep @leave        # Módulo Leave
npx playwright test --grep @admin        # Módulo Admin
```

---

## Tech Stack

| Ferramenta | Versão | Finalidade |
|---|---|---|
| Playwright | ^1.43 | Framework E2E |
| TypeScript | ^5.4 | Tipagem estática |
| @anthropic-ai/sdk | ^0.82 | Integração com Claude (agentes de IA) |
| @faker-js/faker | ^8.4 | Geração de dados de teste |
| allure-playwright | ^3.0 | Relatórios ricos |
| dotenv | ^16.4 | Gestão de variáveis de ambiente |

---

