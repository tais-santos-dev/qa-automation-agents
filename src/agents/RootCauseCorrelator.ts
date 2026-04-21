/**
 * RootCauseCorrelator.ts
 *
 * AI agent that groups test failures by pattern and uses Claude to identify
 * whether multiple failures share a common root cause — preventing the team
 * from investigating 8 separate failures when it's actually just 1 problem.
 *
 * Usage:
 *   npm run correlate
 *   npm run correlate -- --file=test-results/results.json
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
    // Group by error type + normalized pattern
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

// ─── Claude analysis ───────────────────────────────────────────────────────

async function correlate(groups: FailureGroup[], stats: PlaywrightReport['stats']): Promise<void> {
  const client = new Anthropic();

  const totalFailed = groups.reduce((sum, g) => sum + g.tests.length, 0);

  const systemPrompt = `You are a senior QA engineer specialized in failure diagnosis for the OrangeHRM project.
The system under test is a public shared demo (https://opensource-demo.orangehrmlive.com) — subject to instability, third-party data, and peak-hour slowness.

Your role is to analyze failure groups and determine:
1. Whether the groups share a COMMON root cause (infrastructure, auth, deploy issue)
2. Or whether they are INDEPENDENT failures that should be investigated separately
3. The investigation priority (what to resolve first)

Root cause categories you know:
- **Infrastructure** — demo down, slow, rate limiting
- **Auth** — storageState expired, invalid session
- **Deploy** — UI change broke locators in bulk
- **Data** — another user modified shared data
- **Environment** — CI timeout, timezone difference
- **Code** — real bug recently introduced

Response format:
## Root Cause Diagnosis

### Verdict
[1 paragraph: is there a common root cause? what is it?]

### Groups analyzed
For each group: type, likely cause, confidence (High/Medium/Low), recommended action

### Action plan
Prioritized list of what to do first

### Impact
How many tests would be fixed by resolving each cause`;

  const groupsSummary = groups.map((g, i) => {
    const samples = g.tests.slice(0, 3).map(t =>
      `    - "${t.title}" (${t.file})\n      Error: ${t.errorMessage.slice(0, 100)}`
    ).join('\n');
    return `**Group ${i + 1} — Type: ${g.type} | ${g.tests.length} test(s)**
  Error pattern: "${g.pattern}"
  Examples:
${samples}`;
  }).join('\n\n');

  const userMessage = `Analyze these failures from the Playwright report:

**Summary:** ${stats.unexpected} failure(s) in ${stats.expected + stats.unexpected} tests | Duration: ${(stats.duration / 1000).toFixed(1)}s

**${groups.length} failure group(s) identified (${totalFailed} tests total):**

${groupsSummary}`;

  console.log('\n🤖  Correlating with Claude Opus 4.6...\n');
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
    console.error(`❌  Report not found: ${filePath}`);
    console.error('   Run the tests first: npm test');
    process.exit(1);
  }

  const report: PlaywrightReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const { stats } = report;

  console.log('\n🔗  Root Cause Correlator');
  console.log(`📊  ${stats.unexpected} failure(s) | ${stats.expected} passed | ${stats.flaky} flaky\n`);

  if (stats.unexpected === 0) {
    console.log('✅  No failures found. Nothing to correlate.\n');
    return;
  }

  const failures = extractFailures(report.suites);
  const groups = groupFailures(failures);

  console.log(`🗂️  ${groups.length} failure group(s) identified:`);
  groups.forEach((g, i) => {
    console.log(`   ${i + 1}. [${g.type}] ${g.tests.length} test(s) — "${g.pattern.slice(0, 60)}..."`);
  });

  await correlate(groups, stats);
}

main().catch(err => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
