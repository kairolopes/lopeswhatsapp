import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';

const socket = io();

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [activeChatId, setActiveChatId] = useState(null);
  
  // State for Chats (Contacts)
  // Format: { id: string (number), name: string, avatar: string, unread: number, lastMessage: string, lastMessageTime: string }
  const [chats, setChats] = useState([]);

  // State for Messages
  // Format: { [chatId]: Array<Message> }
  const [messages, setMessages] = useState({});

  useEffect(() => {
    socket.on('connect', () => setStatus('Connected'));
    socket.on('disconnect', () => setStatus('Disconnected'));

    socket.on('webhook_event', (event) => {
      console.log('Received Event:', event);
      handleIncomingMessage(event);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('webhook_event');
    };
  }, [chats, messages]); // Dependencies might need tuning to avoid stale closures if using callbacks, but functional updates are better.

  const handleIncomingMessage = (event) => {
    const msgData = event?.data;
    if (!msgData || !msgData.key) return;

    const remoteJid = msgData.key.remoteJid || '';
    const number = remoteJid.split('@')[0];
    const isFromMe = msgData.key.fromMe;
    const pushName = msgData.pushName || number;
    
    // Determine Message Type & Content
    let text = '';
    let type = 'text';
    let mediaUrl = '';

    if (msgData.message?.conversation) {
      text = msgData.message.conversation;
    } else if (msgData.message?.extendedTextMessage?.text) {
      text = msgData.message.extendedTextMessage.text;
    } else if (msgData.message?.imageMessage) {
      type = 'image';
      text = msgData.message.imageMessage.caption || 'Imagem';
      // In a real app, you'd need to download/decrypt the media. 
      // Evolution might provide a URL or base64 if configured, or you fetch it.
      // For now we use a placeholder or check if url is present.
      mediaUrl = msgData.message.imageMessage.url || ''; 
    } else if (msgData.message?.audioMessage) {
      type = 'audio';
      text = 'Áudio';
      mediaUrl = msgData.message.audioMessage.url || '';
    }

    if (!text && !mediaUrl) return; // Unknown message type

    const newMessage = {
      type: isFromMe ? 'out' : 'in', // simplify direction
      msgType: type, // text, image, audio
      text: text,
      mediaUrl: mediaUrl,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sender: number,
      pushName: pushName
    };

    // Update Messages
    setMessages((prev) => {
      const chatMessages = prev[number] || [];
      return {
        ...prev,
        [number]: [...chatMessages, newMessage]
      };
    });

    // Update Chats List
    setChats((prev) => {
      const existingChatIndex = prev.findIndex(c => c.id === number);
      const newChat = {
        id: number,
        name: pushName,
        avatar: null, // Could fetch from event if available
        unread: (activeChatId === number) ? 0 : (existingChatIndex >= 0 ? prev[existingChatIndex].unread + 1 : 1),
        lastMessage: type === 'image' ? '📷 Imagem' : (type === 'audio' ? '🎤 Áudio' : text),
        lastMessageTime: newMessage.time
      };

      if (existingChatIndex >= 0) {
        const updatedChats = [...prev];
        updatedChats[existingChatIndex] = { ...updatedChats[existingChatIndex], ...newChat, unread: activeChatId === number ? 0 : updatedChats[existingChatIndex].unread + 1 };
        // Move to top
        updatedChats.sort((a, b) => (a.id === number ? -1 : 1));
        return updatedChats;
      } else {
        return [newChat, ...prev];
      }
    });
  };

  const handleSendMessage = async (text) => {
    if (!activeChatId) return;

    try {
      const newMessage = {
        type: 'out',
        msgType: 'text',
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      // Optimistic Update
      setMessages(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), newMessage]
      }));

      // Update Last Message in Sidebar
      setChats(prev => prev.map(c => 
        c.id === activeChatId 
          ? { ...c, lastMessage: text, lastMessageTime: newMessage.time } 
          : c
      ));

      await axios.post('/api/send-message', {
        number: activeChatId,
        text: text
      });
    } catch (error) {
      console.error('Failed to send', error);
      alert('Erro ao enviar mensagem');
    }
  };

  const handleSendMedia = async (file) => {
    // Placeholder for media sending logic
    // You would upload the file to a server, get a URL, then send to Evolution
    alert("Envio de mídia ainda não implementado no backend de exemplo.");
  };

  const activeChat = chats.find(c => c.id === activeChatId);

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef1f4]">
      {/* Sidebar - Hidden on mobile if chat is active */}
      <Sidebar 
        chats={chats} 
        activeChatId={activeChatId} 
        onSelectChat={(id) => setActiveChatId(id)}
        className={activeChatId ? "hidden md:flex w-full md:w-[400px]" : "flex w-full md:w-[400px]"}
      />

      {/* Chat Window - Hidden on mobile if no chat active */}
      <div className={activeChatId ? "flex-1 flex" : "hidden md:flex flex-1"}>
         <ChatWindow 
           chat={activeChat}
           messages={activeChatId ? (messages[activeChatId] || []) : []}
           onBack={() => setActiveChatId(null)}
           onSend={handleSendMessage}
           onSendMedia={handleSendMedia}
           className="w-full h-full"
         />
      </div>
    </div>
  );
}

export default App;
