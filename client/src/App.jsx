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
