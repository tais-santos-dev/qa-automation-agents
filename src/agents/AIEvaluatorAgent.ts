/**
 * AIEvaluatorAgent.ts
 *
 * Agente que avalia a qualidade dos outputs de outros agentes usando
 * LLM-as-Judge com rubricas explícitas por critério.
 *
 * Cada agente tem uma rubrica calibrada com scores 0-10.
 * O "juiz" é claude-opus-4-6 avaliando outputs dos demais agentes.
 * Outputs com score < 7 são sinalizados para revisão humana.
 *
 * Uso:
 *   npm run eval -- --agent=failure-analyzer --input=reports/last-analysis.md
 *   npm run eval -- --agent=test-reviewer --input=src/tests/smoke/auth/login.spec.ts
 *   npm run eval:all   # avalia todos os agentes com seus golden datasets
 *
 * Flags:
 *   --agent   Nome do agente a avaliar (obrigatório)
 *   --input   Arquivo com o output do agente a ser avaliado
 *   --save    Salva resultado em reports/eval-[agent]-[timestamp].json
 *
 * Agentes suportados:
 *   failure-analyzer | flaky-detector | test-reviewer |
 *   coverage-advisor | selector-healer | test-generator
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Tipos ─────────────────────────────────────────────────────────────────

interface Criterio {
  nome: string;
  descricao: string;
  peso: number; // 1-3 (importância relativa)
  rubrica: Record<number, string>; // score → descrição
}

interface Rubrica {
  agente: string;
  descricao: string;
  criterios: Criterio[];
  aprovadoSe: number; // score mínimo ponderado (0-10)
}

interface ResultadoCriterio {
  nome: string;
  score: number;
  peso: number;
  justificativa: string;
}

interface ResultadoAvaliacao {
  agente: string;
  timestamp: string;
  scoreFinal: number;
  aprovado: boolean;
  criterios: ResultadoCriterio[];
  resumo: string;
  recomendacoes: string[];
}

// ─── Rubricas por Agente ───────────────────────────────────────────────────

const RUBRICAS: Record<string, Rubrica> = {
  'failure-analyzer': {
    agente: 'FailureAnalyzerAgent',
    descricao: 'Avalia se o diagnóstico de falha é preciso, acionável e correto',
    aprovadoSe: 7,
    criterios: [
      {
        nome: 'Classificação do tipo de falha',
        descricao: 'Identificou corretamente o tipo (locator/timeout/assertion/auth/race condition)',
        peso: 2,
        rubrica: {
          0: 'Não classificou ou classificou completamente errado',
          1: 'Classificou vagamente sem especificar o tipo',
          2: 'Classificou corretamente com evidência do texto de erro',
        },
      },
      {
        nome: 'Referência ao arquivo e linha',
        descricao: 'Citou o arquivo correto e idealmente a linha do problema',
        peso: 2,
        rubrica: {
          0: 'Não mencionou nenhum arquivo',
          1: 'Mencionou arquivo mas sem linha ou com linha incorreta',
          2: 'Citou arquivo e linha corretamente',
        },
      },
      {
        nome: 'Correção sugerida é aplicável',
        descricao: 'Código antes/depois pronto para aplicar, sem invenções',
        peso: 3,
        rubrica: {
          0: 'Sem correção ou correção incorreta/inaplicável',
          1: 'Direção correta mas código incompleto ou genérico demais',
          2: 'Correção parcialmente aplicável com ajustes',
          3: 'Código antes/depois preciso, pronto para aplicar',
        },
      },
      {
        nome: 'Ausência de alucinação',
        descricao: 'Todos métodos, arquivos e classes citados existem no projeto',
        peso: 3,
        rubrica: {
          0: 'Inventou métodos, arquivos ou classes que não existem',
          1: 'Citou elementos não verificáveis (pode existir, pode não existir)',
          2: 'Elementos citados são plausíveis para o projeto',
          3: 'Todos os elementos citados existem e são corretos',
        },
      },
    ],
  },

  'test-reviewer': {
    agente: 'test-reviewer',
    descricao: 'Avalia se o review de spec identifica problemas reais sem falsos positivos',
    aprovadoSe: 7,
    criterios: [
      {
        nome: 'Cobertura do checklist',
        descricao: 'Verificou estrutura, imports, tags, assertions e anti-patterns',
        peso: 2,
        rubrica: {
          0: 'Verificou menos de 2 dimensões do checklist',
          1: 'Verificou 3-4 dimensões com superficialidade',
          2: 'Verificou todas as dimensões com exemplos concretos',
        },
      },
      {
        nome: 'Precisão dos problemas apontados',
        descricao: 'Problemas identificados são reais, não falsos positivos',
        peso: 3,
        rubrica: {
          0: 'Maioria dos problemas são falsos positivos ou inválidos',
          1: 'Mistura de problemas reais e falsos positivos',
          2: 'Maioria dos problemas são válidos',
          3: 'Todos os problemas são válidos e relevantes',
        },
      },
      {
        nome: 'Veredito justificado',
        descricao: 'Veredito final (APROVADO/BLOQUEADO) está alinhado com os problemas',
        peso: 2,
        rubrica: {
          0: 'Veredito contraditório com os problemas encontrados',
          1: 'Veredito correto mas sem justificativa clara',
          2: 'Veredito correto e bem justificado',
        },
      },
      {
        nome: 'Acionabilidade',
        descricao: 'O desenvolvedor sabe exatamente o que corrigir',
        peso: 3,
        rubrica: {
          0: 'Feedback vago, não sabe o que fazer',
          1: 'Feedback com direção mas sem código ou exemplo',
          2: 'Feedback com exemplo parcial',
          3: 'Feedback com código exato para corrigir',
        },
      },
    ],
  },

  'coverage-advisor': {
    agente: 'coverage-advisor',
    descricao: 'Avalia se a análise de cobertura é precisa e as prioridades fazem sentido',
    aprovadoSe: 6,
    criterios: [
      {
        nome: 'Mapeamento correto de módulos',
        descricao: 'Identificou corretamente os módulos cobertos e descobertos',
        peso: 3,
        rubrica: {
          0: 'Mapeamento incorreto ou incompleto',
          1: 'Mapeamento parcial com gaps evidentes',
          2: 'Mapeamento correto dos principais módulos',
          3: 'Mapeamento completo e preciso com evidências',
        },
      },
      {
        nome: 'Priorização por risco de negócio',
        descricao: 'Priorizou módulos por impacto real no negócio, não por facilidade',
        peso: 3,
        rubrica: {
          0: 'Priorização aleatória ou por facilidade técnica',
          1: 'Priorização com alguma lógica de negócio',
          2: 'Priorização clara por risco com justificativa',
          3: 'Priorização detalhada com critérios explícitos de risco',
        },
      },
      {
        nome: 'Recomendações específicas',
        descricao: 'Próximos passos são específicos, não genéricos',
        peso: 2,
        rubrica: {
          0: '"Adicione mais testes" — genérico demais',
          1: 'Especifica módulos mas não fluxos',
          2: 'Especifica módulos e fluxos prioritários',
        },
      },
      {
        nome: 'Ausência de invenção de cobertura',
        descricao: 'Não afirmou que testes existem quando não existem',
        peso: 2,
        rubrica: {
          0: 'Afirmou cobertura inexistente',
          1: 'Incerto sobre cobertura de alguns módulos',
          2: 'Preciso sobre o que existe e o que não existe',
        },
      },
    ],
  },

  'selector-healer': {
    agente: 'SelectorHealerAgent',
    descricao: 'Avalia se os seletores sugeridos são estáveis e corretos',
    aprovadoSe: 7,
    criterios: [
      {
        nome: 'Estabilidade do seletor sugerido',
        descricao: 'Prioriza [name], [data-testid], aria sobre classes CSS geradas',
        peso: 3,
        rubrica: {
          0: 'Sugeriu seletor baseado em posição ou classe gerada frágil',
          1: 'Seletor funcional mas não o mais estável possível',
          2: 'Seletor estável com prioridade correta',
          3: 'Seletor ótimo com justificativa de estabilidade',
        },
      },
      {
        nome: 'Explicação do motivo da quebra',
        descricao: 'Explicou por que o seletor anterior parou de funcionar',
        peso: 2,
        rubrica: {
          0: 'Sem explicação',
          1: 'Explicação vaga',
          2: 'Explicação precisa e educativa',
        },
      },
      {
        nome: 'Código de substituição pronto',
        descricao: 'Forneceu before/after pronto para aplicar no Page Object',
        peso: 3,
        rubrica: {
          0: 'Sem código de substituição',
          1: 'Código incompleto ou com erro de sintaxe',
          2: 'Código correto mas precisa de adaptação',
          3: 'Código exato, pronto para copiar e colar',
        },
      },
      {
        nome: 'Nível de confiança calibrado',
        descricao: 'A confiança declarada (Alta/Média/Baixa) reflete evidências reais',
        peso: 2,
        rubrica: {
          0: 'Confiança Alta sem evidência suficiente',
          1: 'Confiança razoável mas poderia ser mais precisa',
          2: 'Confiança bem calibrada com o DOM disponível',
        },
      },
    ],
  },

  'test-generator': {
    agente: 'TestGeneratorAgent',
    descricao: 'Avalia se o Page Object e spec gerados seguem os padrões do projeto',
    aprovadoSe: 7,
    criterios: [
      {
        nome: 'Padrões de Page Object',
        descricao: 'Extende BasePage, locators private/protected, métodos com verbos',
        peso: 3,
        rubrica: {
          0: 'Não segue nenhum padrão do projeto',
          1: 'Segue alguns padrões com violações importantes',
          2: 'Segue a maioria dos padrões',
          3: 'Segue todos os padrões com seletores semânticos',
        },
      },
      {
        nome: 'Qualidade dos cenários de teste',
        descricao: 'Cobre positivo, negativo e edge cases com assertions reais',
        peso: 3,
        rubrica: {
          0: 'Apenas caminho feliz ou sem assertions reais',
          1: 'Positivo e alguns negativos superficiais',
          2: 'Cobertura boa com assertions verificáveis',
          3: 'Cobertura completa com arrange/act/assert explícitos',
        },
      },
      {
        nome: 'Zero magic strings',
        descricao: 'Usa enums de constants/ em vez de strings hardcoded',
        peso: 2,
        rubrica: {
          0: 'Cheio de strings hardcoded',
          1: 'Algumas strings hardcoded, maioria em enum',
          2: 'Todos os valores em enums ou variáveis nomeadas',
        },
      },
      {
        nome: 'Nomes em português e formato correto',
        descricao: 'deve [verbo] [resultado], tags corretas, estrutura describe',
        peso: 2,
        rubrica: {
          0: 'Nomes em inglês ou sem formato padrão',
          1: 'Maioria em português mas inconsistente',
          2: 'Todos no formato correto com tags e estrutura',
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
    console.error('❌  Flag obrigatória: --agent=nome');
    console.error(`   Agentes disponíveis: ${Object.keys(RUBRICAS).join(' | ')}`);
    process.exit(1);
  }

  return {
    agent,
    inputFile: get('input'),
    save: args.includes('--save'),
  };
}

function calcularScorePonderado(criterios: ResultadoCriterio[]): number {
  const totalPeso = criterios.reduce((s, c) => s + c.peso, 0);
  const scorePonderado = criterios.reduce((s, c) => {
    const rubrica = RUBRICAS[Object.keys(RUBRICAS)[0]].criterios.find(r => r.nome === c.nome);
    const maxScore = rubrica ? Math.max(...Object.keys(rubrica.rubrica).map(Number)) : 3;
    return s + (c.score / maxScore) * c.peso;
  }, 0);
  return Math.round((scorePonderado / totalPeso) * 10 * 10) / 10;
}

function carregarInput(inputFile: string, agente: string): string {
  if (inputFile && fs.existsSync(inputFile)) {
    return fs.readFileSync(inputFile, 'utf-8');
  }

  // Tentar encontrar último relatório gerado
  const reportDir = 'reports';
  if (fs.existsSync(reportDir)) {
    const files = fs.readdirSync(reportDir)
      .filter(f => f.includes(agente.replace('-', '')) && f.endsWith('.md'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const found = path.join(reportDir, files[0]);
      console.log(`📂  Usando relatório mais recente: ${found}`);
      return fs.readFileSync(found, 'utf-8');
    }
  }

  throw new Error(
    `Nenhum input encontrado. Use --input=caminho/para/output.md\n` +
    `   Ou gere primeiro: npm run ${agente === 'failure-analyzer' ? 'analyze' : agente}`
  );
}

// ─── Avaliação com Claude ──────────────────────────────────────────────────

async function avaliarOutput(
  rubrica: Rubrica,
  outputDoAgente: string
): Promise<ResultadoAvaliacao> {
  const client = new Anthropic();

  const sistemPrompt = `Você é um avaliador especialista de qualidade de outputs de agentes de IA.
Seu papel é avaliar outputs de forma objetiva, imparcial e calibrada.

REGRAS FUNDAMENTAIS:
- Avalie APENAS o output fornecido, não o que você esperaria
- Seja preciso com os scores — não inflacione por educação
- Se não tiver evidência suficiente para avaliar um critério, score = 1
- Responda EXATAMENTE no formato JSON especificado

FORMATO DE RESPOSTA (JSON puro, sem markdown):
{
  "criterios": [
    {
      "nome": "nome exato do critério",
      "score": número,
      "justificativa": "evidência específica do output que justifica o score"
    }
  ],
  "resumo": "2-3 frases sobre a qualidade geral do output",
  "recomendacoes": ["recomendação específica 1", "recomendação 2"]
}`;

  const criteriosText = rubrica.criterios.map(c => `
### ${c.nome} (peso: ${c.peso})
${c.descricao}
Scores possíveis:
${Object.entries(c.rubrica).map(([s, d]) => `  ${s}: ${d}`).join('\n')}`).join('\n');

  const userMessage = `Avalie o output do agente "${rubrica.agente}":

## Critérios de avaliação:
${criteriosText}

## Output do agente a avaliar:
${outputDoAgente.substring(0, 6000)}

Avalie cada critério com precisão. Cite trechos específicos do output como evidência.`;

  console.log(`\n🤖  Claude avaliando output do ${rubrica.agente}...\n`);

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: sistemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const texto = response.content.find(b => b.type === 'text')?.text ?? '{}';

  let parsed: { criterios: ResultadoCriterio[]; resumo: string; recomendacoes: string[] };
  try {
    parsed = JSON.parse(texto);
  } catch {
    // Tentar extrair JSON se vier com markdown
    const match = texto.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : { criterios: [], resumo: texto, recomendacoes: [] };
  }

  const criteriosComPeso = parsed.criterios.map(c => {
    const rubricaCriterio = rubrica.criterios.find(r => r.nome === c.nome);
    return { ...c, peso: rubricaCriterio?.peso ?? 1 };
  });

  const scoreFinal = calcularScorePonderado(criteriosComPeso);

  return {
    agente: rubrica.agente,
    timestamp: new Date().toISOString(),
    scoreFinal,
    aprovado: scoreFinal >= rubrica.aprovadoSe,
    criterios: criteriosComPeso,
    resumo: parsed.resumo,
    recomendacoes: parsed.recomendacoes ?? [],
  };
}

function exibirResultado(resultado: ResultadoAvaliacao, rubrica: Rubrica): void {
  const STATUS = resultado.aprovado ? '✅ APROVADO' : '🚨 REPROVADO';
  const BAR = '═'.repeat(60);

  console.log(`\n${BAR}`);
  console.log(`  ${STATUS} — ${resultado.agente}`);
  console.log(`  Score: ${resultado.scoreFinal}/10 (mínimo: ${rubrica.aprovadoSe}/10)`);
  console.log(`${BAR}\n`);

  console.log('## Critérios\n');
  for (const c of resultado.criterios) {
    const rubricaCriterio = rubrica.criterios.find(r => r.nome === c.nome);
    const maxScore = rubricaCriterio ? Math.max(...Object.keys(rubricaCriterio.rubrica).map(Number)) : 3;
    const emoji = c.score === maxScore ? '✅' : c.score === 0 ? '🚨' : '⚠️';
    console.log(`${emoji}  **${c.nome}** [peso ${c.peso}] — ${c.score}/${maxScore}`);
    console.log(`   ${c.justificativa}\n`);
  }

  console.log(`## Resumo\n${resultado.resumo}\n`);

  if (resultado.recomendacoes.length > 0) {
    console.log('## Recomendações para melhorar o agente');
    resultado.recomendacoes.forEach((r, i) => console.log(`${i + 1}. ${r}`));
  }

  console.log(`\n${BAR}\n`);
}

function salvarResultado(resultado: ResultadoAvaliacao): void {
  const dir = 'reports/evals';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const nomeAgente = resultado.agente.toLowerCase().replace(/\s/g, '-');
  const filePath = path.join(dir, `eval-${nomeAgente}-${ts}.json`);

  fs.writeFileSync(filePath, JSON.stringify(resultado, null, 2), 'utf-8');
  console.log(`📋  Resultado salvo: ${filePath}\n`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { agent, inputFile, save } = parseArgs();

  const rubrica = RUBRICAS[agent];
  if (!rubrica) {
    console.error(`❌  Agente desconhecido: "${agent}"`);
    console.error(`   Disponíveis: ${Object.keys(RUBRICAS).join(' | ')}`);
    process.exit(1);
  }

  console.log(`\n🔬  AIEvaluatorAgent`);
  console.log(`   Avaliando: ${rubrica.agente}`);
  console.log(`   Critérios: ${rubrica.criterios.length} | Aprovado se score ≥ ${rubrica.aprovadoSe}/10\n`);

  let outputDoAgente: string;
  try {
    outputDoAgente = carregarInput(inputFile, agent);
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`❌  ${error.message}`);
    process.exit(1);
  }

  const resultado = await avaliarOutput(rubrica, outputDoAgente);
  exibirResultado(resultado, rubrica);

  if (save) salvarResultado(resultado);

  // Exit code para integração com CI
  process.exit(resultado.aprovado ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
