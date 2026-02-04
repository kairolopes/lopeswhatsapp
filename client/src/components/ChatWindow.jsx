import React, { useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Search, Phone, Video } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { cn } from '../lib/utils';

export const ChatWindow = ({ 
  chat, 
  messages, 
  onBack, 
  onSend,
  onSendMedia,
  onHeaderClick,
  className 
}) => {
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (!chat) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full bg-[#f0f2f5] border-b-8 border-[#25d366]", className)}>
         <h1 className="text-3xl text-gray-500 font-light mb-4">LopesWhatsApp</h1>
         <p className="text-gray-500 text-sm">Selecione uma conversa para começar</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full bg-[#efeae2]", className)}>
      {/* Header */}
      <div 
        onClick={onHeaderClick}
        className="h-[60px] bg-[#f0f2f5] px-4 flex items-center justify-between shrink-0 border-b border-gray-300 cursor-pointer hover:bg-gray-50 transition-colors"
      >
         <div className="flex items-center gap-3">
            {/* Back button for mobile */}
            <button onClick={(e) => { e.stopPropagation(); onBack(); }} className="md:hidden text-gray-600">
               <ArrowLeft size={24} />
            </button>
            
            <div className="w-10 h-10 rounded-full overflow-hidden">
               <img 
                 src={chat.avatar || `https://ui-avatars.com/api/?name=${chat.name || chat.id}&background=random`} 
                 alt={chat.name} 
                 className="w-full h-full object-cover"
               />
            </div>
            
            <div className="flex flex-col justify-center">
               <h3 className="text-gray-900 font-medium leading-tight">
                 {chat.name || chat.id}
               </h3>
               <span className="text-xs text-gray-500 truncate">
                 clique para dados do contato
               </span>
            </div>
         </div>

         <div className="flex items-center gap-4 text-gray-600">
            <Video size={22} className="cursor-pointer hidden sm:block" />
            <Phone size={20} className="cursor-pointer hidden sm:block" />
            <div className="h-6 w-[1px] bg-gray-300 hidden sm:block"></div>
            <Search size={20} className="cursor-pointer" />
            <MoreVertical size={20} className="cursor-pointer" />
         </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 md:px-12 bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat bg-center">
         {messages.map((msg, idx) => (
           <MessageBubble 
             key={idx} 
             message={msg} 
             isOwn={msg.type === 'out'} 
           />
         ))}
         <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <ChatInput onSend={onSend} onSendMedia={onSendMedia} />
    </div>
  );
};
