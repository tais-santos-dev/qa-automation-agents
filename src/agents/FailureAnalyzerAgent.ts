/**
 * FailureAnalyzerAgent.ts
 *
 * AI agent that reads the Playwright JSON report, identifies failures, and uses
 * the Claude API to diagnose each failure and suggest fixes.
 *
 * Usage:
 *   npx ts-node src/agents/FailureAnalyzerAgent.ts
 *   npx ts-node src/agents/FailureAnalyzerAgent.ts --run-tests
 *
 * Flags:
 *   --run-tests   Runs the tests before analyzing (generates a fresh results.json)
 *   --project     Filters by Playwright project (e.g., --project=chromium:unauthenticated)
 */

import Anthropic from '@anthropic-ai/sdk';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── Playwright JSON report types ──────────────────────────────────────────

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
  console.log(`\n▶  Running tests${project ? ` (${project})` : ''}...\n`);
  try {
    execSync(`npx playwright test${projectFlag}`, { stdio: 'inherit' });
  } catch {
    // Playwright returns exit code != 0 when there are failures — this is expected
  }
}

function loadReport(): PlaywrightReport {
  if (!fs.existsSync(RESULTS_PATH)) {
    throw new Error(
      `Report not found at ${RESULTS_PATH}.\n` +
      'Run the tests first with --run-tests or run: npx playwright test'
    );
  }
  return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
}

// ─── Failure extraction ────────────────────────────────────────────────────

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

    // Recurse into sub-suites
    if (suite.suites?.length) {
      failures.push(...extractFailures(suite.suites, currentFile));
    }

    // Leaf specs (tests)
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

// ─── Claude analysis ───────────────────────────────────────────────────────

const FAILURE_ANALYZER_SYSTEM_PROMPT = `You are a senior QA engineer specialized in Playwright and TypeScript.
The project is a test automation suite for OrangeHRM (https://opensource-demo.orangehrmlive.com).

Project architecture:
- Page Object Model with BasePage and BaseComponent as base classes
- Custom Playwright fixtures (loginPage, pimPage, addEmployeePage, sidebar, topbar)
- Constants in enums: AppRoute, ErrorMessage, SuccessMessage, SidebarMenu
- Auth stored in auth/admin-storage-state.json via global-setup.ts
- Test timeout: 45s | Assertion timeout: 10s | CI retries: 2

For each failure, provide:
1. **Type** — classify: broken locator / timeout / assertion / auth / race condition / other
2. **Root cause** — objective explanation in 1-2 sentences
3. **File and line** — where to fix (if identifiable from the stack)
4. **Fix** — before/after code ready to apply
5. **Prevention** — how to avoid recurrence

Be direct and specific. Do not repeat the full stack trace in the response.` as const;

async function analyzeFailures(client: Anthropic, failures: FailedTest[]): Promise<void> {
  for (let i = 0; i < failures.length; i++) {
    const failure = failures[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`❌  [${i + 1}/${failures.length}] ${failure.title}`);
    console.log(`📁  ${failure.file}`);
    console.log(`${'─'.repeat(60)}\n`);

    const userMessage = `Analyze this Playwright test failure:

**Test:** ${failure.title}
**File:** ${failure.file}

**Error:**
${failure.error}

**Stack trace:**
${failure.stack || '(not available)'}`;

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

  console.log('\n🔍  Loading test report...');
  const report = loadReport();

  const { stats } = report;
  console.log(
    `\n📊  Results: ` +
    `✅ ${stats.expected} passed | ` +
    `❌ ${stats.unexpected} failed | ` +
    `⏭  ${stats.skipped} skipped | ` +
    `🔁 ${stats.flaky} flaky`
  );

  const failures = extractFailures(report.suites);

  if (failures.length === 0) {
    console.log('\n✅  No failures found. All tests passed!\n');
    return;
  }

  console.log(`\n🤖  Analyzing ${failures.length} failure(s) with Claude...\n`);
  const client = new Anthropic();
  await analyzeFailures(client, failures);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Analysis complete. ${failures.length} failure(s) diagnosed.`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
