/**
 * RootCauseCorrelator.ts
 *
 * Agente AI que agrupa falhas de teste por padrão e usa Claude para identificar
 * se múltiplas falhas compartilham uma causa raiz comum — evitando que o time
 * investigue 8 falhas separadas quando na verdade é 1 problema só.
 *
 * Uso:
 *   npm run correlate
 *   npm run correlate -- --file=test-results/results.json
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PlaywrightError {
  message: string;
  stack?: string;
}

interface PlaywrightTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  errors: PlaywrightError[];
  duration: number;
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

interface FailedTest {
  title: string;
  file: string;
  errorMessage: string;
  errorType: string;
  stack: string;
  duration: number;
}

interface FailureGroup {
  pattern: string;
  type: string;
  tests: FailedTest[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    file: args.find(a => a.startsWith('--file='))?.split('=')[1] ?? 'test-results/results.json',
  };
}

function classifyError(message: string): string {
  if (!message) return 'unknown';
  if (/timeout/i.test(message)) return 'timeout';
  if (/networkidle|net::|ERR_/i.test(message)) return 'network';
  if (/locator|getBy|nth\(|querySelector/i.test(message)) return 'locator';
  if (/toContain|toEqual|toHave|toBe|expect/i.test(message)) return 'assertion';
  if (/auth|login|storageState|401|403/i.test(message)) return 'auth';
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) return 'connectivity';
  return 'other';
}

function normalizeError(message: string): string {
  return message
    .replace(/\d+ms/g, 'Xms')
    .replace(/\d+s/g, 'Xs')
    .replace(/"[^"]{20,}"/g, '"..."')
    .replace(/\/[^\s]+\.(ts|js):\d+/g, 'FILE:LINE')
    .trim()
    .slice(0, 120);
}

function extractFailures(suites: PlaywrightSuite[], file = ''): FailedTest[] {
  const failures: FailedTest[] = [];
  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) failures.push(...extractFailures(suite.suites, currentFile));
    for (const spec of suite.specs ?? []) {
      const lastResult = spec.results[spec.results.length - 1];
      if (!lastResult) continue;
      if (lastResult.status === 'failed' || lastResult.status === 'timedOut') {
        const err = lastResult.errors[0];
        const msg = err?.message ?? `Status: ${lastResult.status}`;
        failures.push({
          title: spec.fullTitle || spec.title,
          file: currentFile,
          errorMessage: msg,
          errorType: classifyError(msg),
          stack: err?.stack ?? '',
          duration: lastResult.duration,
        });
      }
    }
  }
  return failures;
}

function groupFailures(failures: FailedTest[]): FailureGroup[] {
  const groups = new Map<string, FailedTest[]>();

  for (const failure of failures) {
    // Agrupa por tipo de erro + padrão normalizado
    const key = `${failure.errorType}::${normalizeError(failure.errorMessage)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(failure);
  }

  return Array.from(groups.entries())
    .map(([key, tests]) => ({
      pattern: key.split('::')[1],
      type: key.split('::')[0],
      tests,
    }))
    .sort((a, b) => b.tests.length - a.tests.length);
}

// ─── Análise com Claude ────────────────────────────────────────────────────

async function correlate(groups: FailureGroup[], stats: PlaywrightReport['stats']): Promise<void> {
  const client = new Anthropic();

  const totalFailed = groups.reduce((sum, g) => sum + g.tests.length, 0);

  const systemPrompt = `Você é um engenheiro sênior de QA especializado em diagnóstico de falhas para o projeto OrangeHRM.
O sistema testado é uma demo pública compartilhada (https://opensource-demo.orangehrmlive.com) — sujeita a instabilidade, dados de terceiros e lentidão em horários de pico.

Seu papel é analisar grupos de falhas e determinar:
1. Se os grupos têm uma causa raiz COMUM (problema de infraestrutura, auth, deploy)
2. Ou se são falhas INDEPENDENTES que devem ser investigadas separadamente
3. A prioridade de investigação (o que resolver primeiro)

Categorias de causa raiz que você conhece:
- **Infraestrutura** — demo fora do ar, lento, rate limiting
- **Auth** — storageState expirado, sessão inválida
- **Deploy** — mudança na UI quebrou locators em massa
- **Dados** — outro usuário modificou dados compartilhados
- **Ambiente** — timeout de CI, diferença de fuso horário
- **Código** — bug real introduzido recentemente

Formato da resposta:
## Diagnóstico de Causa Raiz

### Veredicto
[1 parágrafo: existe causa raiz comum? qual é?]

### Grupos analisados
Para cada grupo: tipo, causa provável, confiança (Alta/Média/Baixa), ação recomendada

### Plano de ação
Lista priorizada do que fazer primeiro

### Impacto
Quantos testes seriam corrigidos resolvendo cada causa`;

  const groupsSummary = groups.map((g, i) => {
    const samples = g.tests.slice(0, 3).map(t =>
      `    - "${t.title}" (${t.file})\n      Erro: ${t.errorMessage.slice(0, 100)}`
    ).join('\n');
    return `**Grupo ${i + 1} — Tipo: ${g.type} | ${g.tests.length} teste(s)**
  Padrão de erro: "${g.pattern}"
  Exemplos:
${samples}`;
  }).join('\n\n');

  const userMessage = `Analise estas falhas do relatório Playwright:

**Resumo:** ${stats.unexpected} falha(s) em ${stats.expected + stats.unexpected} testes | Duração: ${(stats.duration / 1000).toFixed(1)}s

**${groups.length} grupo(s) de falha identificado(s) (${totalFailed} testes no total):**

${groupsSummary}`;

  console.log('\n🤖  Correlacionando com Claude Opus 4.6...\n');
  console.log('─'.repeat(60));

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);
    }
  }

  console.log('\n' + '─'.repeat(60) + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { file } = parseArgs();
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    console.error(`❌  Relatório não encontrado: ${filePath}`);
    console.error('   Execute os testes primeiro: npm test');
    process.exit(1);
  }

  const report: PlaywrightReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const { stats } = report;

  console.log('\n🔗  Root Cause Correlator');
  console.log(`📊  ${stats.unexpected} falha(s) | ${stats.expected} passou | ${stats.flaky} flaky\n`);

  if (stats.unexpected === 0) {
    console.log('✅  Nenhuma falha encontrada. Nada a correlacionar.\n');
    return;
  }

  const failures = extractFailures(report.suites);
  const groups = groupFailures(failures);

  console.log(`🗂️  ${groups.length} grupo(s) de falha identificado(s):`);
  groups.forEach((g, i) => {
    console.log(`   ${i + 1}. [${g.type}] ${g.tests.length} teste(s) — "${g.pattern.slice(0, 60)}..."`);
  });

  await correlate(groups, stats);
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
