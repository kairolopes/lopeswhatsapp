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

  const [lastDebugEvent, setLastDebugEvent] = useState(null);

  useEffect(() => {
    socket.on('connect', () => setStatus('Connected'));
    socket.on('disconnect', () => setStatus('Disconnected'));
    socket.on('connect_error', (err) => {
        console.error('Socket Connection Error:', err);
        setStatus('Error: ' + err.message);
    });

    socket.on('webhook_event', (event) => {
      console.log('Received Event:', event);
      setLastDebugEvent(JSON.stringify(event, null, 2)); // Show on UI
      handleIncomingMessage(event);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('webhook_event');
    };
  }, [activeChatId]); // Re-subscribe when activeChatId changes to ensure fresh closure

  const handleIncomingMessage = (event) => {
    // Defensive payload check: support both event.data and event directly
    // Also handle array updates (like contacts.update)
    let msgData = event?.data || event;
    
    // If it's an array (e.g. contacts update), take the first item or handle accordingly
    if (Array.isArray(msgData)) {
        console.log('Received array data (likely contact update):', msgData);
        // For now, if it's a contact update, we might want to update the avatar if we can match the JID
        // But for chat display, we focus on messages.
        // Let's try to extract the first item if it looks like a message, otherwise return to avoid error
        if (msgData[0] && msgData[0].key) {
             msgData = msgData[0];
        } else {
             return; // Skip non-message arrays for now to prevent crash
        }
    }

    if (!msgData || !msgData.key) {
        // Only warn if it's not a standard system event we want to ignore
        if (event?.event !== 'contacts.update') {
             console.warn('Invalid message format:', msgData);
        }
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

    // Robust payload parsing for Evolution v2
    const msgContent = msgData.message || {};

    if (msgContent.conversation) {
      text = msgContent.conversation;
    } else if (msgContent.extendedTextMessage?.text) {
      text = msgContent.extendedTextMessage.text;
    } else if (msgContent.imageMessage) {
      type = 'image';
      text = msgContent.imageMessage.caption || 'Imagem';
      mediaUrl = msgContent.imageMessage.url || ''; 
    } else if (msgContent.audioMessage) {
      type = 'audio';
      text = 'Áudio';
      mediaUrl = msgContent.audioMessage.url || '';
    } else if (msgContent.documentMessage) { // Added document support
        type = 'document';
        text = msgContent.documentMessage.fileName || 'Documento';
        mediaUrl = msgContent.documentMessage.url || '';
    } else if (msgContent.videoMessage) { // Added video support
        type = 'video';
        text = msgContent.videoMessage.caption || 'Vídeo';
        mediaUrl = msgContent.videoMessage.url || '';
    }
    
    // Fallback: If text is still empty but we have a message type, try to stringify
    if (!text && !mediaUrl && Object.keys(msgContent).length > 0) {
        console.warn('Unknown message content, logging raw:', msgContent);
        // text = '[Mensagem não suportada]'; 
        // Don't show unsupported messages to avoid clutter, or show debug
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
      <div className={activeChatId ? "flex-1 flex flex-col relative" : "hidden md:flex flex-1 flex-col relative"}>
          
         {/* Debug Status Indicator */}
         <div className="absolute top-0 right-0 p-2 z-50 flex flex-col items-end pointer-events-none opacity-50 hover:opacity-100 transition-opacity">
            <div className={`flex items-center gap-2 px-2 py-1 rounded text-xs font-mono text-white ${status === 'Connected' ? 'bg-green-500' : 'bg-red-500'}`}>
                <div className={`w-2 h-2 rounded-full ${status === 'Connected' ? 'bg-white' : 'bg-white animate-pulse'}`}></div>
                {status}
            </div>
            
            <button 
                onClick={() => axios.get('/api/simulate-webhook')}
                className="mt-2 px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 pointer-events-auto"
            >
                Simular Recebimento
            </button>

            {lastDebugEvent && (
                <div className="mt-1 bg-black/80 text-green-400 text-[10px] p-2 rounded max-w-[200px] max-h-[100px] overflow-auto pointer-events-auto">
                    <div className="font-bold border-b border-green-900 mb-1">Last Webhook:</div>
                    <pre>{lastDebugEvent}</pre>
                </div>
            )}
         </div>

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
