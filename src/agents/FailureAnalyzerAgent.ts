/**
 * FailureAnalyzerAgent.ts
 *
 * Agente AI que lê o relatório JSON do Playwright, identifica falhas e usa
 * a API do Claude para diagnosticar cada falha e sugerir correções.
 *
 * Uso:
 *   npx ts-node src/agents/FailureAnalyzerAgent.ts
 *   npx ts-node src/agents/FailureAnalyzerAgent.ts --run-tests
 *
 * Flags:
 *   --run-tests   Executa os testes antes de analisar (gera results.json fresco)
 *   --project     Filtra por projeto Playwright (ex: --project=chromium:unauthenticated)
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── Tipos do relatório JSON do Playwright ─────────────────────────────────

interface PlaywrightError {
  message: string;
  stack?: string;
}

interface PlaywrightTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  duration: number;
  errors: PlaywrightError[];
  retry: number;
}

interface PlaywrightTest {
  title: string;
  fullTitle: string;
  results: PlaywrightTestResult[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightTest[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  stats: {
    expected: number;
    unexpected: number;
    skipped: number;
    flaky: number;
    duration: number;
  };
  suites: PlaywrightSuite[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const RESULTS_PATH = path.resolve('test-results/results.json');

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    runTests: args.includes('--run-tests'),
    project: args.find(a => a.startsWith('--project='))?.split('=')[1],
  };
}

function runTests(project?: string) {
  const projectFlag = project ? ` --project="${project}"` : '';
  console.log(`\n▶  Executando testes${project ? ` (${project})` : ''}...\n`);
  try {
    execSync(`npx playwright test${projectFlag}`, { stdio: 'inherit' });
  } catch {
    // Playwright retorna exit code != 0 quando há falhas — isso é esperado
  }
}

function loadReport(): PlaywrightReport {
  if (!fs.existsSync(RESULTS_PATH)) {
    throw new Error(
      `Relatório não encontrado em ${RESULTS_PATH}.\n` +
      'Execute os testes primeiro com --run-tests ou rode: npx playwright test'
    );
  }
  return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
}

// ─── Extração de falhas ────────────────────────────────────────────────────

interface FailedTest {
  title: string;
  file: string;
  error: string;
  stack: string;
}

function extractFailures(suites: PlaywrightSuite[], file = ''): FailedTest[] {
  const failures: FailedTest[] = [];

  for (const suite of suites) {
    const currentFile = suite.file ?? file;

    // Recursão em sub-suites
    if (suite.suites?.length) {
      failures.push(...extractFailures(suite.suites, currentFile));
    }

    // Specs (testes folha)
    for (const spec of suite.specs ?? []) {
      for (const result of spec.results) {
        if (result.status === 'failed' || result.status === 'timedOut') {
          const firstError = result.errors[0];
          failures.push({
            title: spec.fullTitle || spec.title,
            file: currentFile,
            error: firstError?.message ?? `Status: ${result.status}`,
            stack: firstError?.stack ?? '',
          });
        }
      }
    }
  }

  return failures;
}

// ─── Análise com Claude ────────────────────────────────────────────────────

const FAILURE_ANALYZER_SYSTEM_PROMPT = `Você é um engenheiro sênior de QA especializado em Playwright e TypeScript.
O projeto é uma automação de testes para OrangeHRM (https://opensource-demo.orangehrmlive.com).

Arquitetura do projeto:
- Page Object Model com BasePage e BaseComponent como classes base
- Fixtures customizadas do Playwright (loginPage, pimPage, addEmployeePage, sidebar, topbar)
- Constantes em enums: AppRoute, ErrorMessage, SuccessMessage, SidebarMenu
- Auth salva em auth/admin-storage-state.json via global-setup.ts
- Timeout por teste: 45s | Timeout por assertion: 10s | Retries em CI: 2

Para cada falha, forneça:
1. **Tipo** — classifique: locator quebrado / timeout / assertion / auth / race condition / outro
2. **Causa raiz** — explicação objetiva em 1-2 frases
3. **Arquivo e linha** — onde corrigir (se identificável pelo stack)
4. **Correção** — código antes/depois pronto para aplicar
5. **Prevenção** — como evitar recorrência

Seja direto e específico. Não repita o stack trace completo na resposta.` as const;

async function analyzeFailures(client: Anthropic, failures: FailedTest[]): Promise<void> {
  for (let i = 0; i < failures.length; i++) {
    const failure = failures[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`❌  [${i + 1}/${failures.length}] ${failure.title}`);
    console.log(`📁  ${failure.file}`);
    console.log(`${'─'.repeat(60)}\n`);

    const userMessage = `Analise esta falha de teste Playwright:

**Teste:** ${failure.title}
**Arquivo:** ${failure.file}

**Erro:**
${failure.error}

**Stack trace:**
${failure.stack || '(não disponível)'}`;

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: FAILURE_ANALYZER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        process.stdout.write(event.delta.text);
      }
    }

    console.log('\n');
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { runTests: shouldRun, project } = parseArgs();

  if (shouldRun) {
    runTests(project);
  }

  console.log('\n🔍  Carregando relatório de testes...');
  const report = loadReport();

  const { stats } = report;
  console.log(
    `\n📊  Resultados: ` +
    `✅ ${stats.expected} passou | ` +
    `❌ ${stats.unexpected} falhou | ` +
    `⏭  ${stats.skipped} pulado | ` +
    `🔁 ${stats.flaky} flaky`
  );

  const failures = extractFailures(report.suites);

  if (failures.length === 0) {
    console.log('\n✅  Nenhuma falha encontrada. Todos os testes passaram!\n');
    return;
  }

  console.log(`\n🤖  Analisando ${failures.length} falha(s) com Claude...\n`);
  const client = new Anthropic();
  await analyzeFailures(client, failures);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Análise concluída. ${failures.length} falha(s) diagnosticada(s).`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
