/**
 * FlakyTestDetector.ts
 *
 * Agente AI que detecta testes instáveis (flaky) analisando múltiplas execuções
 * do relatório JSON do Playwright e usa Claude para classificar a causa e sugerir correções.
 *
 * Um teste é considerado flaky se teve resultados inconsistentes entre execuções
 * (passou em algumas e falhou em outras).
 *
 * Uso:
 *   npx ts-node src/agents/FlakyTestDetector.ts
 *   npx ts-node src/agents/FlakyTestDetector.ts --history-dir=test-results/history
 *   npx ts-node src/agents/FlakyTestDetector.ts --min-runs=3
 *
 * Flags:
 *   --history-dir   Diretório com arquivos results-*.json históricos (padrão: test-results/history)
 *   --min-runs      Mínimo de execuções para considerar um teste (padrão: 2)
 *   --threshold     % de falhas para considerar flaky (padrão: 0.2 = 20%)
 *
 * Como popular o histórico:
 *   Após cada execução de CI, copie test-results/results.json para
 *   test-results/history/results-<timestamp>.json
 *   Ex: cp test-results/results.json test-results/history/results-$(date +%s).json
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
  stats: { duration: number };
  suites: PlaywrightSuite[];
}

interface TestRun {
  runId: string;
  status: 'passed' | 'failed' | 'timedOut' | 'skipped';
  duration: number;
  error?: string;
}

interface TestHistory {
  fullTitle: string;
  file: string;
  runs: TestRun[];
}

interface FlakyTest extends TestHistory {
  passRate: number;
  failRate: number;
  totalRuns: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  return {
    historyDir: get('history-dir', 'test-results/history'),
    minRuns: parseInt(get('min-runs', '2'), 10),
    threshold: parseFloat(get('threshold', '0.2')),
  };
}

function collectTestsFromSuites(
  suites: PlaywrightSuite[],
  runId: string,
  file = '',
  acc: Map<string, TestHistory>
): void {
  for (const suite of suites) {
    const currentFile = suite.file ?? file;

    if (suite.suites?.length) {
      collectTestsFromSuites(suite.suites, runId, currentFile, acc);
    }

    for (const spec of suite.specs ?? []) {
      const key = spec.fullTitle || spec.title;

      if (!acc.has(key)) {
        acc.set(key, { fullTitle: key, file: currentFile, runs: [] });
      }

      // Considera o resultado final (última retry ou primeiro resultado)
      const finalResult = spec.results[spec.results.length - 1];
      if (!finalResult) continue;

      acc.get(key)!.runs.push({
        runId,
        status: finalResult.status,
        duration: finalResult.duration,
        error: finalResult.errors[0]?.message,
      });
    }
  }
}

function loadHistory(historyDir: string): Map<string, TestHistory> {
  const acc = new Map<string, TestHistory>();

  if (!fs.existsSync(historyDir)) {
    // Fallback: tenta usar results.json atual como única execução
    const single = 'test-results/results.json';
    if (fs.existsSync(single)) {
      console.log(`⚠️  Diretório de histórico não encontrado. Usando ${single} como referência única.`);
      console.log('   Para detectar flakiness, adicione múltiplos results-*.json em test-results/history/\n');
      const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
      collectTestsFromSuites(report.suites, 'run-1', '', acc);
      return acc;
    }
    throw new Error(
      `Nenhum relatório encontrado. Execute os testes primeiro: npm test\n` +
      `Para análise de histórico, crie: ${historyDir}/results-<timestamp>.json`
    );
  }

  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`Nenhum arquivo .json encontrado em ${historyDir}`);
  }

  console.log(`📂  Carregando ${files.length} execução(ões) de ${historyDir}...`);

  for (const file of files) {
    const runId = path.basename(file, '.json');
    const report: PlaywrightReport = JSON.parse(
      fs.readFileSync(path.join(historyDir, file), 'utf-8')
    );
    collectTestsFromSuites(report.suites, runId, '', acc);
  }

  return acc;
}

function detectFlakyTests(
  history: Map<string, TestHistory>,
  minRuns: number,
  threshold: number
): FlakyTest[] {
  const flaky: FlakyTest[] = [];

  for (const [, test] of history) {
    if (test.runs.length < minRuns) continue;

    const passed = test.runs.filter(r => r.status === 'passed').length;
    const failed = test.runs.filter(r => r.status !== 'passed' && r.status !== 'skipped').length;
    const total = test.runs.filter(r => r.status !== 'skipped').length;

    if (total === 0) continue;

    const failRate = failed / total;
    const passRate = passed / total;

    // Flaky: falhou pelo menos "threshold"% das vezes MAS também passou pelo menos uma vez
    if (failRate >= threshold && failRate < 1.0 && passed > 0) {
      flaky.push({
        ...test,
        passRate,
        failRate,
        totalRuns: total,
        errors: [...new Set(test.runs.map(r => r.error).filter(Boolean) as string[])],
      });
    }
  }

  // Ordena pelos mais instáveis primeiro
  return flaky.sort((a, b) => b.failRate - a.failRate);
}

// ─── Análise com Claude ────────────────────────────────────────────────────

async function analyzeFlakyTests(tests: FlakyTest[]): Promise<void> {
  const client = new Anthropic();

  const systemPrompt = `Você é um engenheiro sênior de QA especializado em estabilidade de testes Playwright + TypeScript.
O projeto é uma automação para OrangeHRM (https://opensource-demo.orangehrmlive.com) — uma instância demo compartilhada.

Contexto do ambiente:
- Demo compartilhado entre usuários do mundo todo → dados podem mudar entre execuções
- CI usa 1 worker (serializado), local usa 2 workers
- Retries em CI: 2 | Timeout por teste: 45s | Timeout por assertion: 10s
- Auth via storageState que pode expirar
- Dados de teste gerados com @faker-js/faker para evitar conflitos

Categorias de flakiness que você conhece:
1. **Race condition** — elemento aparece/desaparece antes do waitFor
2. **Dados compartilhados** — outro usuário ou teste modificou dados no demo
3. **Auth expirada** — storageState venceu ou foi invalidado
4. **Timeout de rede** — demo lento em horários de pico
5. **Seletor frágil** — CSS gerado que muda entre sessões
6. **Dependência de ordem** — teste depende de estado deixado por outro teste
7. **Race condition de animação** — elemento visível mas não interagível

Para cada teste flaky, forneça:
1. **Categoria** — qual tipo de flakiness
2. **Hipótese** — o que provavelmente causa a instabilidade
3. **Correção** — código antes/depois
4. **Nível de confiança** — Alto / Médio / Baixo (baseado nas evidências)`;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const pct = (test.failRate * 100).toFixed(0);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🎲  [${i + 1}/${tests.length}] ${test.fullTitle}`);
    console.log(`📁  ${test.file}`);
    console.log(`📊  ${pct}% de falhas (${Math.round(test.failRate * test.totalRuns)}/${test.totalRuns} execuções)`);
    console.log(`${'─'.repeat(60)}\n`);

    const runsTable = test.runs
      .map(r => `  ${r.runId}: ${r.status} (${(r.duration / 1000).toFixed(1)}s)`)
      .join('\n');

    const errorsSection = test.errors.length > 0
      ? `\n**Erros observados:**\n${test.errors.map(e => `- ${e}`).join('\n')}`
      : '';

    const userMessage = `Analise este teste flaky do Playwright:

**Teste:** ${test.fullTitle}
**Arquivo:** ${test.file}
**Taxa de falha:** ${pct}% (${Math.round(test.failRate * test.totalRuns)} falhas em ${test.totalRuns} execuções)

**Histórico de execuções:**
${runsTable}
${errorsSection}`;

    const stream = client.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
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
  const { historyDir, minRuns, threshold } = parseArgs();

  console.log('\n🔍  Detectando testes flaky...');
  console.log(`   Mín. execuções: ${minRuns} | Threshold de falha: ${(threshold * 100).toFixed(0)}%\n`);

  const history = loadHistory(historyDir);
  console.log(`✅  ${history.size} testes únicos carregados.\n`);

  const flakyTests = detectFlakyTests(history, minRuns, threshold);

  if (flakyTests.length === 0) {
    console.log('✅  Nenhum teste flaky detectado com os critérios atuais.');
    console.log('   Tente reduzir --threshold ou --min-runs para uma análise mais ampla.\n');
    return;
  }

  console.log(`⚠️  ${flakyTests.length} teste(s) flaky detectado(s):\n`);
  flakyTests.forEach((t, i) => {
    const pct = (t.failRate * 100).toFixed(0);
    console.log(`  ${i + 1}. [${pct}% falha] ${t.fullTitle}`);
  });

  console.log(`\n🤖  Analisando com Claude...\n`);
  await analyzeFlakyTests(flakyTests);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  ${flakyTests.length} teste(s) flaky analisado(s).`);
  console.log(`\n💡  Dica: Após corrigir, adicione resultados novos ao histórico`);
  console.log(`    para monitorar se a instabilidade foi resolvida.`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
