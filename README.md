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

Webhook
- Endpoint: https://SEU_HOST/webhook/INSTANCE_NAME
- A rota coringa /webhook/* não persiste mensagens; use apenas o endpoint correto

Endpoints do Backend
- GET /api/health: status de configuração (sem expor segredos)
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
