import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import axios from 'axios';

dotenv.config();

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

const PORT = process.env.PORT || 3000;
const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

// Webhook Endpoint
app.post('/webhook/kairoteste', (req, res) => {
  console.log('Webhook Header:', req.headers);
  console.log('Webhook Body:', JSON.stringify(req.body, null, 2));

  const event = req.body;

  // Broadcast event to frontend via Socket.io
  io.emit('webhook_event', event);

  res.status(200).send('OK');
});

// Proxy Endpoint to send messages
app.post('/api/send-message', async (req, res) => {
  try {
    const { number, text } = req.body;
    if (!number || !text) return res.status(400).json({ error: 'Missing number or text' });

    // Note: Assuming 'InstanceName' usage. Ideally this should be dynamic or env var.
    // For now, we construct the URL based on user providing the BASE URL.
    // Documentation says /message/sendText/{instance}
    // We'll fallback to a default instance name if not provided, or ask user.
    // For MVP, let's hardcode a placeholder or try to get it from env.
    const instanceName = process.env.INSTANCE_NAME || 'LopesInstance';
    const url = `${EVOLUTION_URL}/message/sendText/${instanceName}`;

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
    }, {
      headers: {
        apikey: EVOLUTION_API_KEY
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Error sending message:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.get('/', (req, res) => {
  res.send('LopesWhatsApp Server is running');
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
