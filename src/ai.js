'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getSystemPrompt } = require('./prompts/legal');

let anthropicClient;

/**
 * Inicializa o cliente Anthropic.
 * Deve ser chamado após carregar as variáveis de ambiente.
 */
function initAI() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não definida. Verifique seu arquivo .env');
  }

  anthropicClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log('[AI] Cliente Anthropic inicializado com sucesso.');
}

/**
 * Formata a data/hora atual em português para uso no prompt.
 * @returns {string}
 */
function getCurrentTimeForPrompt() {
  const now = new Date();
  const diasSemana = [
    'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado',
  ];
  const diaSemana = diasSemana[now.getDay()];
  const dia = String(now.getDate()).padStart(2, '0');
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const ano = now.getFullYear();
  const hora = String(now.getHours()).padStart(2, '0');
  const minuto = String(now.getMinutes()).padStart(2, '0');

  return `${diaSemana}, ${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}

/**
 * Gera uma resposta da IA para a mensagem do cliente.
 *
 * @param {string} phoneNumber - Número de telefone do remetente (para logging)
 * @param {string} userMessage - Mensagem enviada pelo cliente
 * @param {Array}  conversationHistory - Histórico da conversa [{ role, content }]
 * @returns {Promise<string>} Texto da resposta gerada pela IA
 */
async function generateResponse(phoneNumber, userMessage, conversationHistory) {
  if (!anthropicClient) {
    throw new Error('Cliente AI não inicializado. Chame initAI() primeiro.');
  }

  const currentTime = getCurrentTimeForPrompt();
  const systemPrompt = getSystemPrompt(currentTime);

  // Monta o array de mensagens: histórico + mensagem atual
  const messages = [
    ...conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: 'user',
      content: userMessage,
    },
  ];

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const responseText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    console.log(`[AI] Resposta gerada para ${phoneNumber} (${responseText.length} chars)`);
    return responseText;
  } catch (error) {
    console.error('[AI] Erro ao gerar resposta:', error.message);

    // Mensagem de fallback amigável em caso de erro
    if (error.status === 429) {
      return 'Estou com muitas solicitações no momento. Por favor, aguarde alguns instantes e tente novamente. 🙏';
    }

    if (error.status === 503 || error.status === 529) {
      return 'Nosso serviço de atendimento está temporariamente indisponível. Por favor, tente novamente em alguns minutos ou entre em contato pelo número do escritório.';
    }

    throw error;
  }
}

module.exports = { initAI, generateResponse };
