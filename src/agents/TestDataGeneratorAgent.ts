/**
 * TestDataGeneratorAgent.ts
 *
 * Agente AI que analisa Page Objects de um módulo e gera cenários de dados
 * edge-case usando Faker.js + Claude. Produz um arquivo de factory TypeScript
 * com datasets prontos para testes de validação, internacionalização e limites.
 *
 * Uso:
 *   npm run data-gen -- --module=employee
 *   npm run data-gen -- --module=leave --output=src/factories
 *
 * Flags:
 *   --module   Nome do módulo (obrigatório). Ex: employee, leave, admin
 *   --output   Diretório de saída (padrão: src/generated/factories)
 *
 * Pré-requisitos:
 *   - ANTHROPIC_API_KEY no .env
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback = '') =>
    args.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? fallback;

  const module = get('module');
  if (!module) {
    console.error('❌  Flag obrigatória: --module=nome (ex: employee, leave, admin)');
    process.exit(1);
  }

  return {
    module,
    outputDir: get('output', 'src/generated/factories'),
  };
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractCodeBlock(text: string): string {
  const match = text.match(/```typescript\s*\n([\s\S]*?)```/);
  return match ? match[1].trim() : text;
}

function readModuleContext(moduleName: string): string {
  const searchDirs = ['src/pages', 'src/components', 'src/factories'];
  const files: string[] = [];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const found = fs.readdirSync(dir)
      .filter(f => f.toLowerCase().includes(moduleName.toLowerCase()) && f.endsWith('.ts'))
      .map(f => path.join(dir, f));
    files.push(...found);
  }

  if (files.length === 0) {
    return `Módulo: ${moduleName} (sem Page Objects encontrados — gere baseado no nome do módulo)`;
  }

  let context = '';
  for (const file of files.slice(0, 3)) {
    context += `\n### ${path.basename(file)}\n\`\`\`typescript\n`;
    context += fs.readFileSync(file, 'utf-8').split('\n').slice(0, 80).join('\n');
    context += '\n```\n';
  }

  return context;
}

// ─── Geração com Claude ────────────────────────────────────────────────────

async function generateTestData(moduleName: string, moduleContext: string): Promise<string> {
  const client = new Anthropic();
  const className = `${toPascalCase(moduleName)}DataFactory`;

  const systemPrompt = `Você é um especialista em QA que cria dados de teste edge-case para Playwright + TypeScript.
O projeto usa @faker-js/faker para geração de dados dinâmicos.

## Objetivo
Gerar uma factory TypeScript com datasets cobrindo:
1. **Dados válidos** — caminho feliz com dados realistas
2. **Dados de limite** — strings máximas/mínimas, números extremos, datas limítrofes
3. **Caracteres especiais** — acentos, emojis, SQL injection, XSS tentativas
4. **Internacionalização** — nomes com caracteres de outros idiomas (japonês, árabe, etc.)
5. **Campos vazios/nulos** — cada campo obrigatório vazio individualmente
6. **Formato inválido** — emails malformados, datas inválidas, telefones errados

## Padrões do projeto OrangeHRM
- Use \`import { faker } from '@faker-js/faker';\`
- Exporte um objeto com datasets nomeados (não uma classe)
- Cada dataset deve ser um objeto ou função que retorna objeto
- Inclua JSDoc explicando o cenário de cada dataset
- Use tipos TypeScript explícitos para os dados

Gere UM bloco \`\`\`typescript com a factory completa.`;

  const userMessage = `Gere uma factory de dados edge-case para o módulo **${moduleName}** do OrangeHRM.

## Contexto do módulo (Page Objects encontrados):
${moduleContext}

## Requisitos
- Nome da factory: \`${className}\`
- Arquivo: \`${className}.ts\`
- Cubra pelo menos 8 cenários distintos de dados
- Para OrangeHRM, os campos típicos incluem: firstName, lastName, employeeId, email, phone, dateOfBirth, joiningDate, department, jobTitle
- Adapte para o módulo **${moduleName}** especificamente`;

  console.log(`\n🤖  Gerando dados edge-case para módulo "${moduleName}" com Claude...\n`);

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

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { module: moduleName, outputDir } = parseArgs();
  const className = `${toPascalCase(moduleName)}DataFactory`;

  console.log(`\n🧪  TestDataGeneratorAgent`);
  console.log(`   Módulo: ${moduleName} | Factory: ${className}\n`);

  // 1. Ler contexto do módulo
  console.log('📂  Lendo Page Objects do módulo...');
  const moduleContext = readModuleContext(moduleName);
  const filesFound = moduleContext.includes('```typescript') ? '(contexto carregado)' : '(sem arquivos — geração baseada no nome)';
  console.log(`   ${filesFound}\n`);

  // 2. Gerar dados com Claude
  const generatedText = await generateTestData(moduleName, moduleContext);

  // 3. Salvar factory
  const codeBlock = extractCodeBlock(generatedText);
  ensureDir(outputDir);
  const filePath = path.join(outputDir, `${className}.ts`);
  fs.writeFileSync(filePath, codeBlock, 'utf-8');

  console.log(`✅  Factory salva: ${filePath}`);
  console.log(`\n📋  Próximos passos:`);
  console.log(`   1. Mova o arquivo para src/factories/ após revisão`);
  console.log(`   2. Importe nos specs: import { ${className} } from '@factories/${className}'`);
  console.log(`   3. Use nos testes: const data = ${className}.validData()`);
  console.log(`   4. Valide com @test-reviewer antes de commitar\n`);
}

main().catch(err => {
  console.error('\n❌  Erro:', err.message);
  process.exit(1);
});
