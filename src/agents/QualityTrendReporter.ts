/**
 * QualityTrendReporter.ts
 *
 * Agente AI que lê múltiplas execuções históricas do Playwright, calcula métricas
 * de qualidade ao longo do tempo e usa Claude para gerar um relatório narrativo
 * com tendências, alertas e recomendações.
 *
 * Uso:
 *   npm run report:trend
 *   npm run report:trend -- --history-dir=test-results/history --output=reports/trend.md
 *
 * Como popular o histórico (adicionar ao CI):
 *   mkdir -p test-results/history
 *   cp test-results/results.json "test-results/history/results-$(date +%Y%m%d-%H%M%S).json"
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PlaywrightStats {
  expected: number;
  unexpected: number;
  skipped: number;
  flaky: number;
  duration: number;
}

interface PlaywrightTestResult {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut';
  errors: { message: string }[];
  duration: number;
}

interface PlaywrightTest {
  fullTitle: string;
  title: string;
  results: PlaywrightTestResult[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightTest[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  stats: PlaywrightStats;
  suites: PlaywrightSuite[];
}

interface RunSnapshot {
  runId: string;
  timestamp: string;
  stats: PlaywrightStats;
  passRate: number;
  failedTests: string[];
  slowestTests: { title: string; duration: number }[];
}

interface TrendMetrics {
  runs: RunSnapshot[];
  mostFailingTests: { title: string; failCount: number; total: number }[];
  avgPassRate: number;
  passRateTrend: 'improving' | 'degrading' | 'stable';
  avgDuration: number;
  durationTrend: 'faster' | 'slower' | 'stable';
  totalFlakyCount: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;
  return {
    historyDir: get('history-dir', 'test-results/history'),
    output: get('output', ''),
  };
}

function collectTests(suites: PlaywrightSuite[], file = ''): PlaywrightTest[] {
  const tests: PlaywrightTest[] = [];
  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) tests.push(...collectTests(suite.suites, currentFile));
    for (const spec of suite.specs ?? []) tests.push(spec);
  }
  return tests;
}

function loadHistory(historyDir: string): RunSnapshot[] {
  const snapshots: RunSnapshot[] = [];

  // Inclui results.json atual como referência se existir
  const sources: { file: string; runId: string }[] = [];

  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.json'))
      .sort();
    files.forEach(f => sources.push({ file: path.join(historyDir, f), runId: f.replace('.json', '') }));
  }

  if (sources.length === 0 && fs.existsSync('test-results/results.json')) {
    sources.push({ file: 'test-results/results.json', runId: 'run-atual' });
  }

  if (sources.length === 0) {
    throw new Error(
      'Nenhum relatório encontrado.\n' +
      '   Execute os testes: npm test\n' +
      `   Adicione histórico em: ${historyDir}/results-YYYYMMDD.json`
    );
  }

  console.log(`📂  Carregando ${sources.length} execução(ões)...`);

  for (const { file, runId } of sources) {
    const report: PlaywrightReport = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const tests = collectTests(report.suites);
    const total = report.stats.expected + report.stats.unexpected;

    const failedTests = tests
      .filter(t => t.results.at(-1)?.status === 'failed' || t.results.at(-1)?.status === 'timedOut')
      .map(t => t.fullTitle || t.title);

    const slowestTests = tests
      .map(t => ({ title: t.fullTitle || t.title, duration: t.results.at(-1)?.duration ?? 0 }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);

    // Extrai timestamp do nome do arquivo (ex: results-20260404-1430.json)
    const tsMatch = runId.match(/(\d{8})-?(\d{4})?/);
    const timestamp = tsMatch
      ? `${tsMatch[1].slice(0, 4)}-${tsMatch[1].slice(4, 6)}-${tsMatch[1].slice(6, 8)}${tsMatch[2] ? ` ${tsMatch[2].slice(0, 2)}:${tsMatch[2].slice(2)}` : ''}`
      : runId;

    snapshots.push({
      runId,
      timestamp,
      stats: report.stats,
      passRate: total > 0 ? report.stats.expected / total : 1,
      failedTests,
      slowestTests,
    });
  }

  return snapshots;
}

function computeTrends(runs: RunSnapshot[]): TrendMetrics {
  // Testes que mais falharam ao longo das execuções
  const failCounts = new Map<string, number>();
  const testTotals = new Map<string, number>();

  for (const run of runs) {
    for (const t of run.failedTests) {
      failCounts.set(t, (failCounts.get(t) ?? 0) + 1);
      testTotals.set(t, (testTotals.get(t) ?? 0) + 1);
    }
  }

  const mostFailingTests = Array.from(failCounts.entries())
    .map(([title, failCount]) => ({ title, failCount, total: runs.length }))
    .sort((a, b) => b.failCount - a.failCount)
    .slice(0, 10);

  const avgPassRate = runs.reduce((s, r) => s + r.passRate, 0) / runs.length;
  const avgDuration = runs.reduce((s, r) => s + r.stats.duration, 0) / runs.length;
  const totalFlakyCount = runs.reduce((s, r) => s + r.stats.flaky, 0);

  // Tendência: compara primeira metade com segunda metade
  const half = Math.floor(runs.length / 2);
  let passRateTrend: TrendMetrics['passRateTrend'] = 'stable';
  let durationTrend: TrendMetrics['durationTrend'] = 'stable';

  if (runs.length >= 4) {
    const firstHalf = runs.slice(0, half);
    const secondHalf = runs.slice(half);
    const firstPassRate = firstHalf.reduce((s, r) => s + r.passRate, 0) / firstHalf.length;
    const secondPassRate = secondHalf.reduce((s, r) => s + r.passRate, 0) / secondHalf.length;
    const firstDuration = firstHalf.reduce((s, r) => s + r.stats.duration, 0) / firstHalf.length;
    const secondDuration = secondHalf.reduce((s, r) => s + r.stats.duration, 0) / secondHalf.length;

    if (secondPassRate - firstPassRate > 0.05) passRateTrend = 'improving';
    else if (firstPassRate - secondPassRate > 0.05) passRateTrend = 'degrading';

    if (secondDuration - firstDuration > 5000) durationTrend = 'slower';
    else if (firstDuration - secondDuration > 5000) durationTrend = 'faster';
  }

  return { runs, mostFailingTests, avgPassRate, passRateTrend, avgDuration, durationTrend, totalFlakyCount };
}

// ─── Geração do relatório com Claude ──────────────────────────────────────

async function generateReport(metrics: TrendMetrics): Promise<string> {
  const client = new Anthropic();

  const systemPrompt = `Você é um QA Lead sênior responsável por apresentar o status de qualidade para o time e stakeholders.
Gere um relatório de tendências claro, objetivo e acionável em Markdown.

O relatório deve ter:
## Relatório de Qualidade — [período]

### Resumo Executivo
[3-4 frases: estado geral, tendência principal, ponto de atenção]

### Métricas do Período
[tabela ou lista com os números principais]

### Tendências
[o que está melhorando, o que está piorando]

### Testes Problemáticos
[os testes que mais falharam, com interpretação]

### Alertas 🚨
[problemas que precisam de atenção imediata]

### Recomendações
[lista priorizada de ações concretas]

Use emojis para facilitar a leitura. Seja direto — gestores e devs vão ler este relatório.`;

  const runsTable = metrics.runs.map(r => {
    const pct = (r.passRate * 100).toFixed(0);
    const total = r.stats.expected + r.stats.unexpected;
    return `  ${r.timestamp} | ${pct}% (${r.stats.expected}/${total}) | ${r.stats.flaky} flaky | ${(r.stats.duration / 1000).toFixed(0)}s`;
  }).join('\n');

  const failingTable = metrics.mostFailingTests.slice(0, 8).map(t =>
    `  ${t.failCount}/${t.total} execuções falhou: "${t.title}"`
  ).join('\n');

  const trendEmoji = {
    passRate: { improving: '📈', degrading: '📉', stable: '➡️' },
    duration: { faster: '⚡', slower: '🐢', stable: '➡️' },
  };

  const userMessage = `Gere o relatório de qualidade com base nestes dados:

**Período analisado:** ${metrics.runs[0]?.timestamp} → ${metrics.runs.at(-1)?.timestamp}
**Total de execuções analisadas:** ${metrics.runs.length}

**Histórico de execuções:**
  Data | Pass Rate | Flaky | Duração
${runsTable}

**Métricas agregadas:**
- Pass rate médio: ${(metrics.avgPassRate * 100).toFixed(1)}%
- Tendência de qualidade: ${trendEmoji.passRate[metrics.passRateTrend]} ${metrics.passRateTrend}
- Duração média: ${(metrics.avgDuration / 1000).toFixed(0)}s
- Tendência de performance: ${trendEmoji.duration[metrics.durationTrend]} ${metrics.durationTrend}
- Total de ocorrências flaky no período: ${metrics.totalFlakyCount}

**Testes que mais falharam:**
${failingTable || '  Nenhum teste falhou em mais de uma execução.'}`;

  console.log('\n🤖  Gerando relatório com Claude Opus 4.6...\n');

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  let fullText = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);
      fullText += event.delta.text;
    }
  }
  console.log('\n');

  return fullText;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { historyDir, output } = parseArgs();

  console.log('\n📊  Quality Trend Reporter\n');

  const runs = loadHistory(historyDir);
  const metrics = computeTrends(runs);

  console.log(`✅  ${runs.length} execução(ões) carregada(s).`);
  console.log(`   Pass rate médio: ${(metrics.avgPassRate * 100).toFixed(1)}% | Tendência: ${metrics.passRateTrend}\n`);

  const report = await generateReport(metrics);

  if (output) {
    const outputPath = path.resolve(output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, 'utf-8');
    console.log(`✅  Relatório salvo em: ${outputPath}`);
  }

  console.log('═'.repeat(60));
  console.log('✅  Relatório gerado com sucesso.');
  console.log('   Dica: adicione --output=reports/trend.md para salvar o arquivo.');
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
