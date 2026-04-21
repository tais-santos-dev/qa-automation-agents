/**
 * AIEvaluatorAgent.ts
 *
 * Agent that evaluates the output quality of other agents using
 * LLM-as-Judge with explicit per-criterion rubrics.
 *
 * Each agent has a calibrated rubric with scores 0-10.
 * The "judge" is claude-opus-4-6 evaluating outputs from the other agents.
 * Outputs with score < 7 are flagged for human review.
 *
 * Usage:
 *   npm run eval -- --agent=failure-analyzer --input=reports/last-analysis.md
 *   npm run eval -- --agent=test-reviewer --input=src/tests/smoke/auth/login.spec.ts
 *   npm run eval:all   # evaluates all agents with their golden datasets
 *
 * Flags:
 *   --agent   Name of the agent to evaluate (required)
 *   --input   File with the agent output to evaluate
 *   --save    Saves result to reports/eval-[agent]-[timestamp].json
 *
 * Supported agents:
 *   failure-analyzer | flaky-detector | test-reviewer |
 *   coverage-advisor | selector-healer | test-generator
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ─────────────────────────────────────────────────────────────────

interface Criterion {
  name: string;
  description: string;
  weight: number; // 1-3 (relative importance)
  rubric: Record<number, string>; // score → description
}

interface Rubric {
  agent: string;
  description: string;
  criteria: Criterion[];
  passIf: number; // minimum weighted score (0-10)
}

interface CriterionResult {
  name: string;
  score: number;
  weight: number;
  justification: string;
}

interface EvaluationResult {
  agent: string;
  timestamp: string;
  finalScore: number;
  passed: boolean;
  criteria: CriterionResult[];
  summary: string;
  recommendations: string[];
}

// ─── Rubrics per Agent ─────────────────────────────────────────────────────

const RUBRICS: Record<string, Rubric> = {
  'failure-analyzer': {
    agent: 'FailureAnalyzerAgent',
    description: 'Evaluates whether the failure diagnosis is accurate, actionable, and correct',
    passIf: 7,
    criteria: [
      {
        name: 'Failure type classification',
        description: 'Correctly identified the type (locator/timeout/assertion/auth/race condition)',
        weight: 2,
        rubric: {
          0: 'Did not classify or classified completely wrong',
          1: 'Classified vaguely without specifying the type',
          2: 'Correctly classified with evidence from the error text',
        },
      },
      {
        name: 'File and line reference',
        description: 'Cited the correct file and ideally the line of the issue',
        weight: 2,
        rubric: {
          0: 'Did not mention any file',
          1: 'Mentioned file but without line or with incorrect line',
          2: 'Correctly cited file and line',
        },
      },
      {
        name: 'Suggested fix is applicable',
        description: 'Before/after code ready to apply, without hallucinations',
        weight: 3,
        rubric: {
          0: 'No fix or incorrect/inapplicable fix',
          1: 'Correct direction but incomplete or too generic code',
          2: 'Partially applicable fix with adjustments',
          3: 'Precise before/after code, ready to apply',
        },
      },
      {
        name: 'Absence of hallucination',
        description: 'All cited methods, files, and classes exist in the project',
        weight: 3,
        rubric: {
          0: 'Invented methods, files, or classes that do not exist',
          1: 'Cited unverifiable elements (may or may not exist)',
          2: 'Cited elements are plausible for the project',
          3: 'All cited elements exist and are correct',
        },
      },
    ],
  },

  'test-reviewer': {
    agent: 'test-reviewer',
    description: 'Evaluates whether the spec review identifies real issues without false positives',
    passIf: 7,
    criteria: [
      {
        name: 'Checklist coverage',
        description: 'Verified structure, imports, tags, assertions, and anti-patterns',
        weight: 2,
        rubric: {
          0: 'Checked fewer than 2 checklist dimensions',
          1: 'Checked 3-4 dimensions superficially',
          2: 'Checked all dimensions with concrete examples',
        },
      },
      {
        name: 'Accuracy of identified issues',
        description: 'Identified issues are real, not false positives',
        weight: 3,
        rubric: {
          0: 'Most issues are false positives or invalid',
          1: 'Mix of real issues and false positives',
          2: 'Most issues are valid',
          3: 'All issues are valid and relevant',
        },
      },
      {
        name: 'Justified verdict',
        description: 'Final verdict (APPROVED/BLOCKED) aligns with the issues found',
        weight: 2,
        rubric: {
          0: 'Verdict contradicts the found issues',
          1: 'Correct verdict but without clear justification',
          2: 'Correct and well-justified verdict',
        },
      },
      {
        name: 'Actionability',
        description: 'The developer knows exactly what to fix',
        weight: 3,
        rubric: {
          0: 'Vague feedback, unclear what to do',
          1: 'Feedback with direction but no code or example',
          2: 'Feedback with partial example',
          3: 'Feedback with exact code to fix',
        },
      },
    ],
  },

  'coverage-advisor': {
    agent: 'coverage-advisor',
    description: 'Evaluates whether the coverage analysis is accurate and priorities make sense',
    passIf: 6,
    criteria: [
      {
        name: 'Correct module mapping',
        description: 'Correctly identified covered and uncovered modules',
        weight: 3,
        rubric: {
          0: 'Incorrect or incomplete mapping',
          1: 'Partial mapping with evident gaps',
          2: 'Correct mapping of main modules',
          3: 'Complete and accurate mapping with evidence',
        },
      },
      {
        name: 'Business risk prioritization',
        description: 'Prioritized modules by real business impact, not by ease',
        weight: 3,
        rubric: {
          0: 'Random or technical-ease prioritization',
          1: 'Prioritization with some business logic',
          2: 'Clear risk-based prioritization with justification',
          3: 'Detailed prioritization with explicit risk criteria',
        },
      },
      {
        name: 'Specific recommendations',
        description: 'Next steps are specific, not generic',
        weight: 2,
        rubric: {
          0: '"Add more tests" — too generic',
          1: 'Specifies modules but not flows',
          2: 'Specifies modules and priority flows',
        },
      },
      {
        name: 'No coverage invention',
        description: 'Did not claim tests exist when they do not',
        weight: 2,
        rubric: {
          0: 'Claimed non-existent coverage',
          1: 'Uncertain about some module coverage',
          2: 'Accurate about what exists and what does not',
        },
      },
    ],
  },

  'selector-healer': {
    agent: 'SelectorHealerAgent',
    description: 'Evaluates whether the suggested selectors are stable and correct',
    passIf: 7,
    criteria: [
      {
        name: 'Stability of suggested selector',
        description: 'Prioritizes [name], [data-testid], aria over generated CSS classes',
        weight: 3,
        rubric: {
          0: 'Suggested position-based or fragile generated-class selector',
          1: 'Functional selector but not the most stable possible',
          2: 'Stable selector with correct priority',
          3: 'Optimal selector with stability justification',
        },
      },
      {
        name: 'Explanation of why it broke',
        description: 'Explained why the previous selector stopped working',
        weight: 2,
        rubric: {
          0: 'No explanation',
          1: 'Vague explanation',
          2: 'Precise and educational explanation',
        },
      },
      {
        name: 'Ready replacement code',
        description: 'Provided before/after code ready to apply in the Page Object',
        weight: 3,
        rubric: {
          0: 'No replacement code',
          1: 'Incomplete or syntactically incorrect code',
          2: 'Correct code but requires adaptation',
          3: 'Exact code, ready to copy and paste',
        },
      },
      {
        name: 'Calibrated confidence level',
        description: 'The declared confidence (High/Medium/Low) reflects real evidence',
        weight: 2,
        rubric: {
          0: 'High confidence without sufficient evidence',
          1: 'Reasonable confidence but could be more precise',
          2: 'Well-calibrated confidence with available DOM',
        },
      },
    ],
  },

  'test-generator': {
    agent: 'TestGeneratorAgent',
    description: 'Evaluates whether the generated Page Object and spec follow project standards',
    passIf: 7,
    criteria: [
      {
        name: 'Page Object standards',
        description: 'Extends BasePage, private/protected locators, verb-named methods',
        weight: 3,
        rubric: {
          0: 'Follows no project standards',
          1: 'Follows some standards with important violations',
          2: 'Follows most standards',
          3: 'Follows all standards with semantic selectors',
        },
      },
      {
        name: 'Test scenario quality',
        description: 'Covers positive, negative, and edge cases with real assertions',
        weight: 3,
        rubric: {
          0: 'Only happy path or no real assertions',
          1: 'Positive and some superficial negatives',
          2: 'Good coverage with verifiable assertions',
          3: 'Complete coverage with explicit arrange/act/assert',
        },
      },
      {
        name: 'Zero magic strings',
        description: 'Uses constants/ enums instead of hardcoded strings',
        weight: 2,
        rubric: {
          0: 'Full of hardcoded strings',
          1: 'Some hardcoded strings, most in enums',
          2: 'All values in enums or named variables',
        },
      },
      {
        name: 'Correct test name format',
        description: 'should [verb] [outcome], correct tags, describe structure',
        weight: 2,
        rubric: {
          0: 'Names not following the standard format',
          1: 'Most follow the pattern but inconsistently',
          2: 'All in correct format with tags and structure',
        },
      },
    ],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = '') =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  const agent = get('agent');
  if (!agent) {
    console.error('❌  Required flag: --agent=name');
    console.error(`   Available agents: ${Object.keys(RUBRICS).join(' | ')}`);
    process.exit(1);
  }

  return {
    agent,
    inputFile: get('input'),
    save: args.includes('--save'),
  };
}

function calculateWeightedScore(criteria: CriterionResult[]): number {
  const totalWeight = criteria.reduce((s, c) => s + c.weight, 0);
  const weightedScore = criteria.reduce((s, c) => {
    const rubric = RUBRICS[Object.keys(RUBRICS)[0]].criteria.find(r => r.name === c.name);
    const maxScore = rubric ? Math.max(...Object.keys(rubric.rubric).map(Number)) : 3;
    return s + (c.score / maxScore) * c.weight;
  }, 0);
  return Math.round((weightedScore / totalWeight) * 10 * 10) / 10;
}

function loadInput(inputFile: string, agent: string): string {
  if (inputFile && fs.existsSync(inputFile)) {
    return fs.readFileSync(inputFile, 'utf-8');
  }

  // Try to find the latest generated report
  const reportDir = 'reports';
  if (fs.existsSync(reportDir)) {
    const files = fs.readdirSync(reportDir)
      .filter(f => f.includes(agent.replace('-', '')) && f.endsWith('.md'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const found = path.join(reportDir, files[0]);
      console.log(`📂  Using most recent report: ${found}`);
      return fs.readFileSync(found, 'utf-8');
    }
  }

  throw new Error(
    `No input found. Use --input=path/to/output.md\n` +
    `   Or generate first: npm run ${agent === 'failure-analyzer' ? 'analyze' : agent}`
  );
}

// ─── Claude evaluation ─────────────────────────────────────────────────────

async function evaluateOutput(
  rubric: Rubric,
  agentOutput: string
): Promise<EvaluationResult> {
  const client = new Anthropic();

  const systemPrompt = `You are an expert evaluator of AI agent output quality.
Your role is to evaluate outputs objectively, impartially, and in a calibrated way.

FUNDAMENTAL RULES:
- Evaluate ONLY the provided output, not what you would expect
- Be precise with scores — do not inflate out of politeness
- If you don't have enough evidence to evaluate a criterion, score = 1
- Respond EXACTLY in the specified JSON format

RESPONSE FORMAT (pure JSON, no markdown):
{
  "criteria": [
    {
      "name": "exact criterion name",
      "score": number,
      "justification": "specific evidence from the output that justifies the score"
    }
  ],
  "summary": "2-3 sentences on the overall output quality",
  "recommendations": ["specific recommendation 1", "recommendation 2"]
}`;

  const criteriaText = rubric.criteria.map(c => `
### ${c.name} (weight: ${c.weight})
${c.description}
Possible scores:
${Object.entries(c.rubric).map(([s, d]) => `  ${s}: ${d}`).join('\n')}`).join('\n');

  const userMessage = `Evaluate the output of agent "${rubric.agent}":

## Evaluation criteria:
${criteriaText}

## Agent output to evaluate:
${agentOutput.substring(0, 6000)}

Evaluate each criterion with precision. Cite specific excerpts from the output as evidence.`;

  console.log(`\n🤖  Claude evaluating output of ${rubric.agent}...\n`);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '{}';

  let parsed: { criteria: CriterionResult[]; summary: string; recommendations: string[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try to extract JSON if it comes with markdown
    const match = text.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : { criteria: [], summary: text, recommendations: [] };
  }

  const criteriaWithWeight = parsed.criteria.map(c => {
    const rubricCriterion = rubric.criteria.find(r => r.name === c.name);
    return { ...c, weight: rubricCriterion?.weight ?? 1 };
  });

  const finalScore = calculateWeightedScore(criteriaWithWeight);

  return {
    agent: rubric.agent,
    timestamp: new Date().toISOString(),
    finalScore,
    passed: finalScore >= rubric.passIf,
    criteria: criteriaWithWeight,
    summary: parsed.summary,
    recommendations: parsed.recommendations ?? [],
  };
}

function displayResult(result: EvaluationResult, rubric: Rubric): void {
  const STATUS = result.passed ? '✅ PASSED' : '🚨 FAILED';
  const BAR = '═'.repeat(60);

  console.log(`\n${BAR}`);
  console.log(`  ${STATUS} — ${result.agent}`);
  console.log(`  Score: ${result.finalScore}/10 (minimum: ${rubric.passIf}/10)`);
  console.log(`${BAR}\n`);

  console.log('## Criteria\n');
  for (const c of result.criteria) {
    const rubricCriterion = rubric.criteria.find(r => r.name === c.name);
    const maxScore = rubricCriterion ? Math.max(...Object.keys(rubricCriterion.rubric).map(Number)) : 3;
    const emoji = c.score === maxScore ? '✅' : c.score === 0 ? '🚨' : '⚠️';
    console.log(`${emoji}  **${c.name}** [weight ${c.weight}] — ${c.score}/${maxScore}`);
    console.log(`   ${c.justification}\n`);
  }

  console.log(`## Summary\n${result.summary}\n`);

  if (result.recommendations.length > 0) {
    console.log('## Recommendations to improve the agent');
    result.recommendations.forEach((r, i) => console.log(`${i + 1}. ${r}`));
  }

  console.log(`\n${BAR}\n`);
}

function saveResult(result: EvaluationResult): void {
  const dir = 'reports/evals';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const agentName = result.agent.toLowerCase().replace(/\s/g, '-');
  const filePath = path.join(dir, `eval-${agentName}-${ts}.json`);

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`📋  Result saved: ${filePath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { agent, inputFile, save } = parseArgs();

  const rubric = RUBRICS[agent];
  if (!rubric) {
    console.error(`❌  Unknown agent: "${agent}"`);
    console.error(`   Available: ${Object.keys(RUBRICS).join(' | ')}`);
    process.exit(1);
  }

  console.log(`\n🔬  AIEvaluatorAgent`);
  console.log(`   Evaluating: ${rubric.agent}`);
  console.log(`   Criteria: ${rubric.criteria.length} | Passes if score ≥ ${rubric.passIf}/10\n`);

  let agentOutput: string;
  try {
    agentOutput = loadInput(inputFile, agent);
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`❌  ${error.message}`);
    process.exit(1);
  }

  const result = await evaluateOutput(rubric, agentOutput);
  displayResult(result, rubric);

  if (save) saveResult(result);

  // Exit code for CI integration
  process.exit(result.passed ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
