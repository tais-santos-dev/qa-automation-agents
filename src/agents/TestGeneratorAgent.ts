/**
 * TestGeneratorAgent.ts
 *
 * Agente AI que navega em uma página do OrangeHRM usando Playwright,
 * extrai a estrutura de elementos interativos e usa Claude para gerar:
 *   1. Um Page Object (extends BasePage)
 *   2. Um spec completo com cenários positivos, negativos e edge cases
 *
 * Uso:
 *   npm run generate -- --url=/web/index.php/leave/viewLeaveList
 *   npm run generate -- --url=/web/index.php/admin/viewAdminModule --module=admin
 *
 * Flags:
 *   --url       Caminho da rota (obrigatório). Ex: /web/index.php/leave/viewLeaveList
 *   --module    Nome do módulo (opcional, inferido da URL se omitido)
 *   --output    Diretório de saída (padrão: src/generated)
 *
 * Pré-requisitos:
 *   - ANTHROPIC_API_KEY no .env
 *   - BASE_URL no .env (padrão: https://opensource-demo.orangehrmlive.com)
 */

/// <reference lib="dom" />
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

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
    module: get('module') || inferModuleName(url),
    outputDir: get('output', 'src/generated'),
  };
}

function inferModuleName(url: string): string {
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

function saveFile(dir: string, filename: string, content: string): string {
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function extractCodeBlocks(text: string): string[] {
  const regex = /```typescript\s*\n([\s\S]*?)```/g;
  return [...text.matchAll(regex)].map(m => m[1].trim());
}

// ─── Inspeção da página com Playwright ────────────────────────────────────

interface PageInspection {
  url: string;
  title: string;
  inputs: { name: string; type: string; placeholder: string; selector: string }[];
  buttons: { text: string; type: string; selector: string }[];
  selects: { name: string; selector: string }[];
  tables: { headers: string[]; selector: string }[];
  headings: string[];
  alerts: string[];
}

async function inspectPage(fullUrl: string): Promise<PageInspection> {
  const authPath = 'auth/admin-storage-state.json';
  const hasAuth = fs.existsSync(authPath);

  console.log(`\n🌐  Abrindo ${fullUrl}...`);
  if (hasAuth) {
    console.log('🔑  Usando sessão autenticada existente.');
  } else {
    console.log('⚠️  Sem sessão salva — fazendo login manual.');
  }

  const browser = await chromium.launch({ headless: true });
  const context = hasAuth
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();

  const page = await context.newPage();

  // Login manual se não houver auth
  if (!hasAuth) {
    const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
    await page.goto(`${baseUrl}/web/index.php/auth/login`, { waitUntil: 'networkidle' });
    await page.fill('input[name="username"]', process.env.ADMIN_USER ?? 'Admin');
    await page.fill('input[name="password"]', process.env.ADMIN_PASSWORD ?? 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
  }

  await page.goto(fullUrl, { waitUntil: 'networkidle' });

  const inspection: PageInspection = await page.evaluate(() => {
    const toSelector = (el: Element): string => {
      if (el.getAttribute('name')) return `[name="${el.getAttribute('name')}"]`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.getAttribute('type')) return `${el.tagName.toLowerCase()}[type="${el.getAttribute('type')}"]`;
      const classes = Array.from(el.classList).filter(c => !c.match(/^(oxd-|--)/)).join('.');
      return classes ? `.${classes}` : el.tagName.toLowerCase();
    };

    return {
      url: window.location.href,
      title: document.title,
      inputs: Array.from(document.querySelectorAll('input:not([type="hidden"])')).slice(0, 15).map(el => ({
        name: el.getAttribute('name') ?? '',
        type: el.getAttribute('type') ?? 'text',
        placeholder: el.getAttribute('placeholder') ?? '',
        selector: toSelector(el),
      })),
      buttons: Array.from(document.querySelectorAll('button')).slice(0, 10).map(el => ({
        text: el.innerText.trim(),
        type: el.getAttribute('type') ?? 'button',
        selector: el.getAttribute('type') ? `button[type="${el.getAttribute('type')}"]` : 'button',
      })),
      selects: Array.from(document.querySelectorAll('select, .oxd-select-wrapper')).slice(0, 8).map(el => ({
        name: el.getAttribute('name') ?? el.className,
        selector: toSelector(el),
      })),
      tables: Array.from(document.querySelectorAll('table, .oxd-table')).slice(0, 3).map(table => ({
        headers: Array.from(table.querySelectorAll('th, .oxd-table-header-cell')).map(th => (th as HTMLElement).innerText.trim()),
        selector: table.classList.contains('oxd-table') ? '.oxd-table' : 'table',
      })),
      headings: Array.from(document.querySelectorAll('h5, h6, .oxd-text--h6, .oxd-text--h5')).slice(0, 5).map(h => (h as HTMLElement).innerText.trim()),
      alerts: Array.from(document.querySelectorAll('.oxd-alert, .oxd-toast')).map(a => (a as HTMLElement).innerText.trim()),
    };
  });

  await browser.close();
  console.log(`✅  Inspeção concluída: ${inspection.inputs.length} inputs, ${inspection.buttons.length} botões, ${inspection.tables.length} tabela(s)\n`);
  return inspection;
}

// ─── Geração com Claude ────────────────────────────────────────────────────

async function generateWithClaude(
  client: Anthropic,
  inspection: PageInspection,
  moduleName: string,
  className: string
): Promise<string> {

  const systemPrompt = `Você é um especialista em automação de testes Playwright + TypeScript para o projeto OrangeHRM.

## Padrões obrigatórios do projeto

### Page Object (extends BasePage)
\`\`\`typescript
import { Page, expect } from '@playwright/test';
import { BasePage } from '../utils/BasePage';
import { AppRoute } from '../constants/Routes';

export class ${className} extends BasePage {
  // Locators: private (uso interno) ou protected (herdável)
  private get elemento() { return this.page.locator('[seletor-semantico]'); }

  constructor(page: Page) { super(page); }

  async open(): Promise<void> { await this.navigate(AppRoute.ROTA); }

  // Ações: usam this.click(), this.fill(), this.selectOption() — nunca page.locator().click()
  async fazerAcao(valor: string): Promise<void> {
    await this.fill(this.elemento, valor);
    await this.click(this.botaoSubmit);
    await this.waitForPageLoad();
  }

  async obterTexto(): Promise<string> { return this.getText(this.elemento); }
  async expectSucesso(): Promise<void> { await this.expectUrlContains('fragmento'); }
}
\`\`\`

### Spec
- Import: \`import { test, expect } from '../../fixtures/test.fixture';\`
- Nomes em português: \`deve [verbo] [resultado]\`
- Tags obrigatórias: \`{ tag: ['@smoke', '@${moduleName}'] }\`
- Comentários: \`// Arrange\`, \`// Act\`, \`// Assert\`
- Sem magic strings: use enums de \`@constants/Messages\`
- Estrutura: \`Positivo\`, \`Negativo\`, \`Edge Cases\`

Gere DOIS blocos \`\`\`typescript:
1. O Page Object completo
2. O spec completo

Prefira seletores semânticos: \`[name="x"]\`, \`[type="submit"]\`, \`[data-testid="x"]\`.
Evite seletores frágeis baseados em posição ou classes geradas.`;

  const userMessage = `Gere o Page Object e o spec para esta página do OrangeHRM:

**Módulo:** ${moduleName}
**Classe:** ${className}
**URL inspecionada:** ${inspection.url}
**Título da página:** ${inspection.title}

**Elementos encontrados:**

Inputs (${inspection.inputs.length}):
${inspection.inputs.map(i => `  - name="${i.name}" type="${i.type}" placeholder="${i.placeholder}" → ${i.selector}`).join('\n')}

Botões (${inspection.buttons.length}):
${inspection.buttons.map(b => `  - "${b.text}" type="${b.type}" → ${b.selector}`).join('\n')}

Selects/Dropdowns (${inspection.selects.length}):
${inspection.selects.map(s => `  - "${s.name}" → ${s.selector}`).join('\n')}

Tabelas (${inspection.tables.length}):
${inspection.tables.map(t => `  - headers: [${t.headers.join(', ')}] → ${t.selector}`).join('\n')}

Headings: ${inspection.headings.join(' | ')}`;

  console.log('🤖  Gerando código com Claude Opus 4.6...\n');

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
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
  const { url, module: moduleName, outputDir } = parseArgs();
  const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
  const fullUrl = `${baseUrl}${url}`;
  const className = `${toPascalCase(moduleName)}Page`;

  console.log(`\n🚀  TestGeneratorAgent`);
  console.log(`   Módulo: ${moduleName} | Classe: ${className}`);

  // 1. Inspecionar a página
  const inspection = await inspectPage(fullUrl);

  // 2. Gerar código com Claude
  const client = new Anthropic();
  const generatedText = await generateWithClaude(client, inspection, moduleName, className);

  // 3. Salvar arquivos
  const blocks = extractCodeBlocks(generatedText);

  if (blocks.length >= 1) {
    const poPath = saveFile(path.join(outputDir, 'pages'), `${className}.ts`, blocks[0]);
    console.log(`✅  Page Object salvo: ${poPath}`);
  }

  if (blocks.length >= 2) {
    const specPath = saveFile(path.join(outputDir, 'tests'), `${moduleName}.spec.ts`, blocks[1]);
    console.log(`✅  Spec salvo: ${specPath}`);
  }

  if (blocks.length < 2) {
    const rawPath = saveFile(outputDir, `${moduleName}-output.md`, generatedText);
    console.log(`⚠️  Output salvo para revisão manual: ${rawPath}`);
  }

  console.log(`\n📋  Próximos passos:`);
  console.log(`   1. Mova os arquivos para src/pages/ e src/tests/${moduleName}/`);
  console.log(`   2. Adicione AppRoute.${moduleName.toUpperCase()} em src/constants/Routes.ts`);
  console.log(`   3. Adicione a fixture em src/fixtures/test.fixture.ts`);
  console.log(`   4. Use @test-reviewer para validar o spec gerado`);
  console.log(`   5. Execute: npx playwright test src/tests/${moduleName}/ --headed\n`);
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
