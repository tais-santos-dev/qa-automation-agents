/**
 * SyntheticUserAgent.ts
 *
 * Agente que simula usuários reais com psicologia, objetivos e estado emocional
 * usando o modelo BDI (Belief-Desire-Intention). Navega pelo OrangeHRM de forma
 * autônoma tomando decisões como um humano real faria — incluindo erros,
 * frustração e comportamentos inesperados que revelam bugs ocultos.
 *
 * Uso:
 *   npm run synthetic -- --url=/web/index.php/pim/addEmployee --persona=maria-rh
 *   npm run synthetic -- --url=/web/index.php/leave --persona=joao-dev --sessions=3
 *   npm run synthetic -- --url=/web/index.php/pim --persona=all
 *
 * Flags:
 *   --url       Rota de entrada (obrigatório)
 *   --persona   ID da persona (padrão: maria-rh) | "all" para todas
 *   --sessions  Número de sessões por persona (padrão: 1)
 *   --output    Diretório de saída do relatório (padrão: reports/synthetic)
 *
 * Personas disponíveis:
 *   maria-rh | joao-dev | ana-mobile | carlos-gestor | lucia-acessibilidade
 */

/// <reference lib="dom" />
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Modelo BDI ────────────────────────────────────────────────────────────

interface Persona {
  id: string;
  nome: string;
  idade: number;
  papel: string;
  experienciaTecnica: 'baixa' | 'media' | 'alta';

  // Crenças (frequentemente incorretas — é isso que gera bugs interessantes)
  crencas: {
    enterSalvaFormulario: boolean;
    camposComAsteriscoSaoObrigatorios: boolean;
    sistemaTemAutoSave: boolean;
    erroSumeSozinho: boolean;
    botaoCinzaEstaDesabilitado: boolean;
  };

  // Estado inicial
  pacienciaInicial: number; // 0-100
  confiancaInicial: number; // 0-100

  // Comportamentos por nível de paciência
  comportamentoFrustrado: string;
  comportamentoConfiante: string;

  // Objetivo da sessão
  objetivo: string;

  // Contexto de pressão
  pressao: string; // "reunião em 20 minutos", "sem pressão", etc.
}

interface EstadoUsuario {
  paciencia: number;
  confianca: number;
  acoesTomadas: number;
  errosEncontrados: string[];
  caminhosAlternativos: string[];
  momentoFrustacao?: string;
  abandonou: boolean;
}

interface AcaoDecidida {
  tipo: 'click' | 'fill' | 'navigate' | 'wait' | 'abandon' | 'ask_help' | 'try_alternative';
  seletor?: string;
  valor?: string;
  url?: string;
  raciocinio: string;
  estadoEmocional: string;
}

interface BugEncontrado {
  tipo: 'confusao_ux' | 'comportamento_inesperado' | 'erro_silencioso' | 'loop_infinito' | 'dado_perdido' | 'acessibilidade';
  descricao: string;
  passos: string[];
  impactoNaPersona: string;
  severidade: 'critica' | 'alta' | 'media' | 'baixa';
}

interface SessaoSintetica {
  persona: Persona;
  url: string;
  duracao: number;
  acoes: string[];
  estadoFinal: EstadoUsuario;
  bugsEncontrados: BugEncontrado[];
  conclusao: string;
}

// ─── Personas ──────────────────────────────────────────────────────────────

const PERSONAS: Record<string, Persona> = {
  'maria-rh': {
    id: 'maria-rh',
    nome: 'Maria Santos',
    idade: 45,
    papel: 'Gerente de RH com 15 anos de experiência mas pouca familiaridade com sistemas modernos',
    experienciaTecnica: 'baixa',
    crencas: {
      enterSalvaFormulario: true,        // ERRADA — vai causar submissão acidental
      camposComAsteriscoSaoObrigatorios: true,
      sistemaTemAutoSave: true,          // ERRADA — vai perder dados
      erroSumeSozinho: true,             // ERRADA — vai ignorar mensagens de erro
      botaoCinzaEstaDesabilitado: true,
    },
    pacienciaInicial: 70,
    confiancaInicial: 50,
    comportamentoFrustrado: 'Tenta clicar em lugares aleatórios, depois pede ajuda ao TI',
    comportamentoConfiante: 'Segue o fluxo principal com cuidado',
    objetivo: 'Cadastrar um novo funcionário contratado hoje antes da reunião de onboarding',
    pressao: 'Reunião de onboarding em 30 minutos',
  },

  'joao-dev': {
    id: 'joao-dev',
    nome: 'João Silva',
    idade: 28,
    papel: 'Desenvolvedor que está usando o sistema pela primeira vez para registrar suas férias',
    experienciaTecnica: 'alta',
    crencas: {
      enterSalvaFormulario: false,
      camposComAsteriscoSaoObrigatorios: true,
      sistemaTemAutoSave: false,
      erroSumeSozinho: false,
      botaoCinzaEstaDesabilitado: true,
    },
    pacienciaInicial: 90,
    confiancaInicial: 80,
    comportamentoFrustrado: 'Abre o console do navegador para debugar, tenta atalhos de teclado',
    comportamentoConfiante: 'Explora o sistema metodicamente, testa funcionalidades secundárias',
    objetivo: 'Solicitar 5 dias de férias para a próxima semana',
    pressao: 'Nenhuma pressão de tempo',
  },

  'ana-mobile': {
    id: 'ana-mobile',
    nome: 'Ana Oliveira',
    idade: 32,
    papel: 'Analista que usa exclusivamente o celular para tudo, incluindo sistemas corporativos',
    experienciaTecnica: 'media',
    crencas: {
      enterSalvaFormulario: false,
      camposComAsteriscoSaoObrigatorios: true,
      sistemaTemAutoSave: true,          // ERRADA
      erroSumeSozinho: false,
      botaoCinzaEstaDesabilitado: false, // ERRADA — vai tentar clicar em tudo
    },
    pacienciaInicial: 60,
    confiancaInicial: 65,
    comportamentoFrustrado: 'Fecha e reabre o app/aba, limpa o cache',
    comportamentoConfiante: 'Usa o sistema normalmente mas com dedos grandes em tela pequena',
    objetivo: 'Verificar o histórico de horas extras e gerar relatório',
    pressao: 'Está no ônibus com conexão instável',
  },

  'carlos-gestor': {
    id: 'carlos-gestor',
    nome: 'Carlos Mendes',
    idade: 55,
    papel: 'Diretor que usa o sistema apenas uma vez por mês para aprovar solicitações',
    experienciaTecnica: 'baixa',
    crencas: {
      enterSalvaFormulario: true,        // ERRADA
      camposComAsteriscoSaoObrigatorios: false, // ERRADA — vai pular campos importantes
      sistemaTemAutoSave: true,          // ERRADA
      erroSumeSozinho: true,             // ERRADA
      botaoCinzaEstaDesabilitado: false, // ERRADA
    },
    pacienciaInicial: 40,
    confiancaInicial: 30,
    comportamentoFrustrado: 'Liga para a secretária ou manda e-mail para o TI imediatamente',
    comportamentoConfiante: 'Clica no que parece mais óbvio sem ler instruções',
    objetivo: 'Aprovar as solicitações de férias pendentes da equipe',
    pressao: 'Tem 10 minutos antes de uma call internacional',
  },

  'lucia-acessibilidade': {
    id: 'lucia-acessibilidade',
    nome: 'Lúcia Fernandes',
    idade: 38,
    papel: 'Analista com baixa visão que usa zoom do navegador a 200% e alto contraste',
    experienciaTecnica: 'media',
    crencas: {
      enterSalvaFormulario: false,
      camposComAsteriscoSaoObrigatorios: true,
      sistemaTemAutoSave: false,
      erroSumeSozinho: false,
      botaoCinzaEstaDesabilitado: true,
    },
    pacienciaInicial: 75,
    confiancaInicial: 60,
    comportamentoFrustrado: 'Usa Tab para navegar entre elementos quando o mouse falha',
    comportamentoConfiante: 'Usa zoom e navegação por teclado para todas as ações',
    objetivo: 'Atualizar seus dados pessoais no sistema',
    pressao: 'Nenhuma pressão mas tem dificuldade com interfaces de baixo contraste',
  },
};

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
    personaId: get('persona', 'maria-rh'),
    sessions: parseInt(get('sessions', '1'), 10),
    outputDir: get('output', 'reports/synthetic'),
  };
}

async function capturarEstadoPagina(page: Page): Promise<string> {
  return page.evaluate(() => {
    const elementos: string[] = [];

    // Elementos interativos visíveis
    document.querySelectorAll('input:not([type="hidden"]), button, select, textarea, a[href]')
      .forEach(el => {
        const visivel = (el as HTMLElement).offsetParent !== null;
        if (!visivel) return;
        const nome = el.getAttribute('name') || el.getAttribute('aria-label') || '';
        const texto = (el as HTMLElement).innerText?.trim().substring(0, 30) || '';
        const tipo = el.tagName.toLowerCase();
        const desabilitado = (el as HTMLInputElement).disabled ? ' [DESABILITADO]' : '';
        elementos.push(`${tipo}${nome ? `[name="${nome}"]` : ''}${texto ? ` "${texto}"` : ''}${desabilitado}`);
      });

    // Mensagens de erro/sucesso visíveis
    const alertas: string[] = [];
    document.querySelectorAll('.oxd-alert, .oxd-toast, [class*="error"], [class*="alert"]')
      .forEach(el => {
        const texto = (el as HTMLElement).innerText?.trim();
        if (texto) alertas.push(`ALERTA: "${texto}"`);
      });

    return [
      `URL: ${window.location.href}`,
      `Título: ${document.title}`,
      `Elementos interativos (${elementos.length}):`,
      ...elementos.slice(0, 20).map(e => `  - ${e}`),
      ...(alertas.length > 0 ? ['', 'Mensagens visíveis:', ...alertas] : []),
    ].join('\n');
  });
}

// ─── Decisão com Claude ────────────────────────────────────────────────────

async function decidirProximaAcao(
  client: Anthropic,
  persona: Persona,
  estado: EstadoUsuario,
  estadoPagina: string,
  historico: string[]
): Promise<AcaoDecidida> {
  const systemPrompt = `Você é ${persona.nome}, ${persona.papel}.

SUAS CRENÇAS SOBRE O SISTEMA (algumas podem estar erradas):
- Enter salva formulário: ${persona.crencas.enterSalvaFormulario}
- Auto-save ativo: ${persona.crencas.sistemaTemAutoSave}
- Erros somem sozinhos: ${persona.crencas.erroSumeSozinho}
- Botão cinza = desabilitado: ${persona.crencas.botaoCinzaEstaDesabilitado}

SEU OBJETIVO: ${persona.objetivo}
PRESSÃO: ${persona.pressao}
EXPERIÊNCIA TÉCNICA: ${persona.experienciaTecnica}

ESTADO EMOCIONAL ATUAL:
- Paciência: ${estado.paciencia}/100
- Confiança: ${estado.confianca}/100
- Ações tomadas: ${estado.acoesTomadas}
- Erros encontrados até agora: ${estado.errosEncontrados.length}

REGRAS DE COMPORTAMENTO:
- Se paciência < 30: ${persona.comportamentoFrustrado}
- Se paciência > 70: ${persona.comportamentoConfiante}
- Com experiência ${persona.experienciaTecnica}: age de forma compatível com esse nível
- Suas crenças erradas DEVEM guiar ações incorretas ocasionalmente

Responda em JSON:
{
  "tipo": "click|fill|navigate|wait|abandon|ask_help|try_alternative",
  "seletor": "seletor CSS ou texto do elemento (se click ou fill)",
  "valor": "texto a digitar (se fill)",
  "url": "URL a navegar (se navigate)",
  "raciocinio": "o que você está pensando em 1 frase como ${persona.nome}",
  "estadoEmocional": "como você está se sentindo agora em 1 frase",
  "novaPaciencia": número entre 0 e 100,
  "novaConfianca": número entre 0 e 100
}`;

  const userMessage = `ESTADO ATUAL DA TELA:
${estadoPagina}

HISTÓRICO DE AÇÕES (últimas 5):
${historico.slice(-5).join('\n') || 'Nenhuma ação tomada ainda'}

O que você faz agora como ${persona.nome}?`;

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const texto = response.content.find(b => b.type === 'text')?.text ?? '{}';
  const match = texto.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  return {
    tipo: parsed.tipo ?? 'wait',
    seletor: parsed.seletor,
    valor: parsed.valor,
    url: parsed.url,
    raciocinio: parsed.raciocinio ?? '...',
    estadoEmocional: parsed.estadoEmocional ?? '...',
  };
}

async function analisarBugsEncontrados(
  client: Anthropic,
  persona: Persona,
  acoes: string[],
  erros: string[]
): Promise<BugEncontrado[]> {
  if (acoes.length === 0) return [];

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2000,
    system: `Você é um analista de UX e QA analisando a sessão de um usuário sintético.
Identifique bugs, problemas de UX e comportamentos inesperados que afetaram o usuário.
Responda em JSON: { "bugs": [{ "tipo": "confusao_ux|comportamento_inesperado|erro_silencioso|loop_infinito|dado_perdido|acessibilidade", "descricao": "...", "passos": ["..."], "impactoNaPersona": "...", "severidade": "critica|alta|media|baixa" }] }`,
    messages: [{
      role: 'user',
      content: `Persona: ${persona.nome} (${persona.papel})
Objetivo: ${persona.objetivo}
Experiência técnica: ${persona.experienciaTecnica}

Sequência de ações:
${acoes.join('\n')}

Erros encontrados:
${erros.join('\n') || 'Nenhum erro explícito'}

Que bugs ou problemas de UX isso revela?`,
    }],
  });

  const texto = response.content.find(b => b.type === 'text')?.text ?? '{}';
  const match = texto.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : { bugs: [] };
  return parsed.bugs ?? [];
}

// ─── Execução da Sessão ────────────────────────────────────────────────────

async function executarSessao(
  client: Anthropic,
  persona: Persona,
  url: string
): Promise<SessaoSintetica> {
  const authPath = 'auth/admin-storage-state.json';
  const baseUrl = process.env.BASE_URL ?? 'https://opensource-demo.orangehrmlive.com';
  const fullUrl = `${baseUrl}${url}`;

  const browser = await chromium.launch({ headless: true });
  const context = fs.existsSync(authPath)
    ? await browser.newContext({ storageState: authPath })
    : await browser.newContext();
  const page = await context.newPage();

  const estado: EstadoUsuario = {
    paciencia: persona.pacienciaInicial,
    confianca: persona.confiancaInicial,
    acoesTomadas: 0,
    errosEncontrados: [],
    caminhosAlternativos: [],
    abandonou: false,
  };

  const acoes: string[] = [];
  const inicio = Date.now();
  const MAX_ACOES = 20;

  try {
    await page.goto(fullUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    console.log(`\n👤  ${persona.nome} iniciando sessão`);
    console.log(`   Objetivo: ${persona.objetivo}`);
    console.log(`   Pressão: ${persona.pressao}`);
    console.log(`   Paciência: ${estado.paciencia} | Confiança: ${estado.confianca}\n`);

    while (estado.acoesTomadas < MAX_ACOES && !estado.abandonou) {
      const estadoPagina = await capturarEstadoPagina(page);
      const acao = await decidirProximaAcao(client, persona, estado, estadoPagina, acoes);

      const logAcao = `[${estado.acoesTomadas + 1}] ${acao.tipo.toUpperCase()}: ${acao.raciocinio}`;
      acoes.push(logAcao);
      console.log(`   ${logAcao}`);
      console.log(`   💭 "${acao.estadoEmocional}"`);

      try {
        switch (acao.tipo) {
          case 'click':
            if (acao.seletor) {
              await page.locator(acao.seletor).first().click({ timeout: 3000 });
              await page.waitForTimeout(800);
            }
            break;

          case 'fill':
            if (acao.seletor && acao.valor !== undefined) {
              await page.locator(acao.seletor).first().fill(acao.valor, { timeout: 3000 });
            }
            break;

          case 'navigate':
            if (acao.url) {
              const navUrl = acao.url.startsWith('http') ? acao.url : `${baseUrl}${acao.url}`;
              await page.goto(navUrl, { waitUntil: 'networkidle' });
              await page.waitForTimeout(1000);
              estado.caminhosAlternativos.push(navUrl);
            }
            break;

          case 'abandon':
            estado.abandonou = true;
            estado.momentoFrustacao = acao.raciocinio;
            console.log(`\n   🚨 ${persona.nome} abandonou a sessão!`);
            console.log(`   Motivo: ${acao.raciocinio}\n`);
            break;

          case 'ask_help':
            estado.errosEncontrados.push(`Precisou de ajuda: ${acao.raciocinio}`);
            console.log(`   📞 ${persona.nome} pediu ajuda`);
            break;

          case 'try_alternative':
            estado.caminhosAlternativos.push(acao.raciocinio);
            break;

          case 'wait':
            await page.waitForTimeout(1000);
            break;
        }

        // Verificar erros visíveis após ação
        const erroVisivel = await page.locator('.oxd-alert-content, .oxd-input-field-error-message').first().textContent({ timeout: 500 }).catch(() => null);
        if (erroVisivel && erroVisivel.trim()) {
          estado.errosEncontrados.push(erroVisivel.trim());
          estado.paciencia = Math.max(0, estado.paciencia - 10);
          console.log(`   ⚠️  Erro visível: "${erroVisivel.trim()}" (paciência: ${estado.paciencia})`);
        }

      } catch {
        estado.errosEncontrados.push(`Falha ao executar: ${acao.tipo} em "${acao.seletor}"`);
        estado.paciencia = Math.max(0, estado.paciencia - 5);
      }

      estado.acoesTomadas++;

      if (estado.paciencia <= 0) {
        estado.abandonou = true;
        estado.momentoFrustacao = 'Paciência esgotada';
        console.log(`\n   🚨 Paciência esgotada — ${persona.nome} abandonou\n`);
        break;
      }
    }

  } finally {
    await browser.close();
  }

  const duracao = Math.round((Date.now() - inicio) / 1000);
  const bugs = await analisarBugsEncontrados(client, persona, acoes, estado.errosEncontrados);

  return {
    persona,
    url,
    duracao,
    acoes,
    estadoFinal: estado,
    bugsEncontrados: bugs,
    conclusao: estado.abandonou
      ? `${persona.nome} abandonou após ${estado.acoesTomadas} ações. ${estado.momentoFrustacao ?? ''}`
      : `${persona.nome} completou a sessão com ${estado.acoesTomadas} ações. Paciência final: ${estado.paciencia}`,
  };
}

// ─── Relatório ─────────────────────────────────────────────────────────────

function salvarRelatorio(sessoes: SessaoSintetica[], outputDir: string): void {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const todosOsBugs = sessoes.flatMap(s => s.bugsEncontrados);
  const bugsCriticos = todosOsBugs.filter(b => b.severidade === 'critica' || b.severidade === 'alta');

  const relatorio = `# Relatório de Usuários Sintéticos
Gerado em: ${new Date().toISOString()}
Sessões executadas: ${sessoes.length} | Bugs encontrados: ${todosOsBugs.length} (${bugsCriticos.length} críticos/altos)

## Resumo Executivo

${sessoes.map(s => `### ${s.persona.nome} (${s.persona.papel})
- **Objetivo:** ${s.persona.objetivo}
- **Duração:** ${s.duracao}s | **Ações:** ${s.estadoFinal.acoesTomadas}
- **Paciência final:** ${s.estadoFinal.paciencia}/100
- **Abandonou:** ${s.estadoFinal.abandonou ? '🚨 Sim' : '✅ Não'}
- **Conclusão:** ${s.conclusao}
`).join('\n')}

## Bugs Encontrados por Severidade

${['critica', 'alta', 'media', 'baixa'].map(sev => {
  const bugs = todosOsBugs.filter(b => b.severidade === sev);
  if (bugs.length === 0) return '';
  return `### ${sev.toUpperCase()} (${bugs.length})\n${bugs.map(b => `
**${b.tipo}:** ${b.descricao}
- Passos: ${b.passos.join(' → ')}
- Impacto em ${b.impactoNaPersona}
`).join('\n')}`;
}).join('\n')}

## Jornadas Detalhadas

${sessoes.map(s => `### ${s.persona.nome}
${s.acoes.map(a => `- ${a}`).join('\n')}
${s.estadoFinal.errosEncontrados.length > 0 ? `\n**Erros encontrados:**\n${s.estadoFinal.errosEncontrados.map(e => `- ${e}`).join('\n')}` : ''}
${s.estadoFinal.caminhosAlternativos.length > 0 ? `\n**Caminhos alternativos tentados:**\n${s.estadoFinal.caminhosAlternativos.map(c => `- ${c}`).join('\n')}` : ''}
`).join('\n')}
`;

  const reportPath = path.join(outputDir, `synthetic-users-${ts}.md`);
  fs.writeFileSync(reportPath, relatorio, 'utf-8');
  console.log(`\n📋  Relatório salvo: ${reportPath}`);

  // JSON para integração com outros agentes
  const jsonPath = path.join(outputDir, `synthetic-users-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ sessoes, todosOsBugs }, null, 2), 'utf-8');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { url, personaId, sessions, outputDir } = parseArgs();

  const personasParaExecutar = personaId === 'all'
    ? Object.values(PERSONAS)
    : [PERSONAS[personaId]].filter(Boolean);

  if (personasParaExecutar.length === 0) {
    console.error(`❌  Persona não encontrada: "${personaId}"`);
    console.error(`   Disponíveis: ${Object.keys(PERSONAS).join(' | ')} | all`);
    process.exit(1);
  }

  console.log(`\n🎭  SyntheticUserAgent`);
  console.log(`   URL: ${url}`);
  console.log(`   Personas: ${personasParaExecutar.map(p => p.nome).join(', ')}`);
  console.log(`   Sessões por persona: ${sessions}`);

  const client = new Anthropic();
  const todasSessoes: SessaoSintetica[] = [];

  for (const persona of personasParaExecutar) {
    for (let s = 0; s < sessions; s++) {
      if (sessions > 1) console.log(`\n${'─'.repeat(60)}\nSessão ${s + 1}/${sessions} — ${persona.nome}`);
      const sessao = await executarSessao(client, persona, url);
      todasSessoes.push(sessao);

      const bugsCriticos = sessao.bugsEncontrados.filter(b => b.severidade === 'critica' || b.severidade === 'alta');
      console.log(`\n   ✅  Sessão concluída: ${sessao.acoes.length} ações | ${sessao.bugsEncontrados.length} bugs (${bugsCriticos.length} críticos)`);
    }
  }

  salvarRelatorio(todasSessoes, outputDir);

  const totalBugs = todasSessoes.flatMap(s => s.bugsEncontrados).length;
  const abandonaram = todasSessoes.filter(s => s.estadoFinal.abandonou).length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅  ${todasSessoes.length} sessão(ões) executada(s)`);
  console.log(`   ${totalBugs} bug(s) encontrado(s) | ${abandonaram} sessão(ões) abandonada(s)`);
  if (abandonaram > 0) {
    console.log(`   🚨 Taxa de abandono: ${Math.round((abandonaram / todasSessoes.length) * 100)}%`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(err => {
  console.error('\n❌  Erro fatal:', err.message);
  process.exit(1);
});
