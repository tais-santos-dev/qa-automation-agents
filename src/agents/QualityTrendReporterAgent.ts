/**
 * QualityTrendReporterAgent.ts
 *
 * Agente AI que analisa tendências de qualidade ao longo do tempo.
 * Lê múltiplas execuções de testes, calcula métricas por run e usa Claude
 * para gerar um relatório de tendência com insights para o time.
 *
 * Uso:
 *   npm run trend
 *   npm run trend -- --history-dir=test-results/history --days=14
 *   npm run trend -- --output=reports/weekly-quality.md
 *
 * Flags:
 *   --history-dir   Diretório com arquivos results-*.json (padrão: test-results/history)
 *   --output        Arquivo de saída do relatório (padrão: reports/quality-trend.md)
 *   --days          Janela de análise em dias (padrão: 7)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PlaywrightStats {
  expected: number;
  unexpected: number;
  skipped: number;
  flaky: number;
  duration: number;
}

interface PlaywrightReport {
  stats: PlaywrightStats;
  suites: PlaywrightSuite[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightTest[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightTest {
  title: string;
  fullTitle: string;
  results: Array<{
    status: 'passed' | 'failed' | 'skipped' | 'timedOut';
    duration: number;
    errors: Array<{ message: string }>;
  }>;
}

interface RunMetrics {
  runId: string;
  timestamp: Date;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  passRate: number;
  durationMs: number;
  topErrors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  return {
    historyDir: get('history-dir', 'test-results/history'),
    output: get('output', 'reports/quality-trend.md'),
    days: parseInt(get('days', '7'), 10),
  };
}

function extractTopErrors(suites: PlaywrightSuite[], file = ''): string[] {
  const errors: string[] = [];
  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) errors.push(...extractTopErrors(suite.suites, currentFile));
    for (const spec of suite.specs ?? []) {
      for (const result of spec.results) {
        if (result.status === 'failed' || result.status === 'timedOut') {
          const msg = result.errors[0]?.message ?? result.status;
          errors.push(msg.substring(0, 100));
        }
      }
    }
  }
  return errors;
}

function parseTimestampFromFilename(filename: string): Date {
  // Tenta extrair timestamp do nome: results-1712345678.json ou results-2024-04-05T...json
  const tsMatch = filename.match(/(\d{10,13})/);
  if (tsMatch) {
    const ts = parseInt(tsMatch[1], 10);
    return new Date(ts.toString().length === 10 ? ts * 1000 : ts);
  }
  const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) return new Date(dateMatch[1]);
  return new Date();
}

function loadMetrics(historyDir: string, days: number): RunMetrics[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  if (!fs.existsSync(historyDir)) {
    // Fallback: results.json atual
    const single = 'test-results/results.json';
    if (!fs.existsSync(single)) {
      throw new Error('Nenhum relatório encontrado. Execute os testes: npm test');
    }
    console.log(`⚠️  Usando ${single} (execução única). Adicione histórico em ${historyDir}/ para tendências reais.`);
    const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
    const total = report.stats.expected + report.stats.unexpected + report.stats.skipped;
    return [{
      runId: 'run-atual',
      timestamp: new Date(),
      total,
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
      passRate: total > 0 ? Math.round((report.stats.expected / total) * 100) : 0,
      durationMs: report.stats.duration,
      topErrors: extractTopErrors(report.suites).slice(0, 5),
    }];
  }

  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  console.log(`📂  Carregando ${files.length} execução(ões) de ${historyDir}...`);

  const metrics: RunMetrics[] = [];
  for (const file of files) {
    const timestamp = parseTimestampFromFilename(file);
    if (timestamp < cutoff) continue;

    const report: PlaywrightReport = JSON.parse(
      fs.readFileSync(path.join(historyDir, file), 'utf-8')
    );

    const total = report.stats.expected + report.stats.unexpected + report.stats.skipped;
    metrics.push({
      runId: path.basename(file, '.json'),
      timestamp,
      total,
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      skipped: report.stats.skipped,
      flaky: report.stats.flaky,
      passRate: total > 0 ? Math.round((report.stats.expected / total) * 100) : 0,
      durationMs: report.stats.duration,
      topErrors: extractTopErrors(report.suites).slice(0, 3),
    });
  }

  return metrics.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function buildTrendTable(metrics: RunMetrics[]): string {
  const header = '| Run | Data | Total | ✅ Passou | ❌ Falhou | 🔁 Flaky | Taxa | Duração |';
  const separator = '|-----|------|-------|----------|----------|---------|------|---------|';
  const rows = metrics.map(m => {
    const date = m.timestamp.toLocaleDateString('pt-BR');
    const duration = `${(m.durationMs / 1000).toFixed(0)}s`;
    return `| ${m.runId.substring(0, 20)} | ${date} | ${m.total} | ${m.passed} | ${m.failed} | ${m.flaky} | ${m.passRate}% | ${duration} |`;
  });
  return [header, separator, ...rows].join('\n');
}

// ─── Análise com Claude ────────────────────────────────────────────────────

async function generateTrendAnalysis(metrics: RunMetrics[]): Promise<string> {
  const client = new Anthropic();

  const systemPrompt = `Você é um líder de QA analisando tendências de qualidade para um time de desenvolvimento.
O projeto testa OrangeHRM em ambiente de demo compartilhado.

Forneça um relatório de tendência com:
1. **Resumo executivo** — 2-3 frases sobre o estado geral da qualidade
2. **Tendência de estabilidade** — está melhorando, piorando ou estável?
3. **Alertas críticos** — se houver deterioração, aponte
4. **Pontos positivos** — o que está funcionando bem
5. **Recomendações** — 3 ações concretas para o próximo sprint
6. **Métricas-chave** — passRate médio, pior run, melhor run

Seja objetivo e direto. Use dados concretos para suportar as afirmações.`;

  const metricsText = metrics.map(m =>
    `Run ${m.runId} (${m.timestamp.toLocaleDateString('pt-BR')}): ${m.passed} passaram, ${m.failed} falharam, ${m.flaky} flaky — taxa: ${m.passRate}%${m.topErrors.length ? ` — erros: [${m.topErrors[0]?.substring(0, 80)}]` : ''}`
  ).join('\n');

  const avgPassRate = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.passRate, 0) / metrics.length)
    : 0;

  const trend = metrics.length > 1
    ? metrics[metrics.length - 1].passRate > metrics[0].passRate ? '📈 Melhorando' : '📉 Piorando'
    : 'Execução única';

  const userMessage = `Analise as tendências de qualidade dos últimos ${metrics.length} runs:

**Período:** ${metrics.length > 0 ? metrics[0].timestamp.toLocaleDateString('pt-BR') : 'N/A'} → ${metrics.length > 0 ? metrics[metrics.length - 1].timestamp.toLocaleDateString('pt-BR') : 'N/A'}
**Taxa de sucesso média:** ${avgPassRate}%
**Direção:** ${trend}

**Dados por execução:**
${metricsText}

Gere um relatório de tendência executivo para o time.`;

  console.log('\n🤖  Claude gerando relatório de tendência...\n');

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 2500,
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

function saveReport(metrics: RunMetrics[], analysis: string, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const avgPassRate = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.passRate, 0) / metrics.length)
    : 0;

  const report = `# Relatório de Tendência de Qualidade
Gerado em: ${new Date().toISOString()}
Execuções analisadas: **${metrics.length}** | Taxa média de sucesso: **${avgPassRate}%**

## Tabela de Tendência

${buildTrendTable(metrics)}

## Análise do Claude

${analysis}

---
*Gerado por QualityTrendReporterAgent — próxima execução recomendada em 7 dias*
`;

  fs.writeFileSync(outputPath, report, 'utf-8');
  console.log(`📋  Relatório salvo: ${outputPath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { historyDir, output, days } = parseArgs();

  console.log('\n📊  QualityTrendReporterAgent');
  console.log(`   Janela: ${days} dias | Histórico: ${historyDir}\n`);

  const metrics = loadMetrics(historyDir, days);

  if (metrics.length === 0) {
    console.log(`⚠️  Nenhuma execução encontrada nos últimos ${days} dias.\n`);
    return;
  }

  const avgPassRate = Math.round(metrics.reduce((s, m) => s + m.passRate, 0) / metrics.length);
  const totalFailed = metrics.reduce((s, m) => s + m.failed, 0);

  console.log(`✅  ${metrics.length} execução(ões) carregada(s)`);
  console.log(`   Taxa média de sucesso: ${avgPassRate}%`);
  console.log(`   Total de falhas no período: ${totalFailed}\n`);

  const analysis = await generateTrendAnalysis(metrics);
  saveReport(metrics, analysis, output);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Relatório gerado: ${output}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
