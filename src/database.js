'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'cunhaepaiva.db');

// Garante que o diretório de dados existe
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db;

/**
 * Inicializa o banco de dados SQLite e cria as tabelas necessárias.
 */
function initDatabase() {
  db = new Database(DB_PATH);

  // Habilita WAL mode para melhor performance com múltiplas leituras
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      phone       TEXT NOT NULL UNIQUE,
      name        TEXT,
      messages    TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      phone          TEXT NOT NULL,
      name           TEXT,
      issue_type     TEXT,
      preferred_date TEXT,
      status         TEXT NOT NULL DEFAULT 'pending',
      created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      phone         TEXT PRIMARY KEY,
      message_count INTEGER NOT NULL DEFAULT 0,
      window_start  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  console.log('[DB] Banco de dados inicializado em:', DB_PATH);
  return db;
}

/**
 * Retorna o histórico de conversas de um número de telefone.
 * @param {string} phone
 * @param {number} [limit=10] - Número máximo de mensagens a retornar
 * @returns {Array} Array de objetos { role, content }
 */
function getConversationHistory(phone, limit = 10) {
  if (!db) throw new Error('Banco de dados não inicializado.');

  const row = db.prepare('SELECT messages FROM conversations WHERE phone = ?').get(phone);
  if (!row) return [];

  try {
    const messages = JSON.parse(row.messages);
    // Retorna apenas as últimas N mensagens para não estourar o contexto
    return messages.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Salva uma mensagem na conversa de um cliente.
 * @param {string} phone
 * @param {string} role - 'user' ou 'assistant'
 * @param {string} content
 * @param {string} [name] - Nome do cliente (opcional)
 */
function saveMessage(phone, role, content, name = null) {
  if (!db) throw new Error('Banco de dados não inicializado.');

  const row = db.prepare('SELECT messages, name FROM conversations WHERE phone = ?').get(phone);

  let messages = [];
  let existingName = null;

  if (row) {
    try {
      messages = JSON.parse(row.messages);
    } catch {
      messages = [];
    }
    existingName = row.name;
  }

  messages.push({ role, content, timestamp: new Date().toISOString() });

  // Mantém apenas as últimas 50 mensagens no banco para controlar tamanho
  if (messages.length > 50) {
    messages = messages.slice(-50);
  }

  const messagesJson = JSON.stringify(messages);
  const resolvedName = name || existingName;

  if (row) {
    db.prepare(`
      UPDATE conversations
      SET messages = ?, name = COALESCE(?, name), updated_at = datetime('now','localtime')
      WHERE phone = ?
    `).run(messagesJson, resolvedName, phone);
  } else {
    db.prepare(`
      INSERT INTO conversations (phone, name, messages)
      VALUES (?, ?, ?)
    `).run(phone, resolvedName, messagesJson);
  }
}

/**
 * Registra uma solicitação de agendamento.
 * @param {Object} params
 * @param {string} params.phone
 * @param {string} [params.name]
 * @param {string} [params.issueType]
 * @param {string} [params.preferredDate]
 */
function saveAppointmentRequest({ phone, name, issueType, preferredDate }) {
  if (!db) throw new Error('Banco de dados não inicializado.');

  db.prepare(`
    INSERT INTO appointments (phone, name, issue_type, preferred_date, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(phone, name || null, issueType || null, preferredDate || null);
}

/**
 * Verifica se o cliente ultrapassou o limite de mensagens na janela atual.
 * @param {string} phone
 * @param {number} maxMessages - Limite máximo de mensagens por hora
 * @returns {{ allowed: boolean, remaining: number }}
 */
function checkRateLimit(phone, maxMessages) {
  if (!db) throw new Error('Banco de dados não inicializado.');

  const row = db.prepare('SELECT message_count, window_start FROM rate_limits WHERE phone = ?').get(phone);

  if (!row) {
    return { allowed: true, remaining: maxMessages };
  }

  const windowStart = new Date(row.window_start);
  const now = new Date();
  const diffMs = now - windowStart;
  const oneHourMs = 60 * 60 * 1000;

  // Se a janela de 1 hora já expirou, o cliente pode enviar novamente
  if (diffMs > oneHourMs) {
    return { allowed: true, remaining: maxMessages };
  }

  const remaining = maxMessages - row.message_count;
  return {
    allowed: remaining > 0,
    remaining: Math.max(0, remaining),
  };
}

/**
 * Incrementa o contador de mensagens do cliente na janela atual.
 * @param {string} phone
 */
function updateRateLimit(phone) {
  if (!db) throw new Error('Banco de dados não inicializado.');

  const row = db.prepare('SELECT message_count, window_start FROM rate_limits WHERE phone = ?').get(phone);

  if (!row) {
    db.prepare(`
      INSERT INTO rate_limits (phone, message_count, window_start)
      VALUES (?, 1, datetime('now','localtime'))
    `).run(phone);
    return;
  }

  const windowStart = new Date(row.window_start);
  const now = new Date();
  const diffMs = now - windowStart;
  const oneHourMs = 60 * 60 * 1000;

  if (diffMs > oneHourMs) {
    // Reinicia a janela
    db.prepare(`
      UPDATE rate_limits SET message_count = 1, window_start = datetime('now','localtime')
      WHERE phone = ?
    `).run(phone);
  } else {
    // Incrementa na janela atual
    db.prepare(`
      UPDATE rate_limits SET message_count = message_count + 1 WHERE phone = ?
    `).run(phone);
  }
}

/**
 * Retorna estatísticas básicas do banco de dados.
 * @returns {Object}
 */
function getStats() {
  if (!db) throw new Error('Banco de dados não inicializado.');

  const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
  const totalAppointments = db.prepare('SELECT COUNT(*) as count FROM appointments').get().count;
  const pendingAppointments = db.prepare("SELECT COUNT(*) as count FROM appointments WHERE status = 'pending'").get().count;
  const activeToday = db.prepare(`
    SELECT COUNT(*) as count FROM conversations
    WHERE date(updated_at) = date('now','localtime')
  `).get().count;

  return {
    totalConversations,
    totalAppointments,
    pendingAppointments,
    activeToday,
  };
}

module.exports = {
  initDatabase,
  getConversationHistory,
  saveMessage,
  saveAppointmentRequest,
  checkRateLimit,
  updateRateLimit,
  getStats,
};
