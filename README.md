# OrangeHRM Playwright Automation

> **Professional** test automation framework for [OrangeHRM](https://opensource-demo.orangehrmlive.com/) built with **Playwright + TypeScript**, Page Object Model, and a complete **AI Agent system** for test generation, failure analysis, and quality lifecycle orchestration.

🌐 **English** | [Português](README.pt-BR.md)

---

## Table of Contents

- [Architecture](#architecture)
- [File Structure](#file-structure)
- [Getting Started](#getting-started)
- [Test Commands](#test-commands)
- [AI Agent System](#ai-agent-system)
  - [SDK Agents (TypeScript)](#sdk-agents-typescript--anthropic-api)
  - [Claude Code Agents](#claude-code-agents-agente)
  - [Orchestrators](#orchestrators)
  - [Full Pipeline](#full-quality-pipeline)
- [CI/CD](#cicd-github-actions)
- [Key Concepts](#key-concepts)
- [Tech Stack](#tech-stack)

---

## Architecture

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

### Design Decisions

| Decision | Rationale |
|---|---|
| **POM + Component Pattern** | Pages compose components; each UI fragment is independently testable |
| **BasePage / BaseComponent** | DRY wrappers with auto-waiting; all interactions go through resilient helpers |
| **Custom Fixtures** | Eliminates `beforeEach` boilerplate; fixtures manage page lifecycle |
| **API Auth Bypass** | `globalSetup` stores cookies so most tests skip the UI login |
| **Enum-driven constants** | Zero magic strings in specs; IDE autocomplete for routes and messages |
| **EmployeeFactory + faker** | Unique data per run; avoids conflicts on the shared demo instance |

---

## File Structure

```
qa-automation/
├── .claude/
│   └── agents/                         # Claude Code Agents
│       ├──── Specialists ──
│       ├── test-writer.md              # Generates specs following project patterns
│       ├── page-object-creator.md      # Creates Page Objects / Components
│       ├── failure-analyzer.md         # Diagnoses test failures
│       ├── test-reviewer.md            # Spec code review (checklist)
│       ├── coverage-advisor.md         # Maps coverage and prioritizes automation
│       ├── pr-guardian.md              # Checks coverage and blockers in PRs
│       ├── spec-from-ticket.md         # Generates spec from ticket description
│       ├── dead-code-detector.md       # Detects dead code (POs, fixtures, methods)
│       ├── duplicate-scenario-detector.md  # Finds redundant tests
│       ├──── Orchestrators ──
│       ├── qa-daily-orchestrator.md    # Consolidated post-CI pipeline
│       ├── pr-review-orchestrator.md   # Full parallel PR review
│       └── release-gate-orchestrator.md    # Release blocker with quality gates
│
├── .github/
│   └── workflows/
│       └── playwright.yml              # CI/CD with history collection and AI analysis
│
├── src/
│   ├── agents/                         # SDK Agents (TypeScript + Anthropic API)
│   │   ├── FailureAnalyzerAgent.ts     # Analyzes failures from results.json
│   │   ├── FlakyTestDetector.ts        # Detects flaky tests from run history
│   │   ├── TestGeneratorAgent.ts       # Navigates and generates Page Object + spec
│   │   ├── SelectorHealerAgent.ts      # Detects and suggests fixes for broken selectors
│   │   ├── TestDataGeneratorAgent.ts   # Generates edge-case data with Faker.js + Claude
│   │   ├── RootCauseClusterAgent.ts    # Groups CI failures by error pattern
│   │   ├── QualityTrendReporterAgent.ts # Quality trend report
│   │   └── ExploratoryAgent.ts         # Autonomous navigation and scenario generation
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
├── reports/                            # Reports generated by agents
├── global-setup.ts
├── playwright.config.ts
├── tsconfig.json
├── .env.example
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 9
- `ANTHROPIC_API_KEY` (required for AI agents)

### 1. Install

```bash
git clone <repo-url>
cd qa-automation
npm install
npx playwright install --with-deps chromium
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in the values in .env
```

---

## Test Commands

```bash
# Tests
npm test                          # All tests (headless)
npm run test:headed               # With visible browser
npm run test:ui                   # Interactive mode (Playwright UI)
npm run test:auth                 # Auth tests only
npm run test:pim                  # PIM tests only
npx playwright test --grep @smoke # Filter by tag

# Reports
npm run report:html               # Open HTML Report
npm run report:allure             # Generate and open Allure Report

# Utilities
npm run typecheck                 # Check TypeScript types
npm run clean                     # Clean build artifacts
```

---

## AI Agent System

The project has two types of agents: **SDK Agents** (TypeScript, run via `npm run`) and **Claude Code Agents** (`.md` files in `.claude/agents/`, invoked with `@agent-name` inside Claude Code).

---

### SDK Agents (TypeScript + Anthropic API)

Programmatic agents that run automated analyses.

#### `npm run analyze` — FailureAnalyzerAgent

Reads `test-results/results.json`, identifies failures and uses Claude to diagnose each one with type, root cause, file/line, and fix.

```bash
npm run analyze               # Analyzes the current results.json
npm run analyze:run           # Runs tests and then analyzes
npm run analyze -- --project=chromium:authenticated  # Filter by project
```

#### `npm run flaky` — FlakyTestDetector

Detects unstable tests by analyzing multiple historical runs. Classifies the flakiness type and suggests fixes.

```bash
npm run flaky
npm run flaky -- --history-dir=test-results/history --min-runs=3 --threshold=0.15
```

> **How to populate history:** CI automatically copies `results.json` to `test-results/history/` after each run.

#### `npm run generate` — TestGeneratorAgent

Navigates an OrangeHRM route with Playwright, extracts the page structure, and generates a complete Page Object + spec.

```bash
npm run generate -- --url=/web/index.php/leave/viewLeaveList
npm run generate -- --url=/web/index.php/admin/viewAdminModule --module=admin
```

#### `npm run explore` — ExploratoryAgent

Autonomously navigates from a route, discovers tabs and sub-flows, and generates a Page Object + spec covering all discovered flows.

```bash
npm run explore -- --url=/web/index.php/leave
npm run explore -- --url=/web/index.php/admin --depth=2   # explores internal links
```

#### `npm run heal` — SelectorHealerAgent

Opens each Page Object, tests the selectors on the real page with Playwright, and asks Claude to suggest alternatives for broken selectors.

```bash
npm run heal                        # Checks all Page Objects
npm run heal -- --page=LoginPage    # Filter by specific file
```

Generates a report at `reports/selector-health.md`.

#### `npm run data-gen` — TestDataGeneratorAgent

Analyzes the Page Objects of a module and generates a TypeScript factory with edge-case datasets (limits, XSS, internationalization, empty fields, invalid formats).

```bash
npm run data-gen -- --module=employee
npm run data-gen -- --module=leave --output=src/factories
```

#### `npm run cluster` — RootCauseClusterAgent

Groups failures from multiple runs by error pattern (timeout, locator, assertion, auth, network) and uses Claude to identify the common root cause and action plan.

```bash
npm run cluster
npm run cluster -- --history-dir=test-results/history --min-cluster=2
```

Generates a report at `reports/root-cause-clusters.md`.

#### `npm run eval` — AIEvaluatorAgent

Evaluates the output quality of other agents using **LLM-as-Judge** with explicit rubrics per criterion (0–10). The judge is `claude-opus-4-6` evaluating outputs from the other agents. Outputs with score < 7 are flagged for review.

```bash
npm run eval -- --agent=failure-analyzer --input=reports/last-analysis.md
npm run eval -- --agent=test-reviewer --input=src/tests/smoke/auth/login.spec.ts --save
npm run eval:all   # evaluates all agents with their latest outputs
```

Supported agents: `failure-analyzer` | `test-reviewer` | `coverage-advisor` | `selector-healer` | `test-generator`

Saves results to `reports/evals/eval-[agent]-[timestamp].json`.

#### `npm run synthetic` — SyntheticUserAgent

Simulates real users with a **BDI model** (Belief-Desire-Intention) — beliefs, goals, and emotional state. Navigates autonomously as a human would, including mistakes, frustration, and unexpected behaviors that reveal hidden UX bugs.

```bash
npm run synthetic -- --url=/web/index.php/pim/addEmployee --persona=maria-rh
npm run synthetic -- --url=/web/index.php/leave --persona=all --sessions=3
```

**Available personas:**

| Persona | Profile | Experience | Pressure |
|---|---|---|---|
| `maria-rh` | HR Manager, 45 years old | Low | High (meeting in 30min) |
| `joao-dev` | Developer, 28 years old | High | None |
| `ana-mobile` | Mobile-only analyst, 32 years old | Medium | Unstable connection |
| `carlos-gestor` | Director, 55 years old | Low | High (10min available) |
| `lucia-acessibilidade` | Low vision, 200% zoom | Medium | None |

Generates a report in `reports/synthetic/` with bugs found classified by severity.

#### `npm run mutation` — Stryker Mutation Testing

Injects controlled bugs into the code and checks if the tests detect them. Calculates the **mutation score** — the real quality metric for tests (different from code coverage).

```bash
npm run mutation:install   # install Stryker (first time only)
npm run mutation           # run mutation testing
```

> **Mutation score:** % of injected bugs that your tests detected. Target: ≥ 80%. Use `@mutation-validator` to interpret results and create an action plan.

Reports in `reports/mutation/` — interactive HTML + JSON for analysis.

#### `npm run trend` — QualityTrendReporterAgent

Reads the run history, calculates per-run metrics (pass rate, flaky, duration) and generates an executive trend report with insights for the team.

```bash
npm run trend
npm run trend -- --days=14 --output=reports/weekly-quality.md
```

---

### Claude Code Agents (`@agent`)

Specialized agents invoked directly in Claude Code. Each follows the project standards and can be composed by orchestrators.

#### Creation Agents

| Agent | Usage |
|---|---|
| `@test-writer` | Generates complete `.spec.ts` files following all project standards |
| `@page-object-creator` | Creates Page Objects and Components extending BasePage/BaseComponent |
| `@spec-from-ticket` | Receives ticket title + description + acceptance criteria and generates a ready-to-use spec |

**Example — spec-from-ticket:**
```
@spec-from-ticket

Ticket: [PROJ-123] Add duplicate email validation on employee registration
Acceptance criteria:
- System should display error when trying to register an already existing email
- Email field should be highlighted in red
- Error message: "Email already exists"
```

#### Analysis Agents

| Agent | Usage |
|---|---|
| `@failure-analyzer` | Diagnoses test failures with root cause, file/line, and fix |
| `@test-reviewer` | Spec code review: structure, imports, tags, assertions, anti-patterns |
| `@coverage-advisor` | Maps covered vs uncovered modules and recommends automation priorities |

#### Maintenance Agents

| Agent | Usage |
|---|---|
| `@pr-guardian` | Checks coverage and blockers in PR files — issues a verdict |
| `@dead-code-detector` | Detects Page Objects, public methods, factories, and fixtures never referenced |
| `@duplicate-scenario-detector` | Identifies redundant and overlapping tests with unification suggestions |
| `@mutation-validator` | Analyzes Stryker report, prioritizes surviving mutants, and generates tests to kill them |

---

### Orchestrators

Agents that **coordinate multiple specialized agents**, make decisions based on results, and produce consolidated outputs.

#### `@qa-daily-orchestrator` — Post-CI Pipeline

Run after any test suite for a complete diagnosis.

```
results.json
    ├── has failures?  → @failure-analyzer
    ├── has history?   → npm run flaky
    ├── both?          → npm run cluster
    ├── always         → npm run trend
    └── Monday?        → @coverage-advisor
         └── reports/daily-YYYY-MM-DD.md
```

**Generated status:**

| Status | Criteria |
|---|---|
| ✅ HEALTHY | Pass rate ≥ 95%, ≤ 1 flaky, stable trend |
| ⚠️ WARNING | Pass rate 80–94% or 2–5 flaky or worsening trend |
| 🚨 CRITICAL | Pass rate < 80% or > 5 flaky or failures in critical modules |

---

#### `@pr-review-orchestrator` — Full PR Review

Coordinates four analyses in parallel and issues a single consolidated verdict.

```
PR files
    ├── @pr-guardian               → coverage and blockers
    ├── @test-reviewer             → spec quality
    ├── @dead-code-detector        → disconnected Page Objects
    └── @duplicate-scenario-detector → introduced redundancies
         └── APPROVED / APPROVED WITH REMARKS / BLOCKED
```

**How to use:**
```
@pr-review-orchestrator

Files changed in PR #42:
- src/pages/LeavePage.ts (new)
- src/tests/smoke/leave/leave.spec.ts (new)
- src/fixtures/test.fixture.ts (modified)
```

---

#### `@release-gate-orchestrator` — Release Blocker

Evaluates 6 objective quality gates and issues an auditable **GO / NO-GO** verdict.

| Gate | Criteria | Weight |
|---|---|---|
| G1 | Pass rate ≥ 95% | 🔴 Critical |
| G2 | Auth + PIM with no failures | 🔴 Critical |
| G3 | Flaky tests ≤ 3 | 🟡 Important |
| G4 | Stable or improving trend | 🟡 Important |
| G5 | Critical modules coverage ok | 🟡 Important |
| G6 | No `test.only` or `test.skip` | 🔴 Critical |

> **GO**: all critical gates passed + at least 2 of 3 important ones
> **NO-GO**: any critical gate failed OR all 3 important ones failed

**How to use:**
```
@release-gate-orchestrator
```

Generates a report at `reports/release-gate-YYYY-MM-DD-HHmm.md`.

---

### Full Quality Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│  DEVELOPMENT                                                         │
│                                                                      │
│  Ticket created                                                      │
│      → @spec-from-ticket         generates spec draft               │
│      → @page-object-creator      creates Page Object if needed      │
│      → @test-writer              refines the spec                   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  PULL REQUEST                                                        │
│                                                                      │
│      → @pr-review-orchestrator   full parallel review               │
│          ├── @pr-guardian        coverage and blockers              │
│          ├── @test-reviewer      spec quality                       │
│          ├── @dead-code-detector dead code introduced               │
│          └── @duplicate-scenario-detector redundancies              │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  CI (GitHub Actions)                                                 │
│                                                                      │
│      typecheck → e2e-tests → allure-report → notify-and-analyze     │
│                     │                              │                 │
│               history saved               npm run correlate         │
│               (90 days)                   npm run notify            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  POST-CI                                                             │
│                                                                      │
│      → @qa-daily-orchestrator    consolidated diagnosis             │
│          ├── @failure-analyzer   failures                           │
│          ├── npm run flaky       instability                        │
│          ├── npm run cluster     root cause clusters                │
│          └── npm run trend       weekly trend                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────────┐
│  RELEASE                                                             │
│                                                                      │
│      → @release-gate-orchestrator  GO / NO-GO with 6 quality gates │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CI/CD (GitHub Actions)

The `.github/workflows/playwright.yml` workflow runs on every push/PR to `main` or `develop`:

```
push/PR
  └── typecheck
        └── e2e-tests (matrix: chromium:authenticated | chromium:unauthenticated)
              ├── Upload: HTML Report (30 days)
              ├── Upload: Allure Results (30 days)
              ├── Upload: Videos/Traces — on failure only (7 days)
              └── Upload: results.json history (90 days) ← feeds analysis agents
                    └── allure-report (consolidated)
                    └── notify-and-analyze
                          ├── npm run correlate   (RootCauseCorrelator)
                          └── npm run notify      (SlackTeamsReporter)
```

---

## Key Concepts

### API Auth Bypass

`globalSetup.ts` runs **once** before all tests:
1. Gets the CSRF token via `GET /auth/login`
2. Sends credentials via `POST /auth/validate`
3. Stores cookies in `auth/admin-storage-state.json`

Tests in the `chromium:authenticated` project load this state automatically.

### Factory Pattern

```typescript
const employee = EmployeeFactory.build();               // fully random
const employee = EmployeeFactory.build({ firstName: 'Alice' });  // with overrides
const employees = EmployeeFactory.buildMany(5);          // in bulk
```

### Custom Fixtures

```typescript
import { test, expect } from '@fixtures/test.fixture';

test('add employee', async ({ pimPage, addEmployeePage }) => {
  // Arrange
  const employee = EmployeeFactory.build();
  // Act
  await pimPage.goToAddEmployee();
  await addEmployeePage.createEmployee(employee);
  // Assert
  await addEmployeePage.expectSuccessToast(SuccessMessage.EMPLOYEE_SAVED);
});
```

### Test Tags

```bash
npx playwright test --grep @smoke        # Critical happy paths
npx playwright test --grep @regression   # Full regression
npx playwright test --grep @auth         # Auth module
npx playwright test --grep @pim          # PIM module
npx playwright test --grep @leave        # Leave module
npx playwright test --grep @admin        # Admin module
```

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| Playwright | ^1.43 | E2E Framework |
| TypeScript | ^5.4 | Static typing |
| @anthropic-ai/sdk | ^0.82 | Claude integration (AI agents) |
| @faker-js/faker | ^8.4 | Test data generation |
| allure-playwright | ^3.0 | Rich reports |
| dotenv | ^16.4 | Environment variable management |

---
