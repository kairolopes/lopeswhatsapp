import React from 'react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck } from 'lucide-react';

export const MessageBubble = ({ message, isOwn }) => {
  return (
    <div className={cn("flex w-full mb-2", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[80%] sm:max-w-[60%] rounded-lg p-2 shadow-sm",
          isOwn ? "bg-[#d9fdd3] rounded-tr-none" : "bg-white rounded-tl-none"
        )}
      >
        {/* Sender Name (only for group chats usually, but useful if context needed) */}
        {!isOwn && message.pushName && (
          <div className="text-xs font-bold text-orange-800 mb-1">
            {message.pushName}
          </div>
        )}

        {/* Content */}
        <div className="text-sm text-gray-800 break-words">
          {message.type === 'image' && (
            <div className="mb-2">
              <img 
                src={message.mediaUrl || message.text} 
                alt="Image" 
                className="rounded-md max-h-64 object-cover" 
              />
              {message.caption && <p className="mt-1">{message.caption}</p>}
            </div>
          )}
          
          {message.type === 'audio' && (
             <audio controls className="w-full min-w-[200px] h-10" src={message.mediaUrl}>
             </audio>
          )}

          {(!message.type || message.type === 'text' || message.type === 'in' || message.type === 'out') && (
            <p className="whitespace-pre-wrap">{message.text}</p>
          )}
        </div>

        {/* Meta (Time & Status) */}
        <div className="flex items-center justify-end gap-1 mt-1 select-none">
          <span className="text-[10px] text-gray-500">
            {message.time || format(new Date(), 'HH:mm')}
          </span>
          {isOwn && (
             <span className="text-blue-500">
                <CheckCheck size={14} />
             </span>
          )}
        </div>
      </div>
    </div>
  );
};
