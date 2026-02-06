import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import FormData from 'form-data';
import fs from 'fs';
import sqlite3 from 'sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Database Setup
const dbPath = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // Create Chats table
        db.run(`CREATE TABLE IF NOT EXISTS chats (
            remoteJid TEXT PRIMARY KEY,
            name TEXT,
            profilePictureUrl TEXT,
            lastMessageTimestamp INTEGER
        )`);

        // Create Messages table
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            remoteJid TEXT,
            fromMe BOOLEAN,
            content TEXT,
            type TEXT,
            timestamp INTEGER,
            status TEXT,
            FOREIGN KEY (remoteJid) REFERENCES chats (remoteJid)
        )`);

        // Track last read timestamp per chat
        db.run(`CREATE TABLE IF NOT EXISTS read_state (
            remoteJid TEXT PRIMARY KEY,
            lastReadTimestamp INTEGER DEFAULT 0,
            FOREIGN KEY (remoteJid) REFERENCES chats (remoteJid)
        )`);
        
        // Ensure soft-delete columns exist
        try {
            db.run(`ALTER TABLE chats ADD COLUMN deleted BOOLEAN DEFAULT 0`, (err) => {});
        } catch (e) {}
        try {
            db.run(`ALTER TABLE messages ADD COLUMN deleted BOOLEAN DEFAULT 0`, (err) => {});
        } catch (e) {}
    });
}

// Helper to save message
function saveMessage(messageData) {
    const { id, remoteJid, fromMe, content, type, timestamp, status, pushName } = messageData;
    
    // First ensure chat exists (upsert-like logic)
    db.run(`INSERT OR IGNORE INTO chats (remoteJid, name, lastMessageTimestamp) VALUES (?, ?, ?)`, 
        [remoteJid, pushName || remoteJid, timestamp], 
        (err) => {
            if (err) console.error('Error creating chat:', err.message);
            
            // Update timestamp if chat existed
            db.run(`UPDATE chats SET lastMessageTimestamp = ? WHERE remoteJid = ?`, [timestamp, remoteJid]);
            
            // Also update name if provided and not just the number
            if (pushName) {
                db.run(`UPDATE chats SET name = ? WHERE remoteJid = ? AND name = remoteJid`, [pushName, remoteJid]);
            }
        }
    );

    // Insert message
    db.run(`INSERT OR REPLACE INTO messages (id, remoteJid, fromMe, content, type, timestamp, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, remoteJid, fromMe, content, type, timestamp, status || 'sent'],
        (err) => {
            if (err) console.error('Error saving message:', err.message);
        }
    );
}


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Configure Multer for temp uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: 'uploads/' });
// Serve uploaded files publicly for Evolution URL fallback
app.use('/uploads', express.static(uploadDir));

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));

const PORT = process.env.PORT || 3000;
let EVOLUTION_URL = process.env.EVOLUTION_URL;
if (EVOLUTION_URL && EVOLUTION_URL.endsWith('/')) {
    EVOLUTION_URL = EVOLUTION_URL.slice(0, -1);
}
let EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
if (EVOLUTION_API_KEY) {
    EVOLUTION_API_KEY = EVOLUTION_API_KEY.trim();
}

const INSTANCE_NAME = process.env.INSTANCE_NAME || 'kairo2';
function toRemoteJid(n) {
    return n && n.includes('@') ? n : `${n}@s.whatsapp.net`;
}

// Check config on startup
console.log('--- Server Config ---');
console.log('PORT:', PORT);
console.log('EVOLUTION_URL:', EVOLUTION_URL ? EVOLUTION_URL : 'MISSING');
console.log('EVOLUTION_API_KEY:', EVOLUTION_API_KEY ? `******${EVOLUTION_API_KEY.slice(-4)} (Length: ${EVOLUTION_API_KEY.length})` : 'MISSING');
console.log('INSTANCE_NAME:', INSTANCE_NAME);
console.log('---------------------');

// Global variable to store last webhook for debugging
let lastWebhookData = null;

// Webhook Endpoint
app.post(`/webhook/${INSTANCE_NAME}`, async (req, res) => {
  // Check API Key if needed (Evolution sends it in 'apikey' header)
  // But we might want to be permissive for now to ensure we get data
  console.log('--- Incoming Webhook ---');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  // console.log('Body:', JSON.stringify(req.body, null, 2)); // Reduced logs for cleanliness
  console.log('Event Type:', req.body.event);
  console.log('------------------------');

  const event = req.body;
  lastWebhookData = {
      timestamp: new Date().toISOString(),
      url: req.url,
      body: event,
      valid_instance: true
  };
  
  io.emit('webhook_event', event);

    // Handle CONTACTS_UPDATE or CONTACTS_UPSERT
    if ((event.event === 'CONTACTS_UPDATE' || event.event === 'CONTACTS_UPSERT') && event.data) {
        try {
            const dataArray = Array.isArray(event.data) ? event.data : [event.data];
            for (const data of dataArray) {
                if (data) {
                    const remoteJid = data.id || data.remoteJid;
                const pushName = data.pushName || data.name;
                // Add profilePicUrl as per documentation
                const profilePictureUrl = data.profilePicUrl || data.profilePictureUrl || data.picture;
                
                if (remoteJid) {
                         db.run(`INSERT OR IGNORE INTO chats (remoteJid, name, lastMessageTimestamp) VALUES (?, ?, ?)`, 
                            [remoteJid, pushName || remoteJid, Date.now()]);

                        if (pushName) {
                            db.run(`UPDATE chats SET name = ? WHERE remoteJid = ?`, [pushName, remoteJid]);
                        }
                        if (profilePictureUrl) {
                            db.run(`UPDATE chats SET profilePictureUrl = ? WHERE remoteJid = ?`, [profilePictureUrl, remoteJid]);
                        }
                        console.log(`Updated contact info for ${remoteJid}: Name=${pushName}, Pic=${Boolean(profilePictureUrl)}`);
                    }
                }
            }
        } catch (e) {
            console.error('Error handling CONTACTS_UPDATE:', e.message);
        }
    }

    // Reuse logic from permissive webhook
    if (event.event === 'messages.upsert' && event.data) {
        try {
             const msgData = event.data;
             const remoteJid = msgData.key.remoteJid;
             const fromMe = msgData.key.fromMe;
             const id = msgData.key.id;
             const pushName = msgData.pushName;
             // Add profilePicUrl as per documentation
             let profilePictureUrl = msgData.profilePicUrl || msgData.profilePictureUrl || msgData.senderPhoto; // Capture profile picture from message event
             const timestamp = msgData.messageTimestamp || Date.now();
             
             // --- FORCE PROFILE FETCH IF MISSING ---
             if (!profilePictureUrl && !fromMe && remoteJid) {
                 try {
                     // Fire and forget fetch to update DB asynchronously
                     axios.post(`${EVOLUTION_URL}/chat/fetchProfilePictureUrl/${INSTANCE_NAME}`, { number: remoteJid }, {
                        headers: { 'apikey': EVOLUTION_API_KEY }
                     }).then(resp => {
                         const fetchedUrl = resp.data?.profilePictureUrl || resp.data?.picture;
                         if (fetchedUrl) {
                             console.log(`Fetched missing profile pic for ${remoteJid}: ${fetchedUrl}`);
                             db.run(`UPDATE chats SET profilePictureUrl = ? WHERE remoteJid = ?`, [fetchedUrl, remoteJid]);
                         }
                     }).catch(() => {}); // Ignore errors in background fetch
                 } catch (e) {}
             }
             // -------------------------------------

             // Update chat info immediately if available
             if (pushName || profilePictureUrl) {
                db.run(`INSERT OR IGNORE INTO chats (remoteJid, name, lastMessageTimestamp) VALUES (?, ?, ?)`, 
                    [remoteJid, pushName || remoteJid, Date.now()]);
                
                if (pushName) db.run(`UPDATE chats SET name = ? WHERE remoteJid = ?`, [pushName, remoteJid]);
                if (profilePictureUrl) db.run(`UPDATE chats SET profilePictureUrl = ? WHERE remoteJid = ?`, [profilePictureUrl, remoteJid]);
             }
             
             let content = '';
             let type = msgData.messageType || 'unknown';
 
             if (msgData.message) {
                           if (msgData.message.conversation) {
                               content = msgData.message.conversation;
                               type = 'conversation';
                           } else if (msgData.message.extendedTextMessage) {
                               content = msgData.message.extendedTextMessage.text;
                               type = 'extendedTextMessage';
                           } else {
                               // Media Processing Helper
                               const processMedia = (mediaType, mediaObj) => {
                                    try {
                                        // Try to find base64
                                        const b64 = msgData.base64 || msgData.message.base64 || mediaObj.base64 || mediaObj.jpegThumbnail;
                                        
                                        // Determine extension
                                        const mimeMap = {
                                            'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
                                            'video/mp4': 'mp4', 'video/mpeg': 'mpeg',
                                            'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
                                            'application/pdf': 'pdf',
                                            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
                                            'application/vnd.ms-excel': 'xls',
                                            'application/msword': 'doc',
                                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
                                            'text/plain': 'txt'
                                        };
                                        const ext = mimeMap[mediaObj.mimetype] || 'bin';
                                        const fileName = `${id}.${ext}`;
                                        const filePath = path.join(uploadDir, fileName);
                                        const fileUrl = `/uploads/${fileName}`;

                                        // Save file if base64 exists
                                        if (b64) {
                                            const cleanB64 = b64.replace(/^data:.*,/, '');
                                            fs.writeFileSync(filePath, Buffer.from(cleanB64, 'base64'));
                                            console.log(`Saved media to ${filePath}`);
                                            return fileUrl;
                                        }
                                        
                                        // If no base64, check if we already downloaded it previously or if it's a URL
                                        // Note: Downloading from mediaObj.url often requires decryption keys not available here 
                                        // unless Evolution decrypted it.
                                        if (mediaObj.url && !mediaObj.url.includes('mmg.whatsapp.net')) {
                                             // If it's a public URL (e.g. from Evolution S3), we could download it.
                                             // For now, return the URL.
                                             return mediaObj.url;
                                        }

                                        return null; 
                                    } catch (e) {
                                        console.error('Error processing media:', e);
                                        return null;
                                    }
                               };

                               if (msgData.message.imageMessage) {
                                  type = 'imageMessage';
                                  const savedUrl = processMedia('image', msgData.message.imageMessage);
                                  content = savedUrl || msgData.message.imageMessage.url || '[Imagem]';
                                  // Fallback for preview if saving failed but we have thumbnail
                                  if (!savedUrl && msgData.message.imageMessage.jpegThumbnail) {
                                      content = `data:image/jpeg;base64,${msgData.message.imageMessage.jpegThumbnail}`;
                                  }

                               } else if (msgData.message.documentMessage) {
                                  type = 'documentMessage';
                                  const docMsg = msgData.message.documentMessage;
                                  const savedUrl = processMedia('document', docMsg);
                                  // Store JSON string with url and fileName for frontend
                                  const docData = {
                                      url: savedUrl || docMsg.url,
                                      fileName: docMsg.fileName || 'Documento',
                                      mimetype: docMsg.mimetype
                                  };
                                  content = JSON.stringify(docData);

                               } else if (msgData.message.audioMessage) {
                                  type = 'audioMessage';
                                  const savedUrl = processMedia('audio', msgData.message.audioMessage);
                                  content = savedUrl || msgData.message.audioMessage.url || '[Áudio]';

                               } else if (msgData.message.videoMessage) {
                                  type = 'videoMessage';
                                  const savedUrl = processMedia('video', msgData.message.videoMessage);
                                  content = savedUrl || msgData.message.videoMessage.url || '[Vídeo]';

                               } else {
                                   content = JSON.stringify(msgData.message);
                               }
                           }
                       }
 
             const messagePayload = {
                           id,
                           remoteJid,
                           fromMe,
                           content,
                           type,
                           timestamp: typeof timestamp === 'number' ? timestamp * 1000 : Date.now(),
                           status: 'received',
                           pushName
                       };
                       
                       saveMessage(messagePayload);
                       
                       // Emit processed message to frontend for immediate display with correct media URLs
                       io.emit('new_message', messagePayload);
                  } catch (e) {
                      console.error('Error saving webhook data:', e);
                  }
    }
    
    // Delivery/Read Status updates
    if ((event.event === 'SEND_MESSAGE_UPDATE' || event.event === 'messages.update') && event.data && event.data.key) {
        try {
            const id = event.data.key.id;
            const statusRaw = String(event.data.status || '').toUpperCase();
            let status = 'sent';
            if (statusRaw.includes('DELIVERY')) status = 'delivered';
            if (statusRaw.includes('READ')) status = 'read';
            if (statusRaw.includes('ERROR') || statusRaw.includes('FAIL')) status = 'error';
            const ts = event.data.messageTimestamp ? (Number(event.data.messageTimestamp) * 1000) : Date.now();
            db.run(`UPDATE messages SET status = ?, timestamp = ? WHERE id = ?`, [status, ts, id], (err) => {
                if (err) console.error('Error updating message status:', err.message);
            });
        } catch (e) {
            console.error('Error handling SEND_MESSAGE_UPDATE:', e.message);
        }
    }

    res.status(200).send('OK');
});

// Permissive Wildcard Webhook (catch wrong instance names but still process)
app.post('/webhook/*', (req, res) => {
    console.log('--- RECEIVED WEBHOOK ON WRONG ENDPOINT ---');
    console.log('URL:', req.url);
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const event = req.body;
    lastWebhookData = {
        timestamp: new Date().toISOString(),
        url: req.url,
        body: event,
        valid_instance: false,
        warning: 'Received on wrong instance endpoint'
    };

    // Emit anyway so it works even with typo
    io.emit('webhook_event', event);

    res.status(200).send('OK (Permissive Mode)');
});

// History Endpoints
app.get('/api/chats', (req, res) => {
    db.all(`
        SELECT 
            c.remoteJid, c.name, c.profilePictureUrl, c.lastMessageTimestamp,
            COALESCE(rs.lastReadTimestamp, 0) AS lastReadTimestamp
        FROM chats c
        LEFT JOIN read_state rs ON rs.remoteJid = c.remoteJid
        WHERE COALESCE(c.deleted, 0) = 0
        ORDER BY c.lastMessageTimestamp DESC
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/messages/:remoteJid', (req, res) => {
    const { remoteJid } = req.params;
    db.all(`SELECT * FROM messages WHERE remoteJid = ? AND COALESCE(deleted, 0) = 0 ORDER BY timestamp ASC`, [remoteJid], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Mark chat as read (sets lastReadTimestamp to now)
app.post('/api/chats/:remoteJid/read', (req, res) => {
    const { remoteJid } = req.params;
    const now = Date.now();
    db.run(`INSERT INTO read_state (remoteJid, lastReadTimestamp) 
            VALUES (?, ?) 
            ON CONFLICT(remoteJid) DO UPDATE SET lastReadTimestamp = excluded.lastReadTimestamp`,
        [remoteJid, now],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, remoteJid, lastReadTimestamp: now });
        }
    );
});

// Unread counts for all chats
app.get('/api/unread-counts', (req, res) => {
    const sql = `
        SELECT 
            c.remoteJid AS remoteJid,
            COALESCE(SUM(CASE 
                WHEN m.fromMe = 0 
                 AND m.timestamp > COALESCE(rs.lastReadTimestamp, 0) 
                 AND COALESCE(m.deleted, 0) = 0
                THEN 1 ELSE 0 END), 0) AS unread
        FROM chats c
        LEFT JOIN messages m ON m.remoteJid = c.remoteJid
        LEFT JOIN read_state rs ON rs.remoteJid = c.remoteJid
        WHERE COALESCE(c.deleted, 0) = 0
        GROUP BY c.remoteJid
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const map = {};
        rows.forEach(r => { map[r.remoteJid] = r.unread; });
        res.json(map);
    });
});

// Health/Debug endpoint
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        port: PORT,
        instance: INSTANCE_NAME,
        dbPath,
        evolutionUrlSet: Boolean(EVOLUTION_URL),
        apiKeySet: Boolean(EVOLUTION_API_KEY)
    });
});

app.delete('/api/chats/:remoteJid', (req, res) => {
    const { remoteJid } = req.params;
    // Soft-delete: mark as deleted without removing data
    db.serialize(() => {
        db.run(`UPDATE messages SET deleted = 1 WHERE remoteJid = ?`, [remoteJid], (err) => {
            if (err) {
                console.error('Error soft-deleting messages:', err);
            }
        });
        db.run(`UPDATE chats SET deleted = 1 WHERE remoteJid = ?`, [remoteJid], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Chat soft-deleted', changes: this.changes });
        });
    });
});


// Debug Endpoint to get last received webhook
app.get('/api/debug/last-webhook', (req, res) => {
    res.json(lastWebhookData || { message: 'No webhook received yet since server restart' });
});

// Test Webhook Simulation
app.get('/api/simulate-webhook', (req, res) => {
    const fakeEvent = {
        event: "messages.upsert",
        instance: INSTANCE_NAME,
        data: {
            key: {
                remoteJid: "5511999999999@s.whatsapp.net",
                fromMe: false,
                id: "TEST_MSG_" + Date.now()
            },
            pushName: "Test User",
            message: {
                conversation: "Isto é um teste de recebimento simulado!"
            },
            messageType: "conversation"
        },
        sender: "5511999999999@s.whatsapp.net"
    };
    
    console.log('Simulating Webhook Event...');
    io.emit('webhook_event', fakeEvent);
    res.json({ success: true, message: 'Simulated event emitted', payload: fakeEvent });
});

// Automatic Webhook Setup Endpoint
app.get('/api/setup-webhook', async (req, res) => {
    try {
        const overrideBase = req.query.baseUrl || req.query.base || req.query.url || null;
        let webhookUrl;
        if (overrideBase) {
            const base = String(overrideBase).replace(/\/$/, '');
            webhookUrl = `${base}/webhook/${INSTANCE_NAME}`;
        } else {
            const host = req.get('host');
            const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
            webhookUrl = `${protocol}://${host}/webhook/${INSTANCE_NAME}`;
        }
        
        const url = `${EVOLUTION_URL}/webhook/set/${INSTANCE_NAME}`;
        const headers = { 
            'Content-Type': 'application/json',
            'apikey': EVOLUTION_API_KEY 
        };
        
        const payload = {
            "webhook": {
                "enabled": true,
                "url": webhookUrl,
                "webhookBase64": true,
                "webhookByEvents": true,
                "events": [
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                    "CONTACTS_UPSERT",
                    "CONTACTS_UPDATE"
                ]
            }
        };

        console.log(`Setting up webhook to: ${webhookUrl}`);
        // Try the v2 endpoint structure
        const response = await axios.post(url, payload, { headers });
        
        res.json({ 
            success: true, 
            message: 'Webhook configured successfully', 
            target_webhook: webhookUrl,
            evolution_response: response.data 
        });
    } catch (error) {
        console.error('Webhook Setup Failed:', error.message);
        // Fallback: Try alternative endpoint for some Evolution versions
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response?.data,
            hint: "If 404, check if instance name is correct. If 401, check API Key."
        });
    }
});

// Test Connection Endpoint
app.get('/api/test-connection', async (req, res) => {
    try {
        const url = `${EVOLUTION_URL}/instance/fetchInstances`;
        const headers = { 'apikey': EVOLUTION_API_KEY };
        
        console.log(`Testing connection to: ${url}`);
        const response = await axios.get(url, { headers });
        
        res.json({ 
            success: true, 
            message: 'Connection successful', 
            instances: response.data 
        });
    } catch (error) {
        console.error('Connection Test Failed:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response?.data 
        });
    }
});

// Proxy Endpoint to send TEXT messages
app.post('/api/send-message', async (req, res) => {
  let url = undefined;
  try {
    const { number, text } = req.body;
    if (!number || !text) return res.status(400).json({ error: 'Missing number or text' });

    console.log(`Sending text to ${number}: ${text}`);
    
    url = `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`;
    console.log(`Target URL: ${url}`); // Debug Log

    // Headers for Evolution API
    const headers = {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
    };

    console.log(`Using API Key (prefix): ${EVOLUTION_API_KEY ? EVOLUTION_API_KEY.substring(0, 4) + '...' : 'NONE'}`);

    const response = await axios.post(url, {
      number,
      text,
      delay: 1200,
      linkPreview: false
    }, { headers });

    // Save sent message to DB
    if (response.data && response.data.key) {
        const msgId = response.data.key.id;
        const remoteJid = response.data.key.remoteJid || (number.includes('@') ? number : number + '@s.whatsapp.net');
        
        saveMessage({
            id: msgId,
            remoteJid: remoteJid,
            fromMe: true,
            content: text,
            type: 'conversation',
            timestamp: Date.now(),
            status: 'sent'
        });
    }

    res.json(response.data);
    } catch (error) {
    // Only access url if it was defined
    const targetUrl = url || 'unknown';
    console.error(`Error sending message to ${targetUrl}`);
    console.error('Status:', error.response?.status);
    console.error('Response Data:', JSON.stringify(error.response?.data || {}, null, 2));
    
    if (error.response?.status === 401) {
        console.error('CRITICAL: 401 Unauthorized. Verify EVOLUTION_API_KEY in Render Environment Variables.');
    }

    res.status(error.response?.status || 500).json({ 
        error: 'Failed to send message', 
        details: error.response?.data || error.message 
    });
  }
});

// Proxy Endpoint to send MEDIA (Image/Audio)
app.post('/api/send-media', upload.single('file'), async (req, res) => {
    let url = ''; 
    try {
        const { number, type, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            return res.status(400).json({ error: 'Missing number or file' });
        }

        console.log(`Sending media (${type}) to ${number}: ${file.originalname}`);

        const formData = new FormData();
        formData.append('number', number);
        
        if (type === 'audio') {
            url = `${EVOLUTION_URL}/sendMessage/sendWhatsAppAudio/${INSTANCE_NAME}`;
            formData.append('remoteJid', toRemoteJid(number));
            formData.append('file', fs.createReadStream(file.path), { filename: file.originalname, contentType: file.mimetype });
        } else {
            const t = (type && type.toLowerCase()) || 'image';
            url = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
            formData.append('mediatype', t);
            formData.append('mimetype', file.mimetype);
            if (caption) formData.append('caption', caption);
            formData.append('file', fs.createReadStream(file.path));
        }

        console.log(`Target URL: ${url}`); 
        
        const formHeaders = formData.getHeaders();
        const headers = {
            ...formHeaders,
            'apikey': EVOLUTION_API_KEY
        };

        let response;
        let previewUrl = null;
        try {
            response = await axios.post(url, formData, { 
                headers,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        } catch (primaryError) {
            if (type === 'audio') {
                try {
                    const fallbackForm = new FormData();
                    fallbackForm.append('number', number);
                    fallbackForm.append('mediatype', 'audio');
                    fallbackForm.append('mimetype', file.mimetype);
                    fallbackForm.append('attachment', fs.createReadStream(file.path));
                    const fbHeaders = { ...fallbackForm.getHeaders(), apikey: EVOLUTION_API_KEY };
                    const fbUrl = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
                    response = await axios.post(fbUrl, fallbackForm, { headers: fbHeaders });
                } catch (fallbackError) {
                    // Fallback to URL-based audio send
                    const host = req.get('host');
                    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
                    const fileUrl = `${protocol}://${host}/uploads/${path.basename(file.path)}`;
                    const jsonHeaders = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
                    const mediaUrl = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
                    try {
                        response = await axios.post(mediaUrl, { number, mediatype: 'audio', url: fileUrl, caption }, { headers: jsonHeaders });
                        previewUrl = fileUrl;
                    } catch (urlErr) {
                        // Final fallback: send as base64 data URL
                        const base64 = fs.readFileSync(file.path, { encoding: 'base64' });
                        const dataUrl = `data:${file.mimetype};base64,${base64}`;
                        response = await axios.post(mediaUrl, { number, mediatype: 'audio', base64: dataUrl, caption }, { headers: jsonHeaders });
                        previewUrl = dataUrl;
                    }
                }
            } else {
                // Try JSON URL-based fallback so Evolution fetches the file from our server
                try {
                    const host = req.get('host');
                    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
                    const fileUrl = `${protocol}://${host}/uploads/${path.basename(file.path)}`;
                    const jsonHeaders = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
                    const mediaUrl = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
                    try {
                        response = await axios.post(mediaUrl, { number, mediatype: 'image', url: fileUrl, caption }, { headers: jsonHeaders });
                        previewUrl = fileUrl;
                    } catch (urlFallbackError) {
                        // Final fallback: base64 data URL
                        const base64 = fs.readFileSync(file.path, { encoding: 'base64' });
                        const dataUrl = `data:${file.mimetype};base64,${base64}`;
                        response = await axios.post(mediaUrl, { number, mediatype: 'image', base64: dataUrl, caption }, { headers: jsonHeaders });
                        previewUrl = dataUrl;
                    }
                } catch (urlFallbackError) {
                    // Try additional multipart fallbacks for image/media
                const fallbacks = [
                    { url: `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, build: (p) => { const f = new FormData(); f.append('number', number); if (caption) f.append('caption', caption); f.append('file', fs.createReadStream(p)); return f; } },
                    { url: `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, build: (p) => { const f = new FormData(); f.append('number', number); if (caption) f.append('caption', caption); f.append('attachment', fs.createReadStream(p)); return f; } }
                ];
                for (const fb of fallbacks) {
                    try {
                        const fform = fb.build(file.path);
                        const fh = { ...fform.getHeaders(), apikey: EVOLUTION_API_KEY };
                        response = await axios.post(fb.url, fform, { headers: fh });
                        break;
                    } catch {}
                }
                if (!response) {
                    throw primaryError;
                }
                }
            }
        }

        // Save sent media to DB
        if (response.data && response.data.key) {
            const msgId = response.data.key.id;
            const remoteJid = response.data.key.remoteJid || (number.includes('@') ? number : number + '@s.whatsapp.net');
            const content = previewUrl || caption || (type === 'audio' ? '[Áudio Enviado]' : (type === 'sticker' ? '[Sticker Enviado]' : (type === 'video' ? '[Vídeo Enviado]' : (type === 'document' ? '[Documento Enviado]' : '[Mídia Enviada]'))));
            
            saveMessage({
                id: msgId,
                remoteJid: remoteJid,
                fromMe: true,
                content: content,
                type: type === 'audio' ? 'audioMessage' : (type === 'sticker' ? 'stickerMessage' : (type === 'video' ? 'videoMessage' : (type === 'document' ? 'documentMessage' : 'imageMessage'))),
                timestamp: Date.now(),
                status: 'sent'
            });
        }

        // Clean up temp file unless used as previewUrl (keep if serving via /uploads)
        if (!previewUrl || !previewUrl.includes('/uploads/')) {
            try { fs.unlinkSync(file.path); } catch {}
        }

        res.json(response.data);
    } catch (error) {
        // Only access url if it was defined
        const targetUrl = typeof url !== 'undefined' ? url : 'unknown';
        console.error(`Error sending media to ${targetUrl}`);
        console.error('Status:', error.response?.status);
        console.error('Response Data:', JSON.stringify(error.response?.data || {}, null, 2));

        if (req.file && req.file.path) {
            try { fs.unlinkSync(req.file.path); } catch(e) {} // cleanup
        }
        
        if (error.response?.status === 401) {
             console.error('CRITICAL: 401 Unauthorized. Verify EVOLUTION_API_KEY in Render Environment Variables.');
        }

        res.status(error.response?.status || 500).json({ 
            error: 'Failed to send media', 
            details: error.response?.data || error.message 
        });
    }
});

// Send Reaction
app.post('/api/send-reaction', async (req, res) => {
    try {
        const { remoteJid, id, emoji } = req.body;
        if (!remoteJid || !id || !emoji) return res.status(400).json({ error: 'Missing remoteJid, id or emoji' });
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { remoteJid, id, emoji };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/sendReaction/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            const url2 = `${EVOLUTION_URL}/sendMessage/sendReaction/${INSTANCE_NAME}`;
            response = await axios.post(url2, payload, { headers });
        }
        res.json(response.data || { success: true });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to send reaction', details: error.response?.data || error.message });
    }
});

// Reply (quoted) message
app.post('/api/reply-message', async (req, res) => {
    try {
        const { number, text, quotedId } = req.body;
        if (!number || !text || !quotedId) return res.status(400).json({ error: 'Missing number, text or quotedId' });
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { remoteJid: toRemoteJid(number), text, quotedMessageId: quotedId };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/replyMessage/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            try {
                const url2 = `${EVOLUTION_URL}/sendMessage/replyMessage/${INSTANCE_NAME}`;
                response = await axios.post(url2, payload, { headers });
            } catch (e2) {
                // Fallback: sendText with quotedMessageId in payload (supported by some versions)
                const url3 = `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`;
                response = await axios.post(url3, payload, { headers });
            }
        }
        if (response.data && response.data.key) {
            const msgId = response.data.key.id;
            const remoteJid = response.data.key.remoteJid || toRemoteJid(number);
            saveMessage({ id: msgId, remoteJid, fromMe: true, content: text, type: 'conversation', timestamp: Date.now(), status: 'sent' });
        }
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to reply message', details: error.response?.data || error.message });
    }
});

// Edit text message
app.post('/api/edit-message', async (req, res) => {
    try {
        const { remoteJid, id, text } = req.body;
        if (!remoteJid || !id || !text) return res.status(400).json({ error: 'Missing remoteJid, id or text' });
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { remoteJid, id, text };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/editMessage/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            try {
                const url2 = `${EVOLUTION_URL}/sendMessage/editMessage/${INSTANCE_NAME}`;
                response = await axios.post(url2, payload, { headers });
            } catch (e2) {
                // Fallback: revoke + re-send
                try {
                    const delUrl = `${EVOLUTION_URL}/message/revoke/${INSTANCE_NAME}`;
                    await axios.post(delUrl, { remoteJid, id }, { headers });
                } catch {}
                const sendUrl = `${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`;
                response = await axios.post(sendUrl, { number: remoteJid.split('@')[0], text }, { headers });
            }
        }
        db.run(`UPDATE messages SET content = ? WHERE id = ?`, [text, id], (err) => {
            if (err) console.error('Error updating edited message:', err.message);
        });
        res.json(response.data || { success: true });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to edit message', details: error.response?.data || error.message });
    }
});
// Delete for everyone
app.post('/api/delete-message', async (req, res) => {
    try {
        const { remoteJid, id } = req.body;
        if (!remoteJid || !id) return res.status(400).json({ error: 'Missing remoteJid or id' });
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { remoteJid, id };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/deleteMessage/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            try {
                const url2 = `${EVOLUTION_URL}/message/revoke/${INSTANCE_NAME}`;
                response = await axios.post(url2, payload, { headers });
            } catch (e2) {
                const url3 = `${EVOLUTION_URL}/sendMessage/deleteMessage/${INSTANCE_NAME}`;
                response = await axios.post(url3, payload, { headers });
            }
        }
        db.run(`UPDATE messages SET content = ?, type = ?, status = ? WHERE id = ?`, ['Mensagem apagada', 'conversation', 'deleted', id]);
        res.json(response.data || { success: true });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to delete message', details: error.response?.data || error.message });
    }
});

// Forward message
app.post('/api/forward-message', async (req, res) => {
    try {
        const { id, to } = req.body;
        if (!id || !to) return res.status(400).json({ error: 'Missing id or target' });
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { id, remoteJid: toRemoteJid(to) };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/forwardMessage/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            const url2 = `${EVOLUTION_URL}/sendMessage/forwardMessage/${INSTANCE_NAME}`;
            response = await axios.post(url2, payload, { headers });
        }
        res.json(response.data || { success: true });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to forward message', details: error.response?.data || error.message });
    }
});

// Send location
app.post('/api/send-location', async (req, res) => {
    try {
        const { number, latitude, longitude, name, address } = req.body;
        if (!number || typeof latitude !== 'number' || typeof longitude !== 'number') {
            return res.status(400).json({ error: 'Missing number or coordinates' });
        }
        const headers = { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY };
        const payload = { remoteJid: toRemoteJid(number), latitude, longitude, name, address };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/sendLocation/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            const url2 = `${EVOLUTION_URL}/sendMessage/sendLocation/${INSTANCE_NAME}`;
            response = await axios.post(url2, payload, { headers });
        }
        if (response.data && response.data.key) {
            const msgId = response.data.key.id;
            const remoteJid = response.data.key.remoteJid || toRemoteJid(number);
            const content = `${latitude},${longitude}`;
            saveMessage({ id: msgId, remoteJid, fromMe: true, content, type: 'locationMessage', timestamp: Date.now(), status: 'sent' });
        }
        res.json(response.data || { success: true });
    } catch (error) {
        res.status(error.response?.status || 500).json({ error: 'Failed to send location', details: error.response?.data || error.message });
    }
});
// Send Audio via base64/url JSON (for microphone recordings)
app.post('/api/send-audio', async (req, res) => {
    try {
        const { number, base64, url, caption } = req.body;
        if (!number || (!base64 && !url)) {
            return res.status(400).json({ error: 'Missing number and base64 or url' });
        }
        // Preferred path: send voice note via multipart
        let tempPath = null;
        let previewUrl = null;
        if (base64) {
            const commaIndex = base64.indexOf(';base64,');
            const mime = (commaIndex > 5) ? base64.substring(5, commaIndex) : 'audio/webm';
            const data = base64.substring(commaIndex + 8);
            const buf = Buffer.from(data, 'base64');
            const ext = mime.includes('mpeg') ? 'mp3' : (mime.split('/')[1] || 'webm');
            tempPath = path.join(uploadDir, `mic_${Date.now()}.${ext}`);
            fs.writeFileSync(tempPath, buf);
            previewUrl = `data:${mime};base64,${data}`;
        } else if (url) {
            // Prefer to let Evolution fetch by URL; but also create a local file for multipart compatibility
            try {
                const resp = await axios.get(url, { responseType: 'arraybuffer' });
                const extGuess = url.split('?')[0].split('.').pop().toLowerCase();
                const ext = ['mp3','wav','ogg','webm'].includes(extGuess) ? extGuess : 'mp3';
                tempPath = path.join(uploadDir, `mic_${Date.now()}.${ext}`);
                fs.writeFileSync(tempPath, Buffer.from(resp.data));
            } catch {}
            previewUrl = url;
        }
        let response;
        try {
            const fd = new FormData();
            fd.append('remoteJid', toRemoteJid(number));
            fd.append('file', fs.createReadStream(tempPath));
            const headers = { ...fd.getHeaders(), apikey: EVOLUTION_API_KEY };
            const target = `${EVOLUTION_URL}/sendMessage/sendWhatsAppAudio/${INSTANCE_NAME}`;
            response = await axios.post(target, fd, { headers });
        } catch (multipartErr) {
            // Fallback: JSON with url/base64 to generic sendMedia
            const headers = { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY };
            const target = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
            const payload = { number, mediatype: 'audio' };
            if (base64) payload.base64 = base64;
            if (url) payload.url = url;
            if (caption) payload.caption = caption;
            try {
                response = await axios.post(target, payload, { headers });
            } catch (jsonErr) {
                // Final fallback: if we created a local file, expose via uploads and use URL
                if (tempPath) {
                    const host = req.get('host');
                    const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
                    const fileUrl = `${protocol}://${host}/uploads/${path.basename(tempPath)}`;
                    const payload2 = { number, mediatype: 'audio', url: fileUrl };
                    response = await axios.post(target, payload2, { headers });
                    previewUrl = fileUrl;
                } else {
                    throw jsonErr;
                }
            }
        } finally {
            if (tempPath) {
                try { fs.unlinkSync(tempPath); } catch {}
            }
        }
        if (response.data && response.data.key) {
            const msgId = response.data.key.id;
            const remoteJid = response.data.key.remoteJid || (number.includes('@') ? number : number + '@s.whatsapp.net');
            const content = previewUrl || base64 || url || caption || '[Áudio Enviado]';
            saveMessage({
                id: msgId,
                remoteJid,
                fromMe: true,
                content,
                type: 'audioMessage',
                timestamp: Date.now(),
                status: 'sent'
            });
        }
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to send audio',
            details: error.response?.data || error.message
        });
    }
});

// Send Poll
app.post('/api/send-poll', async (req, res) => {
    try {
        const { number, title, options, selectableCount } = req.body;
        if (!number || !title || !Array.isArray(options) || options.length < 2) {
            return res.status(400).json({ error: 'Missing number, title or options' });
        }
        const headers = { 'apikey': EVOLUTION_API_KEY };
        const payload = { remoteJid: toRemoteJid(number), title, options, selectableCount: selectableCount || 1 };
        let response;
        try {
            const url = `${EVOLUTION_URL}/message/sendPoll/${INSTANCE_NAME}`;
            response = await axios.post(url, payload, { headers });
        } catch (e1) {
            const url2 = `${EVOLUTION_URL}/sendMessage/sendPoll/${INSTANCE_NAME}`;
            response = await axios.post(url2, payload, { headers });
        }
        if (response.data && response.data.key) {
            const msgId = response.data.key.id;
            const remoteJid = response.data.key.remoteJid || toRemoteJid(number);
            const content = JSON.stringify({ title, options });
            saveMessage({
                id: msgId,
                remoteJid,
                fromMe: true,
                content,
                type: 'pollMessage',
                timestamp: Date.now(),
                status: 'sent'
            });
        }
        res.json(response.data);
    } catch (error) {
        res.status(error.response?.status || 500).json({
            error: 'Failed to send poll',
            details: error.response?.data || error.message
        });
    }
});
// Proxy for Fetch Profile
app.post('/chat/fetchProfile/:instance', async (req, res) => {
    try {
        const { instance } = req.params;
        const { number } = req.body;
        
        // Use configured instance if provided instance is different (optional safety)
        const targetInstance = instance || INSTANCE_NAME;
        
        const url = `${EVOLUTION_URL}/chat/fetchProfile/${targetInstance}`;
        console.log(`Fetching profile for ${number} from ${url}`);
        
        const response = await axios.post(url, { number }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            }
        });
        // Fallback: if picture missing, try dedicated endpoint to fetch profile picture URL
        let pictureFromProfile = response.data?.picture || response.data?.profilePictureUrl || null;
        if (!pictureFromProfile) {
            try {
                const picUrl = `${EVOLUTION_URL}/chat/fetchProfilePictureUrl/${targetInstance}`;
                const picRes = await axios.post(picUrl, { number }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': EVOLUTION_API_KEY
                    }
                });
                pictureFromProfile = picRes.data?.profilePictureUrl || picRes.data?.picture || pictureFromProfile;
                response.data = { ...(response.data || {}), profilePictureUrl: pictureFromProfile };
            } catch (e) {
                // ignore if picture retrieval fails
            }
        }
        // Persist basic contact info to local DB
        try {
            const remoteJid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
            const name = response.data?.name || number;
            const picture = pictureFromProfile || null;
            db.run(`INSERT OR IGNORE INTO chats (remoteJid, name, lastMessageTimestamp) VALUES (?, ?, ?)`, 
                [remoteJid, name, Date.now()]);
            if (picture) {
                db.run(`UPDATE chats SET name = ?, profilePictureUrl = ? WHERE remoteJid = ?`, 
                    [name, picture, remoteJid]);
            } else {
                db.run(`UPDATE chats SET name = ? WHERE remoteJid = ?`, [name, remoteJid]);
            }
        } catch (e) {
            console.error('Persist profile failed:', e.message);
        }
        
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching profile:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to fetch profile' });
    }
});

// Proxy for Fetch Profile Picture URL
app.post('/chat/fetchProfilePictureUrl/:instance', async (req, res) => {
    try {
        const { instance } = req.params;
        const { number } = req.body;
        
        const targetInstance = instance || INSTANCE_NAME;
        
        const url = `${EVOLUTION_URL}/chat/fetchProfilePictureUrl/${targetInstance}`;
        console.log(`Fetching profile picture for ${number} from ${url}`);
        
        const response = await axios.post(url, { number }, {
            headers: {
                'Content-Type': 'application/json',
                'apikey': EVOLUTION_API_KEY
            }
        });
        
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching profile picture:', error.message);
        res.status(error.response?.status || 500).json(error.response?.data || { error: 'Failed to fetch profile picture' });
    }
});

// The "catchall" handler
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
