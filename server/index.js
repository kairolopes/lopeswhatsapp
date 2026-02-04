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
app.use(express.json());

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
app.post(`/webhook/${INSTANCE_NAME}`, (req, res) => {
  console.log('--- Incoming Webhook ---');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  console.log('------------------------');

  const event = req.body;
  lastWebhookData = {
      timestamp: new Date().toISOString(),
      url: req.url,
      body: event,
      valid_instance: true
  };
  
  io.emit('webhook_event', event);

    // Reuse logic from permissive webhook
    if (event.event === 'messages.upsert' && event.data) {
        try {
             const msgData = event.data;
             const remoteJid = msgData.key.remoteJid;
             const fromMe = msgData.key.fromMe;
             const id = msgData.key.id;
             const pushName = msgData.pushName;
             const timestamp = msgData.messageTimestamp || Date.now();
             
             let content = '';
             let type = msgData.messageType || 'unknown';
 
             if (msgData.message) {
                 if (msgData.message.conversation) {
                     content = msgData.message.conversation;
                     type = 'conversation';
                 } else if (msgData.message.extendedTextMessage) {
                     content = msgData.message.extendedTextMessage.text;
                     type = 'extendedTextMessage';
                 } else if (msgData.message.imageMessage) {
                     content = msgData.message.imageMessage.caption || '[Imagem]';
                     type = 'imageMessage';
                 } else if (msgData.message.audioMessage) {
                     content = '[Áudio]';
                     type = 'audioMessage';
                 } else {
                     content = JSON.stringify(msgData.message);
                 }
             }
 
             saveMessage({
                 id,
                 remoteJid,
                 fromMe,
                 content,
                 type,
                 timestamp: typeof timestamp === 'number' ? timestamp * 1000 : Date.now(),
                 status: 'received',
                 pushName
             });
        } catch (e) {
            console.error('Error saving webhook data:', e);
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
    db.all(`SELECT * FROM messages WHERE remoteJid = ? ORDER BY timestamp ASC`, [remoteJid], (err, rows) => {
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
                THEN 1 ELSE 0 END), 0) AS unread
        FROM chats c
        LEFT JOIN messages m ON m.remoteJid = c.remoteJid
        LEFT JOIN read_state rs ON rs.remoteJid = c.remoteJid
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
    // Transaction to delete messages and then chat
    db.serialize(() => {
        db.run(`DELETE FROM messages WHERE remoteJid = ?`, [remoteJid], (err) => {
            if (err) {
                console.error('Error deleting messages:', err);
            }
        });
        db.run(`DELETE FROM chats WHERE remoteJid = ?`, [remoteJid], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Chat deleted', changes: this.changes });
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
        // Construct the webhook URL based on the current request host (or environment variable)
        const host = req.get('host');
        const protocol = req.protocol === 'http' && host.includes('localhost') ? 'http' : 'https';
        const webhookUrl = `${protocol}://${host}/webhook/${INSTANCE_NAME}`;
        
        const url = `${EVOLUTION_URL}/webhook/set/${INSTANCE_NAME}`;
        const headers = { 
            'Content-Type': 'application/json',
            'apikey': EVOLUTION_API_KEY 
        };
        
        const payload = {
            "webhook": {
                "enabled": true,
                "url": webhookUrl,
                "webhookByEvents": false,
                "events": [
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                    "SEND_MESSAGE"
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
        
        // Handle specific media types
        if (type === 'audio') {
             // Evolution API specific for Voice Notes (PTT)
             url = `${EVOLUTION_URL}/message/sendWhatsAppAudio/${INSTANCE_NAME}`;
             formData.append('audio', fs.createReadStream(file.path));
             // Some versions allow delay/presence options here too
        } else {
             // Prefer dedicated endpoint for images when available
             const mediaType = (type && type.toLowerCase()) || 'image';
             // Default to generic sendMedia, which is widely supported
             url = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
             formData.append('mediatype', mediaType);
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
                    } catch (urlErr) {
                        // Final fallback: send as base64 data URL
                        const base64 = fs.readFileSync(file.path, { encoding: 'base64' });
                        const dataUrl = `data:${file.mimetype};base64,${base64}`;
                        response = await axios.post(mediaUrl, { number, mediatype: 'audio', base64: dataUrl, caption }, { headers: jsonHeaders });
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
                    } catch (urlFallbackError) {
                        // Final fallback: base64 data URL
                        const base64 = fs.readFileSync(file.path, { encoding: 'base64' });
                        const dataUrl = `data:${file.mimetype};base64,${base64}`;
                        response = await axios.post(mediaUrl, { number, mediatype: 'image', base64: dataUrl, caption }, { headers: jsonHeaders });
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
            const content = caption || (type === 'audio' ? '[Áudio Enviado]' : '[Mídia Enviada]');
            
            saveMessage({
                id: msgId,
                remoteJid: remoteJid,
                fromMe: true,
                content: content,
                type: type === 'audio' ? 'audioMessage' : 'imageMessage',
                timestamp: Date.now(),
                status: 'sent'
            });
        }

        // Clean up temp file
        fs.unlinkSync(file.path);

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
