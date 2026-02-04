import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { formatPhone } from './lib/utils';

const socket = io();

function App() {
  const [status, setStatus] = useState('Disconnected');
  const [activeChatId, setActiveChatId] = useState(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  
  // State for Chats (Contacts)
  // Format: { id: string (number), name: string, avatar: string, unread: number, lastMessage: string, lastMessageTime: string }
  const [chats, setChats] = useState([]);

  // State for Messages
  // Format: { [chatId]: Array<Message> }
  const [messages, setMessages] = useState({});

  const [lastDebugEvent, setLastDebugEvent] = useState(null);

  // Load Chats on Mount
  useEffect(() => {
    const fetchChats = async () => {
        try {
            const [res, countsRes] = await Promise.all([
                axios.get('/api/chats'),
                axios.get('/api/unread-counts')
            ]);
            const counts = countsRes.data || {};
            const formattedChats = res.data.map(c => ({
                id: c.remoteJid,
                name: c.name || c.remoteJid,
                avatar: c.profilePictureUrl,
                unread: counts[c.remoteJid] || 0,
                lastMessage: '...',
                lastMessageTime: c.lastMessageTimestamp 
                    ? new Date(c.lastMessageTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : ''
            }));
            setChats(formattedChats);
        } catch (err) {
            console.error('Error fetching chats:', err);
        }
    };
    fetchChats();
  }, []);

  // Load Messages when Chat is Active
  useEffect(() => {
    if (!activeChatId) return;

    const fetchMessages = async () => {
        try {
            const res = await axios.get(`/api/messages/${activeChatId}`);
            const formattedMessages = res.data.map(m => {
                const isImage = m.type === 'imageMessage';
                const isAudio = m.type === 'audioMessage';
                const content = m.content || '';
                const looksLikeUrl = typeof content === 'string' && (content.startsWith('http') || content.startsWith('data:'));
                return {
                    id: m.id,
                    type: m.fromMe ? 'out' : 'in',
                    msgType: isImage ? 'image' : (isAudio ? 'audio' : 'text'),
                    text: isImage ? (looksLikeUrl ? 'Imagem' : content || 'Imagem') 
                         : (isAudio ? (looksLikeUrl ? 'Áudio' : content || 'Áudio') : content),
                    mediaUrl: looksLikeUrl ? content : '',
                    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    sender: m.fromMe ? 'me' : m.remoteJid,
                    pushName: m.pushName
                };
            });
            
            // Adjust content based on type for display
            const processedMessages = formattedMessages.map(m => {
                 if (m.msgType === 'image' && m.text.includes('http')) {
                      // If content is URL (future improvement)
                 }
                 return m;
            });

            setMessages(prev => ({
                ...prev,
                [activeChatId]: processedMessages
            }));
        } catch (err) {
            console.error('Error fetching messages:', err);
        }
    };
    fetchMessages();
  }, [activeChatId]);

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

  const handleIncomingMessage = async (event) => {
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
    const msgId = msgData.key.id;
    
    // Try to get name and photo from different possible locations in the payload
    let pushName = msgData.pushName || msgData.sender?.name || msgData.sender?.pushName || number;
    let profilePictureUrl = msgData.sender?.profilePictureUrl || msgData.sender?.image || null;

    // FETCH PROFILE ENRICHMENT
    // If we don't have a picture or if the name is just the number, try to fetch from API
    // We only do this for incoming messages to avoid spamming on self-messages, 
    // though for a real app we might want it for everyone.
    if (!isFromMe) {
        try {
            // Check if we already have this chat and if it has a photo
            const existingChat = chats.find(c => c.id === number);
            
            // Fetch if:
            // 1. It's a new chat
            // 2. OR existing chat has no avatar
            // 3. OR name is just the number
            if (!existingChat || !existingChat.avatar || existingChat.name === number) {
                console.log(`Fetching profile for ${number}...`);
                // Use 'kairo2' or default instance. Ideally this should be dynamic or env based
                // For now we assume the server route handles the instance mapping or we pass a placeholder
                const res = await axios.post(`/chat/fetchProfile/kairo2`, { number });
                
                if (res.data) {
                    if (res.data.name) pushName = res.data.name;
                    // Fallback to profilePictureUrl if picture is not present
                    if (res.data.picture) {
                        profilePictureUrl = res.data.picture;
                    } else if (res.data.profilePictureUrl) {
                        profilePictureUrl = res.data.profilePictureUrl;
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching profile enrichment:', err);
        }
    }

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
      id: msgId,
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
      const chatMessages = prev[remoteJid] || [];
      // Dedup by id
      if (msgId && chatMessages.some(m => m.id === msgId)) return prev;
      // If optimistic pending exists for outgoing message, replace it
      let replaced = false;
      const updated = chatMessages.map(m => {
        if (!replaced && m.type === 'out' && (!m.id || String(m.id).startsWith('PENDING')) && isFromMe) {
          replaced = true;
          return newMessage;
        }
        return m;
      });
      const finalList = replaced ? updated : [...chatMessages, newMessage];
      return { ...prev, [remoteJid]: finalList };
    });

    // Update Chats List
    setChats((prev) => {
      const existingChatIndex = prev.findIndex(c => c.id === remoteJid);
      // Use existing photo if new one is null
      const existingPhoto = existingChatIndex >= 0 ? prev[existingChatIndex].avatar : null;
      
      const newChat = {
        id: remoteJid,
        name: pushName,
        avatar: profilePictureUrl || existingPhoto, 
        unread: (activeChatId === remoteJid) ? 0 : (existingChatIndex >= 0 ? prev[existingChatIndex].unread + 1 : 1),
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
      const pendingId = 'PENDING:' + Date.now();
      const newMessage = {
        id: pendingId,
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

      const res = await axios.post('/api/send-message', {
        number: activeChatId,
        text: text
      });
      // Reconcile optimistic with real ID if available
      const realId = res?.data?.key?.id;
      if (realId) {
        setMessages(prev => {
          const chatMessages = prev[activeChatId] || [];
          const updated = chatMessages.map(m => (m.id === pendingId ? { ...m, id: realId } : m));
          return { ...prev, [activeChatId]: updated };
        });
      }
      // Mark chat as read after send
      try { await axios.post(`/api/chats/${activeChatId}/read`); } catch(e) {}
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

        const pendingId = 'PENDING:' + Date.now();
        const newMessage = {
            id: pendingId,
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
        
        const res = await axios.post('/api/send-media', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        const realId = res?.data?.key?.id;
        if (realId) {
            setMessages(prev => {
                const chatMessages = prev[activeChatId] || [];
                const updated = chatMessages.map(m => (m.id === pendingId ? { ...m, id: realId } : m));
                return { ...prev, [activeChatId]: updated };
            });
        }
        try { await axios.post(`/api/chats/${activeChatId}/read`); } catch(e) {}

    } catch (error) {
        console.error('Failed to send media', error);
        alert('Erro ao enviar mídia');
    }
  };

  const handleSendAudio = async (blob) => {
    if (!activeChatId) return;
    try {
      const tempUrl = URL.createObjectURL(blob);
      const pendingId = 'PENDING:' + Date.now();
      const newMessage = {
        id: pendingId,
        type: 'out',
        msgType: 'audio',
        text: 'Áudio',
        mediaUrl: tempUrl,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), newMessage]
      }));
      setChats(prev => prev.map(c => 
        c.id === activeChatId 
          ? { ...c, lastMessage: '🎤 Áudio', lastMessageTime: newMessage.time } 
          : c
      ));
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const dataUrl = `data:${blob.type || 'audio/webm'};base64,${base64}`;
      const res = await axios.post('/api/send-audio', { number: activeChatId, base64: dataUrl, caption: 'Áudio' });
      const realId = res?.data?.key?.id;
      if (realId) {
        setMessages(prev => {
          const chatMessages = prev[activeChatId] || [];
          const updated = chatMessages.map(m => (m.id === pendingId ? { ...m, id: realId } : m));
          return { ...prev, [activeChatId]: updated };
        });
      }
      try { await axios.post(`/api/chats/${activeChatId}/read`); } catch(e) {}
    } catch (error) {
      console.error('Failed to send audio', error);
      alert('Erro ao enviar áudio');
    }
  };

  const handleDeleteChat = async () => {
    if (!activeChatId) return;
    if (!window.confirm('Tem certeza que deseja apagar esta conversa? Somente você pode fazer isso.')) return;

    try {
        await axios.delete(`/api/chats/${activeChatId}`);
        
        // Update State
        setChats(prev => prev.filter(c => c.id !== activeChatId));
        setMessages(prev => {
            const newMessages = { ...prev };
            delete newMessages[activeChatId];
            return newMessages;
        });
        
        setActiveChatId(null);
        setShowProfileInfo(false);
    } catch (err) {
        console.error('Error deleting chat:', err);
        alert('Erro ao apagar conversa');
    }
  };

  const activeChat = chats.find(c => c.id === activeChatId);
  const [showProfileInfo, setShowProfileInfo] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#eef1f4]">
      {/* Sidebar - Hidden on mobile if chat is active */}
      <Sidebar 
        chats={chats} 
        activeChatId={activeChatId} 
        onSelectChat={async (id) => { 
            setActiveChatId(id); 
            setShowProfileInfo(false); 
            try { await axios.post(`/api/chats/${id}/read`); } catch(e) {}
            // refresh unread counts
            try {
                const countsRes = await axios.get('/api/unread-counts');
                const counts = countsRes.data || {};
                setChats(prev => prev.map(c => ({ ...c, unread: counts[c.id] || 0 })));
            } catch(e) {}
        }}
        showUnreadOnly={showUnreadOnly}
        onToggleUnread={() => setShowUnreadOnly(v => !v)}
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

            <button 
                onClick={async () => {
                    try {
                        const res = await axios.get('/api/debug/last-webhook');
                        setLastDebugEvent(JSON.stringify(res.data, null, 2));
                    } catch (e) {
                        alert('Erro ao buscar log: ' + e.message);
                    }
                }}
                className="mt-2 px-2 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 pointer-events-auto"
            >
                Verificar Webhook Real
            </button>

            {lastDebugEvent && (
                <div className="mt-1 bg-black/80 text-green-400 text-[10px] p-2 rounded max-w-[200px] max-h-[100px] overflow-auto pointer-events-auto">
                    <div className="font-bold border-b border-green-900 mb-1">Last Webhook:</div>
                    <pre>{lastDebugEvent}</pre>
                </div>
            )}
         </div>

         <div className="flex flex-1 h-full overflow-hidden">
            <ChatWindow 
              chat={activeChat}
              messages={activeChatId ? (messages[activeChatId] || []) : []}
              onBack={() => setActiveChatId(null)}
              onSend={handleSendMessage}
              onSendMedia={handleSendMedia}
        onSendAudio={handleSendAudio}
              onHeaderClick={() => setShowProfileInfo(!showProfileInfo)}
              className="flex-1 h-full"
            />
            
            {/* Profile Info Sidebar */}
            {showProfileInfo && activeChat && (
                <div className="w-[300px] bg-white border-l border-gray-200 flex flex-col h-full animate-in slide-in-from-right duration-300">
                    <div className="h-[60px] bg-[#f0f2f5] px-4 flex items-center gap-4 border-b border-gray-300">
                        <button onClick={() => setShowProfileInfo(false)} className="text-gray-600">
                           <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        <span className="font-medium text-gray-700">Dados do contato</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center bg-[#efeae2]">
                        <div className="w-48 h-48 rounded-full overflow-hidden mb-4 shadow-lg bg-white">
                             <img 
                               src={activeChat.avatar || `https://ui-avatars.com/api/?name=${activeChat.name || activeChat.id}&background=random`} 
                               alt={activeChat.name} 
                               className="w-full h-full object-cover"
                             />
                        </div>
                        <h2 className="text-xl font-medium text-gray-900 mb-1">{activeChat.name}</h2>
                        <p className="text-gray-500 mb-6">{formatPhone(activeChat.id)}</p>
                        
                        <div className="w-full bg-white p-4 rounded shadow-sm">
                            <h3 className="text-sm text-green-600 font-medium mb-1">Recado</h3>
                            <p className="text-gray-800">Disponível</p>
                        </div>

                        <button 
                            onClick={handleDeleteChat}
                            className="mt-6 w-full py-2 bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            Apagar Conversa
                        </button>
                    </div>
                </div>
            )}
         </div>
      </div>
    </div>
  );
}

export default App;
