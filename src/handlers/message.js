'use strict';

const {
  getConversationHistory,
  saveMessage,
  saveAppointmentRequest,
  checkRateLimit,
  updateRateLimit,
} = require('../database');
const { generateResponse } = require('../ai');

const MAX_MESSAGES_PER_HOUR = parseInt(process.env.MAX_MESSAGES_PER_HOUR || '20', 10);

// Palavras-chave por área do direito para detecção de intenção
const KEYWORDS = {
  trabalhista: ['trabalhista', 'trabalho', 'emprego', 'demissão', 'rescisão', 'fgts', 'horas extras', 'assédio', 'clt', 'carteira', 'salário', 'férias', 'décimo terceiro', '13º'],
  família: ['família', 'divórcio', 'separação', 'guarda', 'pensão', 'alimentos', 'casamento', 'filho', 'filha', 'adoção', 'inventário', 'herança', 'partilha'],
  criminal: ['criminal', 'crime', 'penal', 'preso', 'prisão', 'boletim', 'ocorrência', 'delegacia', 'polícia', 'ameaça', 'agressão', 'violência', 'medida protetiva'],
  civil: ['civil', 'indenização', 'dano', 'acidente', 'vizinho', 'condomínio', 'cobrança', 'dívida', 'contrato'],
  contrato: ['contrato', 'acordo', 'documento', 'assinar', 'assinatura', 'revisão', 'elaborar', 'redigir'],
  divórcio: ['divórcio', 'separar', 'separação', 'ex-marido', 'ex-mulher', 'ex-cônjuge'],
  pensão: ['pensão', 'alimentos', 'pensão alimentícia', 'pagar pensão', 'receber pensão'],
  acidente: ['acidente', 'batida', 'carro', 'trânsito', 'atropelamento', 'lesão', 'machucado'],
  imóveis: ['imóvel', 'imóveis', 'casa', 'apartamento', 'terreno', 'aluguel', 'locação', 'compra', 'venda', 'usucapião'],
};

// Palavras-chave para detectar intenção de agendamento
const APPOINTMENT_KEYWORDS = [
  'agendar', 'agendamento', 'marcar', 'consulta', 'reunião', 'atendimento',
  'horário', 'disponível', 'quero falar', 'preciso falar', 'falar com advogado',
  'conversar com advogado',
];

// Palavras-chave para detectar que o cliente quer falar com um humano
const HUMAN_ESCALATION_KEYWORDS = [
  'falar com humano', 'falar com pessoa', 'atendente', 'pessoa real',
  'não quero falar com robô', 'não quero robô', 'quero humano',
  'falar com advogado agora', 'urgente', 'emergência',
];

/**
 * Extrai o texto de uma mensagem do Baileys, suportando diferentes tipos.
 * @param {Object} message - Objeto de mensagem do Baileys
 * @returns {string|null}
 */
function extractMessageText(message) {
  const msg = message.message;
  if (!msg) return null;

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    null
  );
}

/**
 * Detecta a área jurídica com base nas palavras-chave da mensagem.
 * @param {string} text
 * @returns {string|null}
 */
function detectLegalArea(text) {
  const lower = text.toLowerCase();
  for (const [area, keywords] of Object.entries(KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return area;
    }
  }
  return null;
}

/**
 * Verifica se o cliente quer agendar uma consulta.
 * @param {string} text
 * @returns {boolean}
 */
function detectsAppointmentIntent(text) {
  const lower = text.toLowerCase();
  return APPOINTMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Verifica se o cliente quer ser transferido para um humano.
 * @param {string} text
 * @returns {boolean}
 */
function detectsHumanEscalation(text) {
  const lower = text.toLowerCase();
  return HUMAN_ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Sanitiza o número de telefone para uso como identificador.
 * @param {string} jid - JID do Baileys (ex: 5511999999999@s.whatsapp.net)
 * @returns {string} Apenas os dígitos do número
 */
function sanitizePhone(jid) {
  return jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}

/**
 * Handler principal de mensagens recebidas via WhatsApp.
 *
 * @param {Object} sock - Instância do socket Baileys
 * @param {Object} msg  - Objeto de mensagem do Baileys
 */
async function handleMessage(sock, msg) {
  try {
    // ------------------------------------------------------------------
    // 1. FILTROS BÁSICOS
    // ------------------------------------------------------------------

    // Ignora mensagens de status do WhatsApp
    if (msg.key.remoteJid === 'status@broadcast') return;

    // Ignora mensagens enviadas pelo próprio bot
    if (msg.key.fromMe) return;

    // Extrai o texto da mensagem
    const messageText = extractMessageText(msg);
    if (!messageText || messageText.trim() === '') return;

    const senderJid = msg.key.remoteJid;

    // Ignora mensagens de grupos
    const isGroup = senderJid.endsWith('@g.us');
    if (isGroup) {
      console.log(`[MSG] Mensagem de grupo ignorada: ${senderJid}`);
      return;
    }

    const phone = sanitizePhone(senderJid);
    const trimmedText = messageText.trim();

    console.log(`[MSG] Nova mensagem de ${phone}: "${trimmedText.substring(0, 80)}${trimmedText.length > 80 ? '...' : ''}"`);

    // ------------------------------------------------------------------
    // 2. VERIFICAÇÃO DE RATE LIMIT
    // ------------------------------------------------------------------
    const { allowed, remaining } = checkRateLimit(phone, MAX_MESSAGES_PER_HOUR);

    if (!allowed) {
      const rateLimitMessage =
        `⚠️ Você atingiu o limite de ${MAX_MESSAGES_PER_HOUR} mensagens por hora.\n\n` +
        `Por favor, aguarde um momento antes de enviar novas mensagens. ` +
        `Se for urgente, entre em contato diretamente pelo número do escritório.\n\n` +
        `Atenciosamente,\n*Cunha e Paiva Advogados*`;

      await sock.sendMessage(senderJid, { text: rateLimitMessage });
      console.log(`[RATE LIMIT] ${phone} atingiu o limite de mensagens.`);
      return;
    }

    // Atualiza o contador de rate limit
    updateRateLimit(phone);

    // ------------------------------------------------------------------
    // 3. DETECÇÃO DE INTENÇÕES
    // ------------------------------------------------------------------
    const wantsHuman = detectsHumanEscalation(trimmedText);
    const wantsAppointment = detectsAppointmentIntent(trimmedText);
    const legalArea = detectLegalArea(trimmedText);

    if (legalArea) {
      console.log(`[MSG] Área jurídica detectada: ${legalArea} para ${phone}`);
    }

    if (wantsHuman) {
      console.log(`[MSG] Cliente ${phone} solicitou atendimento humano.`);
    }

    if (wantsAppointment) {
      console.log(`[MSG] Cliente ${phone} demonstrou intenção de agendamento.`);
      // Registra intenção de agendamento (sem dados completos ainda)
      saveAppointmentRequest({ phone, issueType: legalArea });
    }

    // ------------------------------------------------------------------
    // 4. GERAÇÃO DE RESPOSTA PELA IA
    // ------------------------------------------------------------------
    const history = getConversationHistory(phone, 10);

    // Salva a mensagem do usuário antes de gerar resposta
    saveMessage(phone, 'user', trimmedText);

    // Gera resposta via Claude
    const aiResponse = await generateResponse(phone, trimmedText, history);

    // ------------------------------------------------------------------
    // 5. ENVIO DA RESPOSTA
    // ------------------------------------------------------------------
    await sock.sendMessage(senderJid, { text: aiResponse });

    // Salva a resposta da IA no histórico
    saveMessage(phone, 'assistant', aiResponse);

    console.log(`[MSG] Resposta enviada para ${phone}. Mensagens restantes nesta hora: ${remaining - 1}`);

  } catch (error) {
    console.error('[MSG] Erro ao processar mensagem:', error);

    // Tenta notificar o cliente sobre o erro
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        text: 'Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente em alguns instantes ou entre em contato diretamente com o escritório.',
      });
    } catch (sendError) {
      console.error('[MSG] Falha ao enviar mensagem de erro para o cliente:', sendError.message);
    }
  }
}

module.exports = { handleMessage };
