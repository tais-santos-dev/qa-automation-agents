/**
 * RootCauseClusterAgent.ts
 *
 * Agente AI que agrupa falhas de CI por padrão de erro e identifica causas raiz comuns.
 * Analisa múltiplas execuções do relatório JSON do Playwright e detecta clusters
 * de falhas relacionadas, priorizando as mais críticas para o time.
 *
 * Uso:
 *   npm run cluster
 *   npm run cluster -- --history-dir=test-results/history
 *   npm run cluster -- --min-cluster=3
 *
 * Flags:
 *   --history-dir   Diretório com arquivos results-*.json (padrão: test-results/history)
 *   --min-cluster   Mínimo de falhas para formar um cluster (padrão: 2)
 *   --output        Arquivo de saída do relatório (padrão: reports/root-cause-clusters.md)
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Tipos ─────────────────────────────────────────────────────────────────

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

  // Tentar diretório de histórico primeiro
  if (fs.existsSync(historyDir)) {
    const files = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).sort();
    if (files.length > 0) {
      console.log(`📂  Carregando ${files.length} execução(ões) de ${historyDir}...`);
      for (const file of files) {
        const runId = path.basename(file, '.json');
        const report: PlaywrightReport = JSON.parse(fs.readFileSync(path.join(historyDir, file), 'utf-8'));
        all.push(...extractFailures(report.suites, runId));
      }
      return all;
    }
  }

  // Fallback: results.json atual
  const single = 'test-results/results.json';
  if (fs.existsSync(single)) {
    console.log(`⚠️  Usando ${single} (execução única). Para análise multi-run, adicione arquivos em ${historyDir}/`);
    const report: PlaywrightReport = JSON.parse(fs.readFileSync(single, 'utf-8'));
    all.push(...extractFailures(report.suites, 'run-1'));
    return all;
  }

  throw new Error('Nenhum relatório encontrado. Execute os testes primeiro: npm test');
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

    // Identificar padrão do cluster
    let pattern = 'Erro desconhecido';
    const msg = signature.toLowerCase();
    if (msg.includes('timeout')) pattern = 'Timeout';
    else if (msg.includes('locator') || msg.includes('strict mode') || msg.includes('element')) pattern = 'Locator/Seletor';
    else if (msg.includes('expect') || msg.includes('tobevisible') || msg.includes('tohave')) pattern = 'Assertion falhou';
    else if (msg.includes('auth') || msg.includes('login') || msg.includes('unauthorized')) pattern = 'Autenticação';
    else if (msg.includes('network') || msg.includes('net::')) pattern = 'Erro de rede';
    else if (msg.includes('navigation') || msg.includes('goto')) pattern = 'Navegação';

    clusters.push({ pattern, failures: records, errorSignature: signature });
  }

  return clusters.sort((a, b) => b.failures.length - a.failures.length);
}

// ─── Análise com Claude ────────────────────────────────────────────────────

async function analyzeClusters(clusters: FailureCluster[]): Promise<string> {
  const client = new Anthropic();

  const systemPrompt = `Você é um engenheiro sênior de QA especializado em análise de falhas Playwright.
O projeto testa OrangeHRM (https://opensource-demo.orangehrmlive.com) — demo compartilhado, instável.

Para cada cluster de falhas, identifique:
1. **Causa raiz provável** — o que está causando esse grupo de falhas
2. **Impacto** — crítico / alto / médio / baixo
3. **Ação recomendada** — o que o time deve fazer primeiro
4. **Esforço de correção** — horas estimadas

Seja direto e específico. Priorize pela criticidade e frequência.`;

  const userMessage = `Analise estes clusters de falhas de CI do Playwright:

${clusters.map((c, i) => `## Cluster ${i + 1}: ${c.pattern} (${c.failures.length} ocorrências)
**Assinatura do erro:** ${c.errorSignature}
**Testes afetados:**
${[...new Set(c.failures.map(f => f.testTitle))].slice(0, 5).map(t => `  - ${t}`).join('\n')}
**Arquivos:** ${[...new Set(c.failures.map(f => f.file))].join(', ')}
**Runs afetados:** ${[...new Set(c.failures.map(f => f.runId))].join(', ')}
`).join('\n')}

Forneça análise de causa raiz e plano de ação para cada cluster.`;

  console.log('\n🤖  Claude analisando clusters de falhas...\n');

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

  const report = `# Relatório de Clusters de Causa Raiz
Gerado em: ${new Date().toISOString()}
Total de clusters: **${clusters.length}** | Total de falhas agrupadas: **${clusters.reduce((s, c) => s + c.failures.length, 0)}**

## Resumo dos Clusters

| # | Padrão | Ocorrências | Testes Únicos |
|---|--------|-------------|---------------|
${clusters.map((c, i) => `| ${i + 1} | ${c.pattern} | ${c.failures.length} | ${new Set(c.failures.map(f => f.testTitle)).size} |`).join('\n')}

## Análise do Claude

${analysis}

## Dados Brutos dos Clusters

${clusters.map((c, i) => `### Cluster ${i + 1}: ${c.pattern}
- **Assinatura:** \`${c.errorSignature}\`
- **Ocorrências:** ${c.failures.length}
- **Testes afetados:**
${[...new Set(c.failures.map(f => f.testTitle))].map(t => `  - ${t}`).join('\n')}
`).join('\n')}
`;

  fs.writeFileSync(outputPath, report, 'utf-8');
  console.log(`📋  Relatório salvo: ${outputPath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { historyDir, minCluster, output } = parseArgs();

  console.log('\n🔍  RootCauseClusterAgent');
  console.log(`   Mín. por cluster: ${minCluster} | Histórico: ${historyDir}\n`);

  const failures = loadAllFailures(historyDir);
  console.log(`\n✅  ${failures.length} falha(s) carregada(s) de todas as execuções.\n`);

  if (failures.length === 0) {
    console.log('✅  Nenhuma falha encontrada nos relatórios.\n');
    return;
  }

  const clusters = clusterFailures(failures, minCluster);

  if (clusters.length === 0) {
    console.log(`⚠️  Nenhum cluster com ${minCluster}+ falhas. Tente --min-cluster=1\n`);
    return;
  }

  console.log(`📊  ${clusters.length} cluster(s) identificado(s):\n`);
  clusters.forEach((c, i) => {
    console.log(`   ${i + 1}. [${c.pattern}] ${c.failures.length} falhas — "${c.errorSignature.substring(0, 60)}..."`);
  });

  const analysis = await analyzeClusters(clusters);
  saveReport(clusters, analysis, output);

  console.log(`${'═'.repeat(60)}`);
  console.log(`✅  Análise concluída. ${clusters.length} cluster(s) diagnosticado(s).`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
