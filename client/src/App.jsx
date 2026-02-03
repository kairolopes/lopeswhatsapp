import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { Send, Menu, Phone, Video, Search } from 'lucide-react';
import axios from 'axios';

// Connect to backend
const socket = io('http://localhost:3000');

function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState('Disconnected');

  useEffect(() => {
    socket.on('connect', () => setStatus('Connected'));
    socket.on('disconnect', () => setStatus('Disconnected'));

    socket.on('webhook_event', (event) => {
      console.log('New Event:', event);
      // Logic to parse Evolution API event and add to messages
      // For now, just logging and optionally dumping to UI
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('webhook_event');
    };
  }, []);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    try {
      // Mock sending to backend -> Evolution
      // await axios.post('http://localhost:3000/api/send-message', { number: '...', text: inputText });

      // Optimistic I
      setMessages([...messages, { type: 'out', text: inputText, time: new Date().toLocaleTimeString() }]);
      setInputText('');
    } catch (error) {
      console.error('Send failed', error);
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-[400px] bg-white border-r border-gray-300 flex flex-col">
        {/* Header */}
        <div className="h-[60px] bg-gray-100 flex items-center justify-between px-4 border-b border-gray-300">
          <div className="w-10 h-10 rounded-full bg-gray-300"></div>
          <div className="flex gap-4 text-gray-600">
            <Menu className="w-6 h-6" />
          </div>
        </div>
        {/* Search */}
        <div className="p-2 border-b border-gray-200">
          <div className="bg-gray-100 rounded-lg flex items-center px-4 py-2">
            <Search className="w-5 h-5 text-gray-500" />
            <input type="text" placeholder="Pesquisar ou começar uma nova conversa" className="bg-transparent ml-4 outline-none w-full text-sm" />
          </div>
        </div>
        {/* Chat List */}
        <div className="flex-1 overflow-y-auto">
          {['João da Silva', 'Maria Loja', 'Suporte TI'].map((name, i) => (
            <div key={i} className="flex items-center p-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100">
              <div className="w-12 h-12 rounded-full bg-gray-300 mr-4"></div>
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="font-semibold text-gray-800">{name}</span>
                  <span className="text-xs text-gray-500">14:02</span>
                </div>
                <p className="text-sm text-gray-500 truncate">Olá, tudo bem?</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-chat-image relative">
        {/* Chat Header */}
        <div className="h-[60px] bg-gray-100 flex items-center justify-between px-4 border-b border-gray-300 z-10 w-full">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full bg-gray-300 mr-4"></div>
            <div>
              <h2 className="font-semibold text-gray-800">João da Silva</h2>
              <p className="text-xs text-gray-500">visto por último hoje às 14:02</p>
            </div>
          </div>
          <div className="flex gap-6 text-gray-600">
            <Search className="w-6 h-6" />
            <Menu className="w-6 h-6" />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-8 bg-[#efeae2] space-y-4">
          <div className="max-w-[60%] bg-white p-2 rounded-lg shadow-sm self-start rounded-tl-none">
            <p className="text-sm text-gray-800">Olá! Como posso ajudar?</p>
            <span className="text-[10px] text-gray-500 float-right mt-1 ml-2">10:00</span>
          </div>

          <div className="max-w-[60%] bg-[#d9fdd3] p-2 rounded-lg shadow-sm self-end ml-auto rounded-tr-none">
            <p className="text-sm text-gray-800">Gostaria de saber sobre o status do meu pedido.</p>
            <span className="text-[10px] text-gray-500 float-right mt-1 ml-2">10:01</span>
          </div>

          {messages.map((msg, idx) => (
            <div key={idx} className={`max-w-[60%] p-2 rounded-lg shadow-sm ${msg.type === 'out' ? 'bg-[#d9fdd3] self-end ml-auto rounded-tr-none' : 'bg-white self-start rounded-tl-none'}`}>
              <p className="text-sm text-gray-800">{msg.text}</p>
              <span className="text-[10px] text-gray-500 float-right mt-1 ml-2">{msg.time}</span>
            </div>
          ))}
        </div>

        {/* Input Area */}
        <div className="h-[70px] bg-gray-100 flex items-center px-4 gap-4">
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            type="text"
            placeholder="Digite uma mensagem"
            className="flex-1 bg-white rounded-lg p-3 outline-none text-sm"
          />
          <button onClick={handleSend} className="text-gray-600 hover:text-gray-800">
            <Send className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
