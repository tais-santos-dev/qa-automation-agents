/**
 * SlackTeamsReporter.ts
 *
 * Agente AI que lê o relatório do Playwright, usa Claude para gerar um resumo
 * em linguagem natural e envia para Slack e/ou Microsoft Teams via webhook.
 *
 * Uso:
 *   npm run notify
 *   npm run notify -- --platform=slack
 *   npm run notify -- --platform=teams
 *   npm run notify -- --platform=both
 *
 * Configuração no .env:
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 *   TEAMS_WEBHOOK_URL=https://xxx.webhook.office.com/webhookb2/...
 *
 * Ideal para chamar no CI após os testes:
 *   - run: npm run notify
 *     env:
 *       SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
 *       ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createRequire } from 'module';

dotenv.config();

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

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const platform = args.find(a => a.startsWith('--platform='))?.split('=')[1] ?? 'both';
  return { platform: platform as 'slack' | 'teams' | 'both' };
}

function collectFailedTests(suites: PlaywrightSuite[], file = ''): string[] {
  const failures: string[] = [];
  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) failures.push(...collectFailedTests(suite.suites, currentFile));
    for (const spec of suite.specs ?? []) {
      const last = spec.results.at(-1);
      if (last?.status === 'failed' || last?.status === 'timedOut') {
        failures.push(spec.fullTitle || spec.title);
      }
    }
  }
  return failures;
}

// ─── Geração do resumo com Claude ─────────────────────────────────────────

async function generateSummary(
  stats: PlaywrightStats,
  failedTests: string[]
): Promise<{ short: string; detailed: string }> {
  const client = new Anthropic();
  const total = stats.expected + stats.unexpected;
  const passRate = total > 0 ? ((stats.expected / total) * 100).toFixed(0) : '100';
  const status = stats.unexpected === 0 ? 'VERDE ✅' : stats.unexpected <= 3 ? 'AMARELO ⚠️' : 'VERMELHO 🔴';

  const systemPrompt = `Você é um QA Lead que reporta resultados de testes para o time via Slack/Teams.
Seu tom é direto, profissional e claro. Use emojis para facilitar a leitura rápida.

Gere DOIS textos separados por "---":
1. Resumo curto (1 linha, máx 120 chars) — para a notificação principal
2. Detalhamento (5-8 linhas) — para o corpo da mensagem

Exemplo de resumo curto:
"✅ Suite de testes passou: 42/42 (100%) em 2m30s — OrangeHRM QA"

Exemplo de detalhamento:
"📊 *Resultado:* 42 passou | 0 falhou | 1 flaky
⏱️ *Duração:* 2m30s
🏷️ *Projeto:* OrangeHRM Playwright Automation
📅 *Data:* 04/04/2026 18:30

✅ Todos os testes de smoke e regressão passaram com sucesso.
Próxima execução agendada para amanhã às 08:00."`;

  const userMessage = `Gere o resumo para esta execução:

Status geral: ${status}
Pass rate: ${passRate}% (${stats.expected} passou / ${stats.unexpected} falhou / ${stats.skipped} pulado)
Flaky: ${stats.flaky}
Duração: ${Math.floor(stats.duration / 60000)}m${Math.floor((stats.duration % 60000) / 1000)}s
${failedTests.length > 0 ? `\nTestes que falharam:\n${failedTests.slice(0, 5).map(t => `- ${t}`).join('\n')}${failedTests.length > 5 ? `\n... e mais ${failedTests.length - 5}` : ''}` : ''}`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content.find(b => b.type === 'text')?.text ?? '';
  const [short, ...rest] = text.split('---');
  return {
    short: short.trim(),
    detailed: rest.join('---').trim() || short.trim(),
  };
}

// ─── Slack ─────────────────────────────────────────────────────────────────

async function sendToSlack(webhookUrl: string, stats: PlaywrightStats, summary: { short: string; detailed: string }) {
  const total = stats.expected + stats.unexpected;
  const passRate = total > 0 ? ((stats.expected / total) * 100).toFixed(0) : '100';
  const color = stats.unexpected === 0 ? '#2eb886' : stats.unexpected <= 3 ? '#daa038' : '#cc0000';

  const payload = {
    text: summary.short,
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: summary.detailed },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `✅ ${stats.expected} passou  |  ❌ ${stats.unexpected} falhou  |  ⏭️ ${stats.skipped} pulado  |  🔁 ${stats.flaky} flaky  |  📈 ${passRate}%`,
              },
            ],
          },
        ],
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack retornou ${response.status}: ${await response.text()}`);
  }
}

// ─── Microsoft Teams ───────────────────────────────────────────────────────

async function sendToTeams(webhookUrl: string, stats: PlaywrightStats, summary: { short: string; detailed: string }) {
  const total = stats.expected + stats.unexpected;
  const passRate = total > 0 ? ((stats.expected / total) * 100).toFixed(0) : '100';
  const themeColor = stats.unexpected === 0 ? '2eb886' : stats.unexpected <= 3 ? 'daa038' : 'cc0000';

  const payload = {
    '@type': 'MessageCard',
    '@context': 'http://schema.org/extensions',
    themeColor,
    summary: summary.short,
    sections: [
      {
        activityTitle: '🎭 OrangeHRM — Resultado dos Testes Playwright',
        activitySubtitle: summary.short,
        facts: [
          { name: '✅ Passou', value: String(stats.expected) },
          { name: '❌ Falhou', value: String(stats.unexpected) },
          { name: '⏭️ Pulado', value: String(stats.skipped) },
          { name: '🔁 Flaky', value: String(stats.flaky) },
          { name: '📈 Pass rate', value: `${passRate}%` },
          { name: '⏱️ Duração', value: `${Math.floor(stats.duration / 60000)}m${Math.floor((stats.duration % 60000) / 1000)}s` },
        ],
        text: summary.detailed,
      },
    ],
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Teams retornou ${response.status}: ${await response.text()}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { platform } = parseArgs();

  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL;

  const useSlack = (platform === 'slack' || platform === 'both') && !!slackUrl;
  const useTeams = (platform === 'teams' || platform === 'both') && !!teamsUrl;

  if (!useSlack && !useTeams) {
    console.warn('\n⚠️  Nenhum webhook configurado.');
    console.warn('   Adicione ao .env:');
    console.warn('   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...');
    console.warn('   TEAMS_WEBHOOK_URL=https://xxx.webhook.office.com/webhookb2/...\n');
    process.exit(0);
  }

  const reportPath = path.resolve('test-results/results.json');
  if (!fs.existsSync(reportPath)) {
    console.error('❌  Relatório não encontrado. Execute os testes primeiro: npm test');
    process.exit(1);
  }

  const report: PlaywrightReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const failedTests = collectFailedTests(report.suites);

  console.log('\n📣  SlackTeamsReporter');
  console.log(`📊  ${report.stats.expected} passou | ${report.stats.unexpected} falhou | ${report.stats.flaky} flaky`);
  console.log('🤖  Gerando resumo com Claude...');

  const summary = await generateSummary(report.stats, failedTests);
  console.log(`\n📝  Resumo: ${summary.short}\n`);

  if (useSlack) {
    try {
      await sendToSlack(slackUrl!, report.stats, summary);
      console.log('✅  Mensagem enviada para o Slack.');
    } catch (err: unknown) {
      console.error('❌  Erro ao enviar para Slack:', err instanceof Error ? err.message : err);
    }
  }

  if (useTeams) {
    try {
      await sendToTeams(teamsUrl!, report.stats, summary);
      console.log('✅  Mensagem enviada para o Microsoft Teams.');
    } catch (err: unknown) {
      console.error('❌  Erro ao enviar para Teams:', err instanceof Error ? err.message : err);
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
