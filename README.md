# Cunha e Paiva Advogados — Sistema de Atendimento IA via WhatsApp

Sistema de atendimento automatizado pelo WhatsApp para o escritório **Cunha e Paiva Advogados**, utilizando Inteligência Artificial (Claude da Anthropic) para responder clientes de forma profissional, empática e em português brasileiro.

---

## O que o sistema faz

- Recebe mensagens de clientes no WhatsApp e responde automaticamente com a IA **Ana**, assistente virtual do escritório
- Mantém o histórico da conversa para respostas contextualizadas
- Detecta intenção de agendamento e registra no banco de dados
- Identifica a área jurídica de interesse do cliente (trabalhista, família, criminal, civil etc.)
- Detecta quando o cliente quer falar com um humano e registra o pedido
- Aplica limite de mensagens por hora para evitar abusos
- Expõe endpoints HTTP para monitoramento do sistema

---

## Pré-requisitos

- **Node.js 18 ou superior** ([download](https://nodejs.org/))
- **npm** (incluído com o Node.js)
- Um número de WhatsApp disponível para o bot (recomendado: um chip dedicado)
- Chave de API da Anthropic (Claude)

---

## Instalação

### 1. Clone ou acesse o repositório

```bash
cd cunhaepaiva
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Copie o arquivo de exemplo e edite com suas configurações:

```bash
cp .env.example .env
```

Edite o arquivo `.env`:

```env
ANTHROPIC_API_KEY=sua_chave_aqui
PORT=3000
MAX_MESSAGES_PER_HOUR=20
```

### 4. Obtenha sua chave de API da Anthropic (Claude)

1. Acesse [console.anthropic.com](https://console.anthropic.com/)
2. Crie uma conta ou faça login
3. Vá em **API Keys** e clique em **Create Key**
4. Copie a chave e cole no `.env` no campo `ANTHROPIC_API_KEY`

> **Nota:** A chave começa com `sk-ant-...`

---

## Como usar

### Iniciar o sistema

```bash
npm start
```

Ou, para desenvolvimento com reinício automático:

```bash
npm run dev
```

### Conectar o WhatsApp (escaneio do QR Code)

1. Ao iniciar, o sistema exibirá um QR Code no terminal
2. Abra o WhatsApp no seu celular
3. Vá em **Dispositivos Conectados** → **Conectar Dispositivo**
4. Escaneie o QR Code exibido no terminal
5. A mensagem `✅ Conectado ao WhatsApp!` confirmará a conexão

A sessão é salva na pasta `auth_info_baileys/`. Na próxima vez, o sistema conectará automaticamente sem precisar do QR.

> Para desconectar e reconectar com outro número, delete a pasta `auth_info_baileys/` e reinicie.

---

## Estrutura do Projeto

```
cunhaepaiva/
├── src/
│   ├── index.js              # Ponto de entrada — inicializa todos os módulos
│   ├── whatsapp.js           # Conexão WhatsApp via Baileys (QR, reconexão, eventos)
│   ├── ai.js                 # Integração com Claude AI (Anthropic)
│   ├── database.js           # Banco de dados SQLite (histórico, agendamentos, rate limit)
│   ├── handlers/
│   │   └── message.js        # Roteamento e processamento de mensagens
│   └── prompts/
│       └── legal.js          # Prompt do sistema da assistente Ana
├── data/
│   └── cunhaepaiva.db        # Banco SQLite (criado automaticamente)
├── auth_info_baileys/        # Sessão WhatsApp (criado automaticamente)
├── .env                      # Variáveis de ambiente (não commitar!)
├── .env.example              # Exemplo de configuração
└── package.json
```

---

## Endpoints de Monitoramento

| Rota | Descrição |
|------|-----------|
| `GET /health` | Status do sistema e conexão WhatsApp |
| `GET /stats` | Estatísticas: conversas, agendamentos, ativos hoje |
| `GET /` | Informações gerais da API |

Exemplo:
```bash
curl http://localhost:3000/health
```

---

## Personalização da Assistente

### Alterar nome, horários ou serviços

Edite o arquivo `src/prompts/legal.js`. As principais seções são:

- **IDENTIDADE**: nome da assistente, tom de voz
- **HORÁRIO DE ATENDIMENTO**: dias e horários
- **SERVIÇOS OFERECIDOS**: áreas de atuação
- **NÚMERO DE EMERGÊNCIA**: substitua `(XX) XXXXX-XXXX` pelo número real

### Adicionar palavras-chave de detecção

Edite o arquivo `src/handlers/message.js`, no objeto `KEYWORDS`, para incluir novos termos por área.

### Ajustar o modelo de IA

No arquivo `src/ai.js`, altere o campo `model` na chamada à API:

```js
model: 'claude-sonnet-4-6',  // ou outro modelo Anthropic
max_tokens: 1024,
```

### Limite de mensagens por hora

Ajuste no arquivo `.env`:

```env
MAX_MESSAGES_PER_HOUR=20
```

---

## Banco de Dados

O SQLite é criado automaticamente em `data/cunhaepaiva.db`. Tabelas:

| Tabela | Descrição |
|--------|-----------|
| `conversations` | Histórico de mensagens por cliente |
| `appointments` | Solicitações de agendamento registradas |
| `rate_limits` | Controle de limite de mensagens por hora |

Para consultar manualmente:

```bash
sqlite3 data/cunhaepaiva.db "SELECT phone, name, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 20;"
```

---

## Deploy em Produção

### Opção 1 — PM2 (recomendado para VPS)

```bash
npm install -g pm2
pm2 start src/index.js --name cunhaepaiva-bot
pm2 save
pm2 startup
```

### Opção 2 — Docker

Crie um `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/index.js"]
```

```bash
docker build -t cunhaepaiva-bot .
docker run -d --env-file .env -p 3000:3000 -v $(pwd)/data:/app/data -v $(pwd)/auth_info_baileys:/app/auth_info_baileys cunhaepaiva-bot
```

### Dicas de Produção

- **Mantenha o `.env` seguro**: nunca commite no Git. Adicione ao `.gitignore`.
- **Backup do `auth_info_baileys/`**: se perder essa pasta, precisará escanear o QR novamente.
- **Backup do `data/cunhaepaiva.db`**: contém todo o histórico de conversas e agendamentos.
- **Monitore os logs**: use `pm2 logs cunhaepaiva-bot` para acompanhar em tempo real.
- **Renove a chave API periodicamente** por segurança.

---

## Avisos Importantes

- Este sistema **não substitui** o atendimento humano. É um primeiro ponto de contato.
- A IA é configurada para **não dar pareceres jurídicos específicos**, apenas orientação geral.
- Verifique a legislação vigente sobre uso de IA no atendimento ao cliente (LGPD, Código de Ética da OAB).
- O sistema usa a biblioteca `@whiskeysockets/baileys`, que é uma implementação não oficial do WhatsApp. Use com responsabilidade.

---

## Suporte

Para dúvidas técnicas sobre o sistema, consulte a documentação das bibliotecas utilizadas:

- [Baileys (WhatsApp)](https://github.com/WhiskeySockets/Baileys)
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-node)
- [Better SQLite3](https://github.com/WiseLibs/better-sqlite3)
