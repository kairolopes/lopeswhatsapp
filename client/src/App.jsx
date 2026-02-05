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
  const [replyTo, setReplyTo] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  
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
                const t = m.type;
                const content = m.content || '';
                const looksLikeUrl = typeof content === 'string' && (content.startsWith('http') || content.startsWith('data:'));
                let msgType = 'text';
                let text = content;
                let mediaUrl = looksLikeUrl ? content : '';
                if (t === 'imageMessage') { msgType = 'image'; text = looksLikeUrl ? 'Imagem' : (content || 'Imagem'); }
                else if (t === 'audioMessage') { msgType = 'audio'; text = looksLikeUrl ? 'Áudio' : (content || 'Áudio'); }
                else if (t === 'videoMessage') { msgType = 'video'; text = looksLikeUrl ? 'Vídeo' : (content || 'Vídeo'); }
                else if (t === 'documentMessage') { msgType = 'document'; text = looksLikeUrl ? 'Documento' : (content || 'Documento'); }
                else if (t === 'stickerMessage') { msgType = 'sticker'; text = 'Sticker'; }
                else if (t === 'locationMessage') { msgType = 'location'; text = content; }
                return {
                    id: m.id,
                    type: m.fromMe ? 'out' : 'in',
                    msgType,
                    text,
                    mediaUrl,
                    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    sender: m.fromMe ? 'me' : m.remoteJid,
                    pushName: m.pushName,
                    status: m.status || ''
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

    const pollListener = async (e) => {
        try {
            const { title, options } = e.detail || {};
            if (!activeChatId) return;
            const res = await axios.post('/api/send-poll', { number: activeChatId, title, options });
            const realId = res?.data?.key?.id;
            const newMessage = {
                id: realId || ('PENDING:' + Date.now()),
                type: 'out',
                msgType: 'poll',
                text: title,
                mediaUrl: '',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => ({
                ...prev,
                [activeChatId]: [...(prev[activeChatId] || []), newMessage]
            }));
        } catch (err) {
            alert('Erro ao enviar enquete');
        }
    };
    window.addEventListener('compose-poll', pollListener);

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('webhook_event');
      window.removeEventListener('compose-poll', pollListener);
    };
  }, [activeChatId]); // Re-subscribe when activeChatId changes to ensure fresh closure

  const handleIncomingMessage = async (event) => {
    // Status updates: update ticks without requiring message content
    if (event?.event === 'SEND_MESSAGE_UPDATE' && event?.data?.key?.id) {
        const id = event.data.key.id;
        const remoteJid = event.data.key.remoteJid;
        const statusRaw = String(event.data.status || '').toUpperCase();
        let status = '';
        if (statusRaw.includes('DELIVERY')) status = 'delivered';
        if (statusRaw.includes('READ')) status = 'read';
        if (statusRaw.includes('SENT')) status = 'sent';
        setMessages(prev => {
            const jid = remoteJid || activeChatId;
            const list = prev[jid] || [];
            const updated = list.map(m => (m.id === id ? { ...m, status } : m));
            return { ...prev, [jid]: updated };
        });
        return;
    }
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
    } else if (msgContent.base64 && (msgContent.imageMessage || msgContent.audioMessage)) {
      const base64 = msgContent.base64;
      if (msgContent.imageMessage) {
        type = 'image';
        text = msgContent.imageMessage.caption || 'Imagem';
      } else {
        type = 'audio';
        text = 'Áudio';
      }
      mediaUrl = typeof base64 === 'string' && base64.startsWith('data:')
        ? base64
        : `data:${type === 'image' ? 'image/jpeg' : 'audio/mpeg'};base64,${base64}`;
    } else if (msgContent.pollMessage) {
      type = 'poll';
      text = msgContent.pollMessage.title || 'Enquete';
      mediaUrl = '';
    } else if (msgContent.imageMessage) {
      type = 'image';
      text = msgContent.imageMessage.caption || 'Imagem';
      mediaUrl = msgContent.imageMessage.url || (event?.base64 || '');
      if (!mediaUrl && event?.base64 && typeof event.base64 === 'string') {
        mediaUrl = event.base64.startsWith('data:') ? event.base64 : `data:image/jpeg;base64,${event.base64}`;
      }
    } else if (msgContent.audioMessage) {
      type = 'audio';
      text = 'Áudio';
      mediaUrl = msgContent.audioMessage.url || (event?.base64 || '');
      if (!mediaUrl && event?.base64 && typeof event.base64 === 'string') {
        mediaUrl = event.base64.startsWith('data:') ? event.base64 : `data:audio/mpeg;base64,${event.base64}`;
      }
    } else if (msgContent.documentMessage) { // Added document support
        type = 'document';
        text = msgContent.documentMessage.fileName || 'Documento';
        mediaUrl = msgContent.documentMessage.url || '';
    } else if (msgContent.videoMessage) { // Added video support
        type = 'video';
        text = msgContent.videoMessage.caption || 'Vídeo';
        mediaUrl = msgContent.videoMessage.url || '';
    } else if (msgContent.stickerMessage) {
        type = 'sticker';
        text = 'Sticker';
        mediaUrl = msgContent.stickerMessage.url || '';
    } else if (msgContent.locationMessage) {
        type = 'location';
        const lat = msgContent.locationMessage.degreesLatitude || msgContent.locationMessage.latitude;
        const lng = msgContent.locationMessage.degreesLongitude || msgContent.locationMessage.longitude;
        text = `${lat},${lng}`;
        mediaUrl = '';
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
      pushName: pushName,
      status: isFromMe ? 'sent' : ''
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
        quoted: replyTo ? { text: replyTo.text } : undefined
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

      let res;
      if (replyTo?.id) {
        res = await axios.post('/api/reply-message', { number: activeChatId, text, quotedId: replyTo.id });
      } else {
        res = await axios.post('/api/send-message', { number: activeChatId, text });
      }
      // Reconcile optimistic with real ID if available
      const realId = res?.data?.key?.id;
      if (realId) {
        setMessages(prev => {
          const chatMessages = prev[activeChatId] || [];
          const updated = chatMessages.map(m => (m.id === pendingId ? { ...m, id: realId } : m));
          return { ...prev, [activeChatId]: updated };
        });
      }
      setReplyTo(null);
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
        const isSticker = /\.webp$/i.test(file.name) && file.type === 'image/webp';
        const type = file.type.startsWith('audio') ? 'audio' : (file.type.startsWith('video') ? 'video' : (file.type.startsWith('application') ? 'document' : (isSticker ? 'sticker' : 'image')));
        const tempUrl = URL.createObjectURL(file); // Temporary preview

        const pendingId = 'PENDING:' + Date.now();
        const newMessage = {
            id: pendingId,
            type: 'out',
            msgType: type,
            text: type === 'image' ? 'Imagem' : (type === 'audio' ? 'Áudio' : (type === 'video' ? 'Vídeo' : (type === 'document' ? 'Documento' : 'Sticker'))),
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
              ? { ...c, lastMessage: type === 'image' ? '📷 Imagem' : (type === 'audio' ? '🎤 Áudio' : (type === 'video' ? '🎬 Vídeo' : (type === 'document' ? '📄 Documento' : '😀 Sticker'))), lastMessageTime: newMessage.time } 
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

  const handleReactMessage = async (message, emoji) => {
    try {
      const remoteJid = activeChatId;
      await axios.post('/api/send-reaction', { remoteJid, id: message.id, emoji });
      setMessages(prev => {
        const list = prev[remoteJid] || [];
        const updated = list.map(m => (m.id === message.id ? { ...m, reaction: emoji } : m));
        return { ...prev, [remoteJid]: updated };
      });
    } catch (e) {
      alert('Erro ao reagir');
    }
  };

  const handleDeleteMessage = async (message) => {
    try {
      const remoteJid = activeChatId;
      await axios.post('/api/delete-message', { remoteJid, id: message.id });
      setMessages(prev => {
        const list = prev[remoteJid] || [];
        const updated = list.map(m => (m.id === message.id ? { ...m, msgType: 'text', type: 'in', text: 'Mensagem apagada', status: 'deleted', mediaUrl: '' } : m));
        return { ...prev, [remoteJid]: updated };
      });
    } catch (e) {
      alert('Erro ao apagar');
    }
  };

  const handleForwardMessage = async (message) => {
    try {
      const to = window.prompt('Encaminhar para número (com DDI/DDI):');
      if (!to) return;
      await axios.post('/api/forward-message', { id: message.id, to });
      alert('Mensagem encaminhada');
    } catch (e) {
      alert('Erro ao encaminhar');
    }
  };

  const handleSendLocation = async () => {
    if (!activeChatId) return;
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
      }).then(async (pos) => {
        const { latitude, longitude } = pos.coords;
        const res = await axios.post('/api/send-location', { number: activeChatId, latitude, longitude });
        const realId = res?.data?.key?.id;
        const text = `${latitude},${longitude}`;
        const pendingId = 'PENDING:' + Date.now();
        const newMessage = { id: realId || pendingId, type: 'out', msgType: 'location', text, mediaUrl: '', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        setMessages(prev => ({ ...prev, [activeChatId]: [...(prev[activeChatId] || []), newMessage] }));
      });
    } catch (e) {
      alert('Erro ao enviar localização');
    }
  };
  
  const handleReplyMessage = (message) => {
    setReplyTo({ id: message.id, text: message.text });
  };
  const handleCancelReply = () => setReplyTo(null);
  
  const handleEditMessage = async (message) => {
    try {
      const newText = window.prompt('Editar mensagem:', message.text);
      if (!newText || newText === message.text) return;
      await axios.post('/api/edit-message', { remoteJid: activeChatId, id: message.id, text: newText });
      setMessages(prev => {
        const list = prev[activeChatId] || [];
        const updated = list.map(m => (m.id === message.id ? { ...m, text: newText } : m));
        return { ...prev, [activeChatId]: updated };
      });
    } catch (e) {
      alert('Erro ao editar');
    }
  };
  
  const handleToggleSelect = (message) => {
    setSelectionMode(true);
    setSelectedIds(prev => prev.includes(message.id) ? prev.filter(id => id !== message.id) : [...prev, message.id]);
  };
  const handleBulkDelete = async () => {
    try {
      for (const id of selectedIds) {
        await axios.post('/api/delete-message', { remoteJid: activeChatId, id });
      }
      setMessages(prev => {
        const list = prev[activeChatId] || [];
        const updated = list.map(m => (selectedIds.includes(m.id) ? { ...m, msgType: 'text', type: 'in', text: 'Mensagem apagada', status: 'deleted', mediaUrl: '' } : m));
        return { ...prev, [activeChatId]: updated };
      });
      setSelectedIds([]);
      setSelectionMode(false);
    } catch (e) {
      alert('Erro no apagar em massa');
    }
  };
  const handleBulkForward = async () => {
    try {
      const to = window.prompt('Encaminhar selecionadas para número:');
      if (!to) return;
      for (const id of selectedIds) {
        await axios.post('/api/forward-message', { id, to });
      }
      setSelectedIds([]);
      setSelectionMode(false);
      alert('Selecionadas encaminhadas');
    } catch (e) {
      alert('Erro no encaminhar em massa');
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
            // Enrich contact if needed
            try {
                const current = chats.find(c => c.id === id);
                const isNumber = !current?.name || current?.name === id;
                if (isNumber || !current?.avatar) {
                    const numberOnly = String(id).split('@')[0];
                    const res = await axios.post(`/chat/fetchProfile/kairo2`, { number: numberOnly });
                    const updated = {
                        id,
                        name: res.data?.name || current?.name || id,
                        avatar: res.data?.picture || res.data?.profilePictureUrl || current?.avatar || null,
                        unread: current?.unread || 0,
                        lastMessage: current?.lastMessage || '...',
                        lastMessageTime: current?.lastMessageTime || ''
                    };
                    setChats(prev => prev.map(c => c.id === id ? updated : c));
                }
            } catch(e) {}
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
          

         <div className="flex flex-1 h-full overflow-hidden">
            <ChatWindow 
              chat={activeChat}
              messages={activeChatId ? (messages[activeChatId] || []) : []}
              onBack={() => setActiveChatId(null)}
              onSend={handleSendMessage}
              onSendMedia={handleSendMedia}
              onSendAudio={handleSendAudio}
              onSendLocation={handleSendLocation}
            replyTo={replyTo}
            onCancelReply={handleCancelReply}
              onReactMessage={handleReactMessage}
              onDeleteMessage={handleDeleteMessage}
              onForwardMessage={handleForwardMessage}
            selectable={selectionMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onBulkDelete={handleBulkDelete}
            onBulkForward={handleBulkForward}
            onReplyMessage={handleReplyMessage}
            onEditMessage={handleEditMessage}
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
