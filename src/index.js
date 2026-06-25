'use strict';

// Carrega variáveis de ambiente antes de qualquer outra importação
require('dotenv').config();

const express = require('express');
const { initDatabase, getStats } = require('./database');
const { initAI } = require('./ai');
const { startWhatsApp, isWhatsAppConnected } = require('./whatsapp');
const { handleMessage } = require('./handlers/message');

const PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Inicializa todos os módulos e inicia o sistema.
 */
async function main() {
  console.log('='.repeat(60));
  console.log('  Cunha e Paiva Advogados - Sistema de Atendimento IA');
  console.log('='.repeat(60));
  console.log('');

  // ------------------------------------------------------------------
  // 1. Banco de Dados
  // ------------------------------------------------------------------
  try {
    initDatabase();
  } catch (error) {
    console.error('[INIT] Falha ao inicializar banco de dados:', error.message);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 2. Cliente de IA
  // ------------------------------------------------------------------
  try {
    initAI();
  } catch (error) {
    console.error('[INIT] Falha ao inicializar cliente de IA:', error.message);
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 3. Servidor HTTP (health check e estatísticas)
  // ------------------------------------------------------------------
  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      connected: isWhatsAppConnected(),
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Estatísticas básicas do sistema
  app.get('/stats', (_req, res) => {
    try {
      const stats = getStats();
      res.json({
        status: 'ok',
        whatsapp_connected: isWhatsAppConnected(),
        ...stats,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  // Rota raiz
  app.get('/', (_req, res) => {
    res.json({
      name: 'Cunha e Paiva Advogados - WhatsApp IA',
      version: '1.0.0',
      endpoints: {
        health: 'GET /health',
        stats: 'GET /stats',
      },
    });
  });

  app.listen(PORT, () => {
    console.log(`[HTTP] Servidor rodando em http://localhost:${PORT}`);
    console.log(`[HTTP] Health check: http://localhost:${PORT}/health`);
    console.log(`[HTTP] Estatísticas: http://localhost:${PORT}/stats`);
  });

  // ------------------------------------------------------------------
  // 4. WhatsApp
  // ------------------------------------------------------------------
  console.log('');
  try {
    await startWhatsApp(handleMessage);
  } catch (error) {
    console.error('[INIT] Falha ao iniciar WhatsApp:', error.message);
    process.exit(1);
  }
}

// ------------------------------------------------------------------
// Tratamento de sinais para encerramento gracioso
// ------------------------------------------------------------------
process.on('SIGINT', () => {
  console.log('\n[SYS] Encerrando sistema... Até logo!');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[SYS] Recebido SIGTERM. Encerrando...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('[SYS] Exceção não capturada:', error);
  // Não encerra o processo em exceções não fatais
});

process.on('unhandledRejection', (reason) => {
  console.error('[SYS] Promise rejeitada sem tratamento:', reason);
});

main();
