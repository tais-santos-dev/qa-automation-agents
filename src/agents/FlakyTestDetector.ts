/**
 * FlakyTestDetector.ts
 *
 * AI agent that detects flaky tests by analyzing multiple Playwright JSON report
 * runs and uses Claude to classify the cause and suggest fixes.
 *
 * A test is considered flaky if it had inconsistent results across runs
 * (passed in some and failed in others).
 *
 * Usage:
 *   npx ts-node src/agents/FlakyTestDetector.ts
 *   npx ts-node src/agents/FlakyTestDetector.ts --history-dir=test-results/history
 *   npx ts-node src/agents/FlakyTestDetector.ts --min-runs=3
 *
 * Flags:
 *   --history-dir   Directory with historical results-*.json files (default: test-results/history)
 *   --min-runs      Minimum number of runs to consider a test (default: 2)
 *   --threshold     Failure % to consider flaky (default: 0.2 = 20%)
 *
 * How to populate history:
 *   After each CI run, copy test-results/results.json to
 *   test-results/history/results-<timestamp>.json
 *   e.g., cp test-results/results.json test-results/history/results-$(date +%s).json
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ─────────────────────────────────────────────────────────────────

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

      // Use the final result (last retry or first result)
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
    // Fallback: try current results.json as a single run
    const single = 'test-results/results.json';
    if (fs.existsSync(single)) {
      console.log(`⚠️  History directory not found. Using ${single} as a single reference.`);
      console.log('   To detect flakiness, add multiple results-*.json files to test-results/history/\n');
      const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
      collectTestsFromSuites(report.suites, 'run-1', '', acc);
      return acc;
    }
    throw new Error(
      `No report found. Run the tests first: npm test\n` +
      `To analyze history, create: ${historyDir}/results-<timestamp>.json`
    );
  }

  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    throw new Error(`No .json files found in ${historyDir}`);
  }

  console.log(`📂  Loading ${files.length} run(s) from ${historyDir}...`);

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

    // Flaky: failed at least "threshold"% of the time BUT also passed at least once
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

  // Sort by most unstable first
  return flaky.sort((a, b) => b.failRate - a.failRate);
}

// ─── Claude analysis ───────────────────────────────────────────────────────

async function analyzeFlakyTests(tests: FlakyTest[]): Promise<void> {
  const client = new Anthropic();

  const systemPrompt = `You are a senior QA engineer specialized in Playwright + TypeScript test stability.
The project is a test automation suite for OrangeHRM (https://opensource-demo.orangehrmlive.com) — a shared demo instance.

Environment context:
- Shared demo used by users worldwide → data may change between runs
- CI uses 1 worker (serialized), local uses 2 workers
- CI retries: 2 | Test timeout: 45s | Assertion timeout: 10s
- Auth via storageState that may expire
- Test data generated with @faker-js/faker to avoid conflicts

Flakiness categories you know:
1. **Race condition** — element appears/disappears before waitFor
2. **Shared data** — another user or test modified data in the demo
3. **Expired auth** — storageState expired or invalidated
4. **Network timeout** — demo slow during peak hours
5. **Fragile selector** — generated CSS that changes between sessions
6. **Order dependency** — test depends on state left by another test
7. **Animation race condition** — element visible but not yet interactable

For each flaky test, provide:
1. **Category** — which type of flakiness
2. **Hypothesis** — what likely causes the instability
3. **Fix** — before/after code
4. **Confidence level** — High / Medium / Low (based on evidence)`;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const pct = (test.failRate * 100).toFixed(0);

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🎲  [${i + 1}/${tests.length}] ${test.fullTitle}`);
    console.log(`📁  ${test.file}`);
    console.log(`📊  ${pct}% failure rate (${Math.round(test.failRate * test.totalRuns)}/${test.totalRuns} runs)`);
    console.log(`${'─'.repeat(60)}\n`);

    const runsTable = test.runs
      .map(r => `  ${r.runId}: ${r.status} (${(r.duration / 1000).toFixed(1)}s)`)
      .join('\n');

    const errorsSection = test.errors.length > 0
      ? `\n**Observed errors:**\n${test.errors.map(e => `- ${e}`).join('\n')}`
      : '';

    const userMessage = `Analyze this flaky Playwright test:

**Test:** ${test.fullTitle}
**File:** ${test.file}
**Failure rate:** ${pct}% (${Math.round(test.failRate * test.totalRuns)} failures in ${test.totalRuns} runs)

**Run history:**
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

  console.log('\n🔍  Detecting flaky tests...');
  console.log(`   Min. runs: ${minRuns} | Failure threshold: ${(threshold * 100).toFixed(0)}%\n`);

  const history = loadHistory(historyDir);
  console.log(`✅  ${history.size} unique tests loaded.\n`);

  const flakyTests = detectFlakyTests(history, minRuns, threshold);

  if (flakyTests.length === 0) {
    console.log('✅  No flaky tests detected with the current criteria.');
    console.log('   Try lowering --threshold or --min-runs for a broader analysis.\n');
    return;
  }

  console.log(`⚠️  ${flakyTests.length} flaky test(s) detected:\n`);
  flakyTests.forEach((t, i) => {
    const pct = (t.failRate * 100).toFixed(0);
    console.log(`  ${i + 1}. [${pct}% failure] ${t.fullTitle}`);
  });

  console.log(`\n🤖  Analyzing with Claude...\n`);
  await analyzeFlakyTests(flakyTests);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  ${flakyTests.length} flaky test(s) analyzed.`);
  console.log(`\n💡  Tip: After fixing, add new results to history`);
  console.log(`    to monitor whether the instability was resolved.`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
