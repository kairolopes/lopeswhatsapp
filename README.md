# LopesWhatsApp

Visão geral
- Frontend React (Vite) em client/
- Backend Node/Express (ESM) em server/
- WebSocket via Socket.io
- Banco local SQLite com chats e messages

Variáveis de Ambiente (Render)
- EVOLUTION_URL: URL base da sua instância Evolution/superbot
- EVOLUTION_API_KEY: chave da API Evolution
- INSTANCE_NAME: nome da instância (ex.: kairo2)
- DB_PATH: caminho absoluto para o arquivo SQLite (usar volume persistente)

Build & Start (Render)
- Build command: cd server && npm install && cd ../client && npm install && npm run build
- Start command: cd server && npm start
- Variáveis obrigatórias no serviço:
  - EVOLUTION_URL=https://evolution-api-1p4o.onrender.com
  - EVOLUTION_API_KEY=evolution-api-secret-key-123456
  - INSTANCE_NAME=kairo2
  - PORT=3000

Webhook
- Endpoint: https://SEU_HOST/webhook/INSTANCE_NAME
- Para configurar automaticamente: GET https://SEU_HOST/api/setup-webhook
- Para ambiente local com túnel: GET http://localhost:3000/api/setup-webhook?baseUrl=https://SEU_TUNEL
- A rota coringa /webhook/* não persiste mensagens; use apenas o endpoint correto

Endpoints do Backend
- GET /api/health: status de configuração (sem expor segredos)
- GET /api/test-connection: valida acesso à Evolution
- GET /api/chats: lista de conversas com lastMessageTimestamp e lastReadTimestamp
- GET /api/messages/:remoteJid: histórico (ordenado)
- POST /api/chats/:remoteJid/read: marcar conversa como lida
- GET /api/unread-counts: contagem de não lidas por conversa
- POST /api/send-message: enviar texto (body: { number, text })
- POST /api/send-media: enviar imagem/áudio (multipart: file, number, type, caption?)
- POST /chat/fetchProfile/:instance: busca e persiste nome/foto
- POST /chat/fetchProfilePictureUrl/:instance: busca foto do perfil

Notas sobre mídia/áudio
- Imagem/documento: campos attachment e file enviados para compatibilidade
- Áudio: tenta endpoint de áudio; se falhar, faz fallback via sendMedia com mediatype=audio

Observações
- Emojis são suportados no envio de texto (UTF‑8)
- Para persistência real no Render, defina DB_PATH em um volume persistente ou migre para Postgres/Supabase

Desenvolvimento Local
- Backend: cd server && npm run dev
- Frontend: cd client && npm run dev
- Acesse: http://localhost:5173 (proxy para http://localhost:3000)
- Simular recebimento: GET http://localhost:3000/api/simulate-webhook
