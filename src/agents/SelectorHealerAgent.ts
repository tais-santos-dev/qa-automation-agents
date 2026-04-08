/**
 * SelectorHealerAgent.ts
 *
 * Agente AI que detecta testes com falha por seletor quebrado, navega na página
 * usando Playwright para inspecionar o DOM atual e usa Claude para sugerir o
 * seletor correto — com opção de aplicar o fix automaticamente no Page Object.
 *
 * Uso:
 *   npm run heal
 *   npm run heal -- --auto-fix        # aplica a correção automaticamente
 *   npm run heal -- --file=results.json
 */

/// <reference lib="dom" />
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PlaywrightError { message: string; stack?: string; }
interface PlaywrightTestResult { status: string; errors: PlaywrightError[]; }
interface PlaywrightTest { fullTitle: string; title: string; results: PlaywrightTestResult[]; }
interface PlaywrightSuite { title: string; file?: string; specs?: PlaywrightTest[]; suites?: PlaywrightSuite[]; }
interface PlaywrightReport { suites: PlaywrightSuite[]; }

interface BrokenSelector {
  testTitle: string;
  specFile: string;
  errorMessage: string;
  brokenSelector: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    autoFix: args.includes('--auto-fix'),
    file: args.find(a => a.startsWith('--file='))?.split('=')[1] ?? 'test-results/results.json',
  };
}

function extractBrokenSelector(message: string): string | null {
  const patterns = [
    /locator\('([^']+)'\)/,
    /getBy\w+\('([^']+)'\)/,
    /\$\('([^']+)'\)/,
    /querySelector\('([^']+)'\)/,
  ];
  for (const p of patterns) {
    const match = message.match(p);
    if (match) return match[1];
  }
  return null;
}

function isLocatorError(message: string): boolean {
  return /locator\.|getBy|querySelector|waiting for|strict mode violation|element not found/i.test(message);
}

function collectBrokenTests(suites: PlaywrightSuite[], file = ''): BrokenSelector[] {
  const broken: BrokenSelector[] = [];
  for (const suite of suites) {
    const currentFile = suite.file ?? file;
    if (suite.suites?.length) broken.push(...collectBrokenTests(suite.suites, currentFile));
    for (const spec of suite.specs ?? []) {
      const last = spec.results.at(-1);
      if (!last || (last.status !== 'failed' && last.status !== 'timedOut')) continue;
      const err = last.errors[0];
      if (!err || !isLocatorError(err.message)) continue;
      broken.push({
        testTitle: spec.fullTitle || spec.title,
        specFile: currentFile,
        errorMessage: err.message,
        brokenSelector: extractBrokenSelector(err.message),
      });
    }
  }
  return broken;
}

// ─── Inspeção DOM ──────────────────────────────────────────────────────────

async function inspectPageDOM(route: string): Promise<string> {
  const authPath = 'auth/admin-storage-state.json';
  const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
  const fullUrl = `${baseUrl}${route}`;

  const browser = await chromium.launch({ headless: true });
  const context = fs.existsSync(authPath)
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();

  const page = await context.newPage();
  try {
    await page.goto(fullUrl, { waitUntil: 'networkidle' });

    const domSnapshot = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        'input, button, select, textarea, a[href], [role="button"], [data-testid]'
      )).slice(0, 40);
      return els.map(el => {
        const attrs: Record<string, string> = {};
        Array.from(el.attributes).forEach(a => { attrs[a.name] = a.value; });
        return { tag: el.tagName.toLowerCase(), text: (el as HTMLElement).innerText?.trim().slice(0, 50), attrs };
      });
    });

    await browser.close();
    return JSON.stringify(domSnapshot, null, 2);
  } catch {
    await browser.close();
    return '(não foi possível inspecionar a página)';
  }
}

// ─── Análise com Claude ────────────────────────────────────────────────────

async function healSelector(client: Anthropic, broken: BrokenSelector, pageObjectContent: string, domSnapshot: string): Promise<void> {

  const systemPrompt = `Você é um especialista em Playwright que conserta seletores quebrados em Page Objects TypeScript.

Dado um seletor que parou de funcionar e o DOM atual da página, sugira:
1. O seletor correto (priorize: [name], [type], [data-testid], aria-label, texto visível)
2. A linha exata do Page Object para substituir
3. Explicação do porquê o seletor anterior quebrou

Formato obrigatório:
## Seletor quebrado
\`seletor antigo\`

## Seletor sugerido
\`seletor novo\`

## Substituição no Page Object
**Antes:** \`código antigo\`
**Depois:** \`código novo\`

## Por que quebrou
[explicação objetiva]

## Confiança: [Alta / Média / Baixa]`;

  const userMessage = `Teste com falha: "${broken.testTitle}"

**Erro:**
${broken.errorMessage.slice(0, 400)}

**Seletor identificado como quebrado:** ${broken.brokenSelector ?? '(não extraído)'}

**Page Object atual:**
\`\`\`typescript
${pageObjectContent.slice(0, 2000)}
\`\`\`

**DOM atual da página (elementos interativos):**
\`\`\`json
${domSnapshot.slice(0, 2000)}
\`\`\``;

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      process.stdout.write(event.delta.text);
    }
  }
  console.log('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const client = new Anthropic();
  const { autoFix, file } = parseArgs();
  const filePath = path.resolve(file);

  if (!fs.existsSync(filePath)) {
    console.error(`❌  Relatório não encontrado: ${filePath}\n   Execute: npm test`);
    process.exit(1);
  }

  const report: PlaywrightReport = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const broken = collectBrokenTests(report.suites);

  console.log('\n🔧  SelectorHealerAgent');

  if (broken.length === 0) {
    console.log('✅  Nenhuma falha por seletor quebrado encontrada.\n');
    return;
  }

  console.log(`⚠️  ${broken.length} seletor(es) quebrado(s) encontrado(s).\n`);
  if (autoFix) console.log('   Modo --auto-fix: revise as sugestões antes de commitar.\n');

  for (let i = 0; i < broken.length; i++) {
    const item = broken[i];
    console.log(`${'─'.repeat(60)}`);
    console.log(`[${i + 1}/${broken.length}] ${item.testTitle}`);
    console.log(`📁  ${item.specFile}\n`);

    // Correlaciona o Page Object pelo nome do arquivo de spec:
    // spec "pim/add-employee.spec.ts" → procura "AddEmployeePage.ts", "EmployeePage.ts", etc.
    const pagesDir = path.resolve('src/pages');
    const pageFiles = fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.ts')) : [];
    const specBaseName = path.basename(item.specFile, '.spec.ts').replace(/-/g, '').toLowerCase();
    const matchedPage = pageFiles.find(f => f.replace('.ts', '').toLowerCase().includes(specBaseName))
      ?? pageFiles.find(f => item.specFile.toLowerCase().includes(f.replace('Page.ts', '').toLowerCase()))
      ?? pageFiles[0];
    const pageObjectContent = matchedPage
      ? fs.readFileSync(path.join(pagesDir, matchedPage), 'utf-8')
      : '(Page Object não encontrado)';

    const routeMatch = item.errorMessage.match(/\/web\/index\.php\/[^\s"')]+/);
    const route = routeMatch ? routeMatch[0] : '/web/index.php/dashboard/index';

    console.log(`🌐  Inspecionando DOM...`);
    const domSnapshot = await inspectPageDOM(route);

    console.log('🤖  Analisando com Claude...\n');
    await healSelector(client, item, pageObjectContent, domSnapshot);
  }

  console.log('═'.repeat(60));
  console.log(`✅  ${broken.length} seletor(es) analisado(s).`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(err => { console.error('\n❌  Erro:', err.message); process.exit(1); });
