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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
             // Generic Media (Image, Video, Document)
             url = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
             formData.append('mediatype', 'image'); // Default to image, could be video
             formData.append('mimetype', file.mimetype);
             if (caption) formData.append('caption', caption);
             formData.append('attachment', fs.createReadStream(file.path)); // Changed to 'attachment' for compatibility
        }

        console.log(`Target URL: ${url}`); 
        
        const formHeaders = formData.getHeaders();
        const headers = {
            ...formHeaders,
            'apikey': EVOLUTION_API_KEY
        };

        const response = await axios.post(url, formData, { 
            headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

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

// The "catchall" handler
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
