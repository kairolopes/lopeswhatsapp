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
  }, [activeChatId]); // Re-subscribe when activeChatId changes to ensure fresh closure

  const handleIncomingMessage = (event) => {
    // Defensive payload check: support both event.data and event directly
    const msgData = event?.data || event;
    if (!msgData || !msgData.key) {
        console.warn('Invalid message format:', msgData);
        return;
    }

    const remoteJid = msgData.key.remoteJid || '';
    const number = remoteJid.split('@')[0];
    const isFromMe = msgData.key.fromMe;
    
    // Try to get name and photo from different possible locations in the payload
    const pushName = msgData.pushName || msgData.sender?.name || msgData.sender?.pushName || number;
    const profilePictureUrl = msgData.sender?.profilePictureUrl || msgData.sender?.image || null;

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
      // Use existing photo if new one is null
      const existingPhoto = existingChatIndex >= 0 ? prev[existingChatIndex].avatar : null;
      
      const newChat = {
        id: number,
        name: pushName,
        avatar: profilePictureUrl || existingPhoto, 
        unread: (activeChatId === number) ? 0 : (existingChatIndex >= 0 ? prev[existingChatIndex].unread + 1 : 1),
        lastMessage: type === 'image' ? '📷 Imagem' : (type === 'audio' ? '🎤 Áudio' : text),
        lastMessageTime: newMessage.time
      };

      if (existingChatIndex >= 0) {
        const newChats = [...prev];
        newChats[existingChatIndex] = newChat;
        // Move to top
        newChats.splice(existingChatIndex, 1);
        return [newChat, ...newChats];
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
    if (!activeChatId) return;

    try {
        const type = file.type.startsWith('audio') ? 'audio' : 'image';
        const tempUrl = URL.createObjectURL(file); // Temporary preview

        const newMessage = {
            type: 'out',
            msgType: type,
            text: type === 'image' ? 'Imagem' : 'Áudio',
            mediaUrl: tempUrl,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        // Optimistic Update
        setMessages(prev => ({
            ...prev,
            [activeChatId]: [...(prev[activeChatId] || []), newMessage]
        }));

        setChats(prev => prev.map(c => 
            c.id === activeChatId 
              ? { ...c, lastMessage: type === 'image' ? '📷 Imagem' : '🎤 Áudio', lastMessageTime: newMessage.time } 
              : c
        ));

        // Upload to backend
        const formData = new FormData();
        formData.append('number', activeChatId);
        formData.append('file', file);
        formData.append('type', type);
        // caption support could be added here
        
        await axios.post('/api/send-media', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });

    } catch (error) {
        console.error('Failed to send media', error);
        alert('Erro ao enviar mídia');
    }
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
