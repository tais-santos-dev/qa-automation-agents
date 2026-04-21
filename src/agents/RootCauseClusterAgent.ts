/**
 * RootCauseClusterAgent.ts
 *
 * AI agent that groups CI failures by error pattern and identifies common root causes.
 * Analyzes multiple Playwright JSON report runs and detects clusters of related failures,
 * prioritizing the most critical ones for the team.
 *
 * Usage:
 *   npm run cluster
 *   npm run cluster -- --history-dir=test-results/history
 *   npm run cluster -- --min-cluster=3
 *
 * Flags:
 *   --history-dir   Directory with results-*.json files (default: test-results/history)
 *   --min-cluster   Minimum failures to form a cluster (default: 2)
 *   --output        Report output file (default: reports/root-cause-clusters.md)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ─────────────────────────────────────────────────────────────────

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
  suites: PlaywrightSuite[];
}

interface FailureRecord {
  testTitle: string;
  file: string;
  errorMessage: string;
  stack: string;
  runId: string;
  duration: number;
}

interface FailureCluster {
  pattern: string;
  failures: FailureRecord[];
  errorSignature: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  return {
    historyDir: get('history-dir', 'test-results/history'),
    minCluster: parseInt(get('min-cluster', '2'), 10),
    output: get('output', 'reports/root-cause-clusters.md'),
  };
}

function extractFailures(suites: PlaywrightSuite[], runId: string, file = ''): FailureRecord[] {
  const records: FailureRecord[] = [];

  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) {
      records.push(...extractFailures(suite.suites, runId, currentFile));
    }
    for (const spec of suite.specs ?? []) {
      for (const result of spec.results) {
        if (result.status === 'failed' || result.status === 'timedOut') {
          const err = result.errors[0];
          records.push({
            testTitle: spec.fullTitle || spec.title,
            file: currentFile,
            errorMessage: err?.message ?? `Status: ${result.status}`,
            stack: err?.stack ?? '',
            runId,
            duration: result.duration,
          });
        }
      }
    }
  }

  return records;
}

function loadAllFailures(historyDir: string): FailureRecord[] {
  const all: FailureRecord[] = [];

  // Try history directory first
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort();
    if (files.length > 0) {
      console.log(`📂  Loading ${files.length} run(s) from ${historyDir}...`);
      for (const file of files) {
        const runId = path.basename(file, '.json');
        const report: PlaywrightReport = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf-8'));
        all.push(...extractFailures(report.suites, runId));
      }
      return all;
    }
  }

  // Fallback: current results.json
  const single = 'test-results/results.json';
  if (fs.existsSync(single)) {
    console.log(`⚠️  Using ${single} (single run). For multi-run analysis, add files to ${historyDir}/`);
    const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
    all.push(...extractFailures(report.suites, 'run-1'));
    return all;
  }

  throw new Error('No report found. Run the tests first: npm test');
}

function normalizeError(message: string): string {
  return message
    .replace(/\d+ms/g, 'Xms')
    .replace(/line \d+/g, 'line N')
    .replace(/column \d+/g, 'column N')
    .replace(/"[^"]{0,50}"/g, '"..."')
    .replace(/\/[^\s]+\.(ts|js)/g, '/file.ts')
    .trim()
    .substring(0, 120);
}

function clusterFailures(failures: FailureRecord[], minCluster: number): FailureCluster[] {
  const clusterMap = new Map<string, FailureRecord[]>();

  for (const failure of failures) {
    const signature = normalizeError(failure.errorMessage);
    if (!clusterMap.has(signature)) clusterMap.set(signature, []);
    clusterMap.get(signature)!.push(failure);
  }

  const clusters: FailureCluster[] = [];
  for (const [signature, records] of clusterMap) {
    if (records.length < minCluster) continue;

    // Identify cluster pattern
    let pattern = 'Unknown error';
    const msg = signature.toLowerCase();
    if (msg.includes('timeout')) pattern = 'Timeout';
    else if (msg.includes('locator') || msg.includes('strict mode') || msg.includes('element')) pattern = 'Locator/Selector';
    else if (msg.includes('expect') || msg.includes('tobevisible') || msg.includes('tohave')) pattern = 'Assertion failed';
    else if (msg.includes('auth') || msg.includes('login') || msg.includes('unauthorized')) pattern = 'Authentication';
    else if (msg.includes('network') || msg.includes('net::')) pattern = 'Network error';
    else if (msg.includes('navigation') || msg.includes('goto')) pattern = 'Navigation';

    clusters.push({ pattern, failures: records, errorSignature: signature });
  }

  return clusters.sort((a, b) => b.failures.length - a.failures.length);
}

// ─── Claude analysis ───────────────────────────────────────────────────────

async function analyzeClusters(clusters: FailureCluster[]): Promise<string> {
  const client = new Anthropic();

  const systemPrompt = `You are a senior QA engineer specialized in Playwright failure analysis.
The project tests OrangeHRM (https://opensource-demo.orangehrmlive.com) — a shared, unstable demo.

For each failure cluster, identify:
1. **Likely root cause** — what is causing this group of failures
2. **Impact** — critical / high / medium / low
3. **Recommended action** — what the team should do first
4. **Fix effort** — estimated hours

Be direct and specific. Prioritize by criticality and frequency.`;

  const userMessage = `Analyze these Playwright CI failure clusters:

${clusters.map((c, i) => `## Cluster ${i + 1}: ${c.pattern} (${c.failures.length} occurrences)
**Error signature:** ${c.errorSignature}
**Affected tests:**
${[...new Set(c.failures.map(f => f.testTitle))].slice(0, 5).map(t => `  - ${t}`).join('\n')}
**Files:** ${[...new Set(c.failures.map(f => f.file))].join(', ')}
**Affected runs:** ${[...new Set(c.failures.map(f => f.runId))].join(', ')}
`).join('\n')}

Provide root cause analysis and action plan for each cluster.`;

  console.log('\n🤖  Claude analyzing failure clusters...\n');

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

function saveReport(clusters: FailureCluster[], analysis: string, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const report = `# Root Cause Cluster Report
Generated at: ${new Date().toISOString()}
Total clusters: **${clusters.length}** | Total grouped failures: **${clusters.reduce((s, c) => s + c.failures.length, 0)}**

## Cluster Summary

| # | Pattern | Occurrences | Unique Tests |
|---|---------|-------------|--------------|
${clusters.map((c, i) => `| ${i + 1} | ${c.pattern} | ${c.failures.length} | ${new Set(c.failures.map(f => f.testTitle)).size} |`).join('\n')}

## Claude Analysis

${analysis}

## Raw Cluster Data

${clusters.map((c, i) => `### Cluster ${i + 1}: ${c.pattern}
- **Signature:** \`${c.errorSignature}\`
- **Occurrences:** ${c.failures.length}
- **Affected tests:**
${[...new Set(c.failures.map(f => f.testTitle))].map(t => `  - ${t}`).join('\n')}
`).join('\n')}
`;

  fs.writeFileSync(outputPath, report, 'utf-8');
  console.log(`📋  Report saved: ${outputPath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { historyDir, minCluster, output } = parseArgs();

  console.log('\n🔍  RootCauseClusterAgent');
  console.log(`   Min. per cluster: ${minCluster} | History: ${historyDir}\n`);

  const failures = loadAllFailures(historyDir);
  console.log(`\n✅  ${failures.length} failure(s) loaded from all runs.\n`);

  if (failures.length === 0) {
    console.log('✅  No failures found in the reports.\n');
    return;
  }

  const clusters = clusterFailures(failures, minCluster);

  if (clusters.length === 0) {
    console.log(`⚠️  No cluster with ${minCluster}+ failures. Try --min-cluster=1\n`);
    return;
  }

  console.log(`📊  ${clusters.length} cluster(s) identified:\n`);
  clusters.forEach((c, i) => {
    console.log(`   ${i + 1}. [${c.pattern}] ${c.failures.length} failures — "${c.errorSignature.substring(0, 60)}..."`);
  });

  const analysis = await analyzeClusters(clusters);
  saveReport(clusters, analysis, output);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Analysis complete. ${clusters.length} cluster(s) diagnosed.`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
