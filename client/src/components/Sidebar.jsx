import React from 'react';
import { Search, MoreVertical, MessageSquarePlus, Users } from 'lucide-react';
import { cn } from '../lib/utils';

export const Sidebar = ({ 
  chats, 
  activeChatId, 
  onSelectChat, 
  currentUser,
  className 
}) => {
  return (
    <div className={cn("flex flex-col h-full bg-white border-r border-gray-300", className)}>
      {/* Header */}
      <div className="bg-[#f0f2f5] h-[60px] px-4 flex items-center justify-between shrink-0">
        <div className="w-10 h-10 rounded-full bg-gray-300 overflow-hidden cursor-pointer">
           {/* User Avatar Placeholder */}
           <img src="https://ui-avatars.com/api/?name=Me&background=random" alt="Me" />
        </div>
        
        <div className="flex gap-4 text-gray-600">
           <Users size={24} className="cursor-pointer" />
           <MessageSquarePlus size={24} className="cursor-pointer" />
           <MoreVertical size={24} className="cursor-pointer" />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-200">
         <div className="bg-[#f0f2f5] rounded-lg flex items-center px-3 py-1.5">
            <Search size={18} className="text-gray-500 mr-3" />
            <input 
              type="text" 
              placeholder="Pesquisar ou começar uma nova conversa" 
              className="bg-transparent border-none outline-none text-sm w-full"
            />
         </div>
      </div>

      {/* Chat List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
         {chats.map((chat) => (
           <div 
             key={chat.id}
             onClick={() => onSelectChat(chat.id)}
             className={cn(
               "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#f5f6f6] transition-colors border-b border-gray-100",
               activeChatId === chat.id && "bg-[#f0f2f5]"
             )}
           >
             <div className="relative shrink-0">
                <img 
                  src={chat.avatar || `https://ui-avatars.com/api/?name=${chat.name || chat.id}&background=random`} 
                  alt={chat.name} 
                  className="w-12 h-12 rounded-full object-cover"
                />
             </div>
             
             <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                   <h3 className="text-gray-900 font-medium truncate text-base">
                     {chat.name || chat.id}
                   </h3>
                   <span className="text-xs text-gray-500 shrink-0">
                     {chat.lastMessageTime}
                   </span>
                </div>
                <div className="flex justify-between items-center">
                   <p className="text-sm text-gray-600 truncate">
                     {chat.lastMessage}
                   </p>
                   {chat.unread > 0 && (
                     <span className="bg-[#25d366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                       {chat.unread}
                     </span>
                   )}
                </div>
             </div>
           </div>
         ))}
         
         {chats.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm">
               Nenhuma conversa ainda.
            </div>
         )}
      </div>
    </div>
  );
};
