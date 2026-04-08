/**
 * ExploratoryAgent.ts
 *
 * Agente AI que navega autonomamente pelo OrangeHRM a partir de uma rota inicial,
 * descobre sub-rotas, modais e fluxos ocultos, e gera cenários de teste completos
 * sem precisar de input humano além da URL de entrada.
 *
 * Diferente do TestGeneratorAgent (que inspeciona uma página específica),
 * o ExploratoryAgent descobre navegação, tabs, modais e ações secundárias.
 *
 * Uso:
 *   npm run explore -- --url=/web/index.php/leave
 *   npm run explore -- --url=/web/index.php/admin --depth=2
 *
 * Flags:
 *   --url     Rota inicial (obrigatório). Ex: /web/index.php/leave
 *   --depth   Profundidade: 1=página atual + tabs, 2=explora links de navegação (padrão: 1)
 *   --output  Diretório de saída (padrão: src/generated)
 *
 * Pré-requisitos:
 *   - ANTHROPIC_API_KEY no .env
 *   - BASE_URL no .env
 */

/// <reference lib="dom" />
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface PageSnapshot {
  url: string;
  title: string;
  headings: string[];
  inputs: Array<{ name: string; type: string; placeholder: string; selector: string }>;
  buttons: Array<{ text: string; type: string; selector: string }>;
  selects: Array<{ name: string; selector: string }>;
  tables: Array<{ headers: string[]; rowCount: number }>;
  navTabs: Array<{ text: string; href: string }>;
  modals: string[];
  alerts: string[];
}

interface ExplorationResult {
  entryUrl: string;
  module: string;
  snapshots: PageSnapshot[];
  discoveredFlows: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = '') =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  const url = get('url');
  if (!url) {
    console.error('❌  Flag obrigatória: --url=/web/index.php/...');
    process.exit(1);
  }

  return {
    url,
    depth: parseInt(get('depth', '1'), 10),
    outputDir: get('output', 'src/generated'),
    module: inferModule(url),
  };
}

function inferModule(url: string): string {
  const parts = url.split('/').filter(Boolean);
  const idx = parts.indexOf('index.php');
  return idx !== -1 && parts[idx + 1] ? parts[idx + 1] : 'unknown';
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractCodeBlocks(text: string): string[] {
  const regex = /```typescript\s*\n([\s\S]*?)```/g;
  return [...text.matchAll(regex)].map(m => m[1].trim());
}

// ─── Inspeção com Playwright ────────────────────────────────────────────────

async function snapshotPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(() => {
    const toSelector = (el: Element): string => {
      const name = el.getAttribute('name');
      const testid = el.getAttribute('data-testid');
      const type = el.getAttribute('type');
      if (name) return `[name="${name}"]`;
      if (testid) return `[data-testid="${testid}"]`;
      if (type) return `${el.tagName.toLowerCase()}[type="${type}"]`;
      const classes = Array.from(el.classList)
        .filter(c => !c.match(/^(oxd-)/) && c.length > 2)
        .slice(0, 2)
        .join('.');
      return classes ? `.${classes}` : el.tagName.toLowerCase();
    };

    return {
      url: window.location.href,
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,.oxd-text--h5,.oxd-text--h6'))
        .slice(0, 6).map(h => (h as HTMLElement).innerText.trim()).filter(Boolean),
      inputs: Array.from(document.querySelectorAll('input:not([type="hidden"])'))
        .slice(0, 12).map(el => ({
          name: el.getAttribute('name') ?? '',
          type: el.getAttribute('type') ?? 'text',
          placeholder: el.getAttribute('placeholder') ?? '',
          selector: toSelector(el),
        })),
      buttons: Array.from(document.querySelectorAll('button'))
        .slice(0, 10).map(el => ({
          text: (el as HTMLElement).innerText.trim(),
          type: el.getAttribute('type') ?? 'button',
          selector: toSelector(el),
        })),
      selects: Array.from(document.querySelectorAll('select, .oxd-select-wrapper'))
        .slice(0, 8).map(el => ({
          name: el.getAttribute('name') ?? el.className,
          selector: toSelector(el),
        })),
      tables: Array.from(document.querySelectorAll('table, .oxd-table'))
        .slice(0, 3).map(table => ({
          headers: Array.from(table.querySelectorAll('th, .oxd-table-header-cell'))
            .map(th => (th as HTMLElement).innerText.trim()).filter(Boolean),
          rowCount: table.querySelectorAll('tr, .oxd-table-row').length,
        })),
      navTabs: Array.from(document.querySelectorAll('.oxd-topbar-body-nav-tab, .orangehrm-tabs a, nav a'))
        .slice(0, 10).map(el => ({
          text: (el as HTMLElement).innerText.trim(),
          href: el.getAttribute('href') ?? '',
        })).filter(t => t.text),
      modals: Array.from(document.querySelectorAll('.oxd-dialog-container, .oxd-modal'))
        .map(m => (m as HTMLElement).innerText.trim().substring(0, 100)),
      alerts: Array.from(document.querySelectorAll('.oxd-alert, .oxd-toast'))
        .map(a => (a as HTMLElement).innerText.trim()),
    };
  });
}

async function explorePage(baseUrl: string, url: string, depth: number): Promise<PageSnapshot[]> {
  const authPath = 'auth/admin-storage-state.json';
  const hasAuth = fs.existsSync(authPath);
  const fullUrl = `${baseUrl}${url}`;

  console.log(`\n🌐  Abrindo ${fullUrl} (profundidade: ${depth})...`);

  const browser = await chromium.launch({ headless: true });
  const context = hasAuth
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();
  const page = await context.newPage();

  if (!hasAuth) {
    await page.goto(`${baseUrl}/web/index.php/auth/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="username"]', process.env.ADMIN_USER ?? 'Admin');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD ?? 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
  }

  await page.goto(fullUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const snapshots: PageSnapshot[] = [];

  // Snapshot da página principal
  const mainSnapshot = await snapshotPage(page);
  snapshots.push(mainSnapshot);
  console.log(`   ✅  Página principal: ${mainSnapshot.inputs.length} inputs, ${mainSnapshot.buttons.length} botões, ${mainSnapshot.navTabs.length} tabs`);

  // Profundidade 2: explorar tabs de navegação interna
  if (depth >= 2 && mainSnapshot.navTabs.length > 0) {
    const internalTabs = mainSnapshot.navTabs
      .filter(t => t.href && t.href.includes('index.php'))
      .slice(0, 4);

    for (const tab of internalTabs) {
      try {
        const tabUrl = tab.href.startsWith('http') ? tab.href : `${baseUrl}${tab.href}`;
        console.log(`   🔗  Explorando tab: "${tab.text}" → ${tabUrl}`);
        await page.goto(tabUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const tabSnapshot = await snapshotPage(page);
        snapshots.push(tabSnapshot);
        console.log(`      ✅  ${tabSnapshot.inputs.length} inputs, ${tabSnapshot.buttons.length} botões`);
      } catch (err) {
        console.log(`      ⚠️  Erro ao explorar tab "${tab.text}"`);
      }
    }
  }

  await browser.close();
  return snapshots;
}

// ─── Geração com Claude ────────────────────────────────────────────────────

async function generateFromExploration(
  result: ExplorationResult
): Promise<string> {
  const client = new Anthropic();
  const className = `${toPascalCase(result.module)}Page`;

  const systemPrompt = `Você é um especialista em automação de testes Playwright + TypeScript para OrangeHRM.

## Padrões obrigatórios do projeto

### Page Object (extends BasePage)
\`\`\`typescript
import { Page } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { AppRoute } from '../constants/Routes';

export class ${className} extends BasePage {
  private get elemento() { return this.page.locator('[seletor-semantico]'); }
  constructor(page: Page) { super(page); }
  async open(): Promise<void> { await this.navigate(AppRoute.ROTA); }
  async fazerAcao(valor: string): Promise<void> {
    await this.fill(this.elemento, valor);
    await this.click(this.botaoSubmit);
  }
}
\`\`\`

### Spec
- Import: \`import { test, expect } from '../../fixtures/test.fixture';\`
- Nomes em português: \`deve [verbo] [resultado]\`
- Tags: \`{ tag: ['@smoke', '@${result.module}'] }\`
- Comentários: \`// Arrange\`, \`// Act\`, \`// Assert\`
- Estrutura: \`Positivo\`, \`Negativo\`, \`Edge Cases\`

Gere DOIS blocos \`\`\`typescript:
1. Page Object completo com TODOS os fluxos descobertos
2. Spec completo cobrindo todos os cenários identificados`;

  const snapshotText = result.snapshots.map((s, i) => `
### Página ${i + 1}: ${s.title || s.url}
**URL:** ${s.url}
**Headings:** ${s.headings.join(' | ')}
**Inputs:** ${s.inputs.map(inp => `${inp.name}(${inp.type})`).join(', ')}
**Botões:** ${s.buttons.map(b => `"${b.text}"`).join(', ')}
**Selects:** ${s.selects.map(sel => sel.name).join(', ')}
**Tabelas:** ${s.tables.map(t => `[${t.headers.join(', ')}] (${t.rowCount} rows)`).join('; ')}
**Tabs encontradas:** ${s.navTabs.map(t => t.text).join(', ')}
`).join('\n');

  const userMessage = `Gere Page Object e spec completo para o módulo **${result.module}** do OrangeHRM.

**Exploração realizada:**
- Páginas visitadas: ${result.snapshots.length}
- Módulo: ${result.module}
- Classe: ${className}

${snapshotText}

**Fluxos descobertos:** ${result.discoveredFlows.join(', ')}

Cubra todos os fluxos descobertos com cenários positivos, negativos e edge cases.`;

  console.log('\n🤖  Claude gerando Page Object + spec a partir da exploração...\n');

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 5000,
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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { url, depth, outputDir, module: moduleName } = parseArgs();
  const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
  const className = `${toPascalCase(moduleName)}Page`;

  console.log(`\n🧭  ExploratoryAgent`);
  console.log(`   Módulo: ${moduleName} | Profundidade: ${depth} | Classe: ${className}`);

  // 1. Explorar páginas
  const snapshots = await explorePage(baseUrl, url, depth);

  // 2. Montar resultado da exploração
  const discoveredFlows: string[] = [];
  for (const s of snapshots) {
    if (s.tables.length > 0) discoveredFlows.push('listagem de registros');
    if (s.buttons.some(b => b.text.toLowerCase().includes('add') || b.text.toLowerCase().includes('salvar'))) {
      discoveredFlows.push('criação de registro');
    }
    if (s.buttons.some(b => b.text.toLowerCase().includes('delete') || b.text.toLowerCase().includes('excluir'))) {
      discoveredFlows.push('exclusão de registro');
    }
    if (s.inputs.length > 2) discoveredFlows.push('formulário de busca/filtro');
  }

  const result: ExplorationResult = {
    entryUrl: url,
    module: moduleName,
    snapshots,
    discoveredFlows: [...new Set(discoveredFlows)],
  };

  console.log(`\n✅  Exploração concluída:`);
  console.log(`   Páginas visitadas: ${snapshots.length}`);
  console.log(`   Fluxos descobertos: ${result.discoveredFlows.join(', ') || 'nenhum específico'}\n`);

  // 3. Gerar código com Claude
  const generatedText = await generateFromExploration(result);

  // 4. Salvar arquivos
  const blocks = extractCodeBlocks(generatedText);

  if (blocks.length >= 1) {
    const poDir = path.join(outputDir, 'pages');
    ensureDir(poDir);
    const poPath = path.join(poDir, `${className}.ts`);
    fs.writeFileSync(poPath, blocks[0], 'utf-8');
    console.log(`✅  Page Object salvo: ${poPath}`);
  }

  if (blocks.length >= 2) {
    const specDir = path.join(outputDir, 'tests');
    ensureDir(specDir);
    const specPath = path.join(specDir, `${moduleName}.spec.ts`);
    fs.writeFileSync(specPath, blocks[1], 'utf-8');
    console.log(`✅  Spec salvo: ${specPath}`);
  }

  if (blocks.length < 2) {
    ensureDir(outputDir);
    const rawPath = path.join(outputDir, `${moduleName}-exploration.md`);
    fs.writeFileSync(rawPath, generatedText, 'utf-8');
    console.log(`⚠️  Output salvo para revisão: ${rawPath}`);
  }

  console.log(`\n📋  Próximos passos:`);
  console.log(`   1. Revise e mova os arquivos para src/pages/ e src/tests/${moduleName}/`);
  console.log(`   2. Adicione AppRoute.${moduleName.toUpperCase()} em src/constants/Routes.ts`);
  console.log(`   3. Registre a fixture em src/fixtures/test.fixture.ts`);
  console.log(`   4. Use @test-reviewer para validar o spec gerado`);
  console.log(`   5. Tente profundidade maior: npm run explore -- --url=${url} --depth=2\n`);
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
