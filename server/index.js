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

// Webhook Endpoint
app.post(`/webhook/${INSTANCE_NAME}`, (req, res) => {
  console.log('Webhook Header:', req.headers);
  console.log('Webhook Body:', JSON.stringify(req.body, null, 2));

  const event = req.body;
  io.emit('webhook_event', event);
  res.status(200).send('OK');
});

// Proxy Endpoint to send TEXT messages
app.post('/api/send-message', async (req, res) => {
  try {
    const { number, text } = req.body;
    if (!number || !text) return res.status(400).json({ error: 'Missing number or text' });

    console.log(`Sending text to ${number}: ${text}`);
    console.log(`Target URL: ${url}`); // Debug Log

    // Headers for Evolution API
    const headers = {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
    };

    const response = await axios.post(url, {
      number,
      options: {
        delay: 1200,
        presence: "composing",
        linkPreview: false
      },
      textMessage: {
        text
      }
    }, { headers });

    res.json(response.data);
    } catch (error) {
    console.error(`Error sending message to ${url}`);
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
    try {
        const { number, type, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            return res.status(400).json({ error: 'Missing number or file' });
        }

        console.log(`Sending media (${type}) to ${number}: ${file.originalname}`);

        // Prepare FormData for Evolution API
        // Endpoint usually: /message/sendMedia/{instance}
        // It expects 'number', 'mediatype', 'mimetype', 'caption', 'attachment' (file)
        
        const url = `${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`;
        console.log(`Target URL: ${url}`); 
        
        const formData = new FormData();
        formData.append('number', number);
        formData.append('mediatype', type === 'audio' ? 'audio' : 'image');
        formData.append('mimetype', file.mimetype);
        if (caption) formData.append('caption', caption);
        formData.append('attachment', fs.createReadStream(file.path));

        const formHeaders = formData.getHeaders();
        const headers = {
            ...formHeaders,
            'apikey': EVOLUTION_API_KEY
        };

        console.log('Sending Media Request...');
        console.log('Headers (Cleaned):', JSON.stringify({ ...headers, apikey: '******' }));

        const response = await axios.post(url, formData, { 
            headers,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        // Clean up temp file
        fs.unlinkSync(file.path);

        res.json(response.data);
    } catch (error) {
        console.error(`Error sending media to ${url}`);
        console.error('Status:', error.response?.status);
        console.error('Response Data:', JSON.stringify(error.response?.data || {}, null, 2));

        if (req.file && req.file.path) fs.unlinkSync(req.file.path); // cleanup on error
        
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
