'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidBroadcast,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');

const AUTH_DIR = path.join(process.cwd(), 'auth_info_baileys');

// Logger silencioso para o Baileys (evita poluição no console)
const baileysLogger = pino({ level: 'silent' });

let sock = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 5000;

/**
 * Inicia a conexão WhatsApp via Baileys.
 *
 * @param {Function} messageHandler - Função chamada para cada mensagem recebida
 *                                    Assinatura: async (sock, msg) => void
 */
async function startWhatsApp(messageHandler) {
  console.log('[WA] Iniciando conexão com WhatsApp...');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`[WA] Usando Baileys versão: ${version.join('.')} (última: ${isLatest})`);

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    printQRInTerminal: false, // Gerenciamos o QR manualmente
    browser: ['Cunha e Paiva Bot', 'Chrome', '120.0.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  // ------------------------------------------------------------------
  // EVENTOS DE CONEXÃO
  // ------------------------------------------------------------------
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n[WA] Escaneie o QR Code abaixo com seu WhatsApp:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n[WA] Aguardando escaneamento do QR Code...\n');
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[WA] Conexão encerrada. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      if (shouldReconnect) {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = RECONNECT_DELAY_MS * reconnectAttempts;
          console.log(`[WA] Tentativa de reconexão ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} em ${delay / 1000}s...`);
          setTimeout(() => startWhatsApp(messageHandler), delay);
        } else {
          console.error('[WA] Número máximo de tentativas de reconexão atingido. Encerrando.');
          process.exit(1);
        }
      } else {
        console.log('[WA] Sessão encerrada (logout). Para conectar novamente, delete a pasta auth_info_baileys/ e reinicie.');
        process.exit(0);
      }
    }

    if (connection === 'open') {
      isConnected = true;
      reconnectAttempts = 0;
      const userNumber = sock.user?.id?.split(':')[0] || 'desconhecido';
      console.log(`[WA] ✅ Conectado ao WhatsApp! Número: ${userNumber}`);
    }

    if (connection === 'connecting') {
      console.log('[WA] Conectando ao WhatsApp...');
    }
  });

  // ------------------------------------------------------------------
  // PERSISTÊNCIA DE CREDENCIAIS
  // ------------------------------------------------------------------
  sock.ev.on('creds.update', saveCreds);

  // ------------------------------------------------------------------
  // RECEBIMENTO DE MENSAGENS
  // ------------------------------------------------------------------
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Processa apenas mensagens recebidas (não notificações de histórico)
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        // Ignora transmissões (broadcasts)
        if (isJidBroadcast(msg.key.remoteJid)) continue;

        await messageHandler(sock, msg);
      } catch (error) {
        console.error('[WA] Erro ao processar mensagem no handler:', error);
      }
    }
  });

  return sock;
}

/**
 * Verifica se o WhatsApp está conectado.
 * @returns {boolean}
 */
function isWhatsAppConnected() {
  return isConnected;
}

module.exports = { startWhatsApp, isWhatsAppConnected };
