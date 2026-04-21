/**
 * QualityTrendReporterAgent.ts
 *
 * AI agent that analyzes quality trends over time.
 * Reads multiple test runs, calculates per-run metrics, and uses Claude
 * to generate a trend report with insights for the team.
 *
 * Usage:
 *   npm run trend
 *   npm run trend -- --history-dir=test-results/history --days=14
 *   npm run trend -- --output=reports/weekly-quality.md
 *
 * Flags:
 *   --history-dir   Directory with results-*.json files (default: test-results/history)
 *   --output        Report output file (default: reports/quality-trend.md)
 *   --days          Analysis window in days (default: 7)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ─────────────────────────────────────────────────────────────────

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
  // Try to extract timestamp from name: results-1712345678.json or results-2024-04-05T...json
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
    // Fallback: current results.json
    const single = 'test-results/results.json';
    if (!fs.existsSync(single)) {
      throw new Error('No report found. Run the tests: npm test');
    }
    console.log(`⚠️  Using ${single} (single run). Add history to ${historyDir}/ for real trends.`);
    const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
    const total = report.stats.expected + report.stats.unexpected + report.stats.skipped;
    return [{
      runId: 'current-run',
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

  console.log(`📂  Loading ${files.length} run(s) from ${historyDir}...`);

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
  const header = '| Run | Date | Total | ✅ Passed | ❌ Failed | 🔁 Flaky | Rate | Duration |';
  const separator = '|-----|------|-------|----------|----------|---------|------|----------|';
  const rows = metrics.map(m => {
    const date = m.timestamp.toLocaleDateString('en-US');
    const duration = `${(m.durationMs / 1000).toFixed(0)}s`;
    return `| ${m.runId.substring(0, 20)} | ${date} | ${m.total} | ${m.passed} | ${m.failed} | ${m.flaky} | ${m.passRate}% | ${duration} |`;
  });
  return [header, separator, ...rows].join('\n');
}

// ─── Claude analysis ───────────────────────────────────────────────────────

async function generateTrendAnalysis(metrics: RunMetrics[]): Promise<string> {
  const client = new Anthropic();

  const systemPrompt = `You are a QA Lead analyzing quality trends for a development team.
The project tests OrangeHRM in a shared demo environment.

Provide a trend report with:
1. **Executive summary** — 2-3 sentences on the overall quality state
2. **Stability trend** — is it improving, worsening, or stable?
3. **Critical alerts** — if there is deterioration, flag it
4. **Positive points** — what is working well
5. **Recommendations** — 3 concrete actions for the next sprint
6. **Key metrics** — average pass rate, worst run, best run

Be objective and direct. Use concrete data to support statements.`;

  const metricsText = metrics.map(m =>
    `Run ${m.runId} (${m.timestamp.toLocaleDateString('en-US')}): ${m.passed} passed, ${m.failed} failed, ${m.flaky} flaky — rate: ${m.passRate}%${m.topErrors.length ? ` — errors: [${m.topErrors[0]?.substring(0, 80)}]` : ''}`
  ).join('\n');

  const avgPassRate = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.passRate, 0) / metrics.length)
    : 0;

  const trend = metrics.length > 1
    ? metrics[metrics.length - 1].passRate > metrics[0].passRate ? '📈 Improving' : '📉 Degrading'
    : 'Single run';

  const userMessage = `Analyze the quality trends for the last ${metrics.length} runs:

**Period:** ${metrics.length > 0 ? metrics[0].timestamp.toLocaleDateString('en-US') : 'N/A'} → ${metrics.length > 0 ? metrics[metrics.length - 1].timestamp.toLocaleDateString('en-US') : 'N/A'}
**Average success rate:** ${avgPassRate}%
**Direction:** ${trend}

**Data per run:**
${metricsText}

Generate an executive trend report for the team.`;

  console.log('\n🤖  Claude generating trend report...\n');

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

  const report = `# Quality Trend Report
Generated at: ${new Date().toISOString()}
Runs analyzed: **${metrics.length}** | Average success rate: **${avgPassRate}%**

## Trend Table

${buildTrendTable(metrics)}

## Claude Analysis

${analysis}

---
*Generated by QualityTrendReporterAgent — next recommended run in 7 days*
`;

  fs.writeFileSync(outputPath, report, 'utf-8');
  console.log(`📋  Report saved: ${outputPath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { historyDir, output, days } = parseArgs();

  console.log('\n📊  QualityTrendReporterAgent');
  console.log(`   Window: ${days} days | History: ${historyDir}\n`);

  const metrics = loadMetrics(historyDir, days);

  if (metrics.length === 0) {
    console.log(`⚠️  No runs found in the last ${days} days.\n`);
    return;
  }

  const avgPassRate = Math.round(metrics.reduce((s, m) => s + m.passRate, 0) / metrics.length);
  const totalFailed = metrics.reduce((s, m) => s + m.failed, 0);

  console.log(`✅  ${metrics.length} run(s) loaded`);
  console.log(`   Average success rate: ${avgPassRate}%`);
  console.log(`   Total failures in period: ${totalFailed}\n`);

  const analysis = await generateTrendAnalysis(metrics);
  saveReport(metrics, analysis, output);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Report generated: ${output}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
