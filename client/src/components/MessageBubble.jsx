import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck, Smile, Trash2, Forward, Reply, Edit, Square, CheckSquare } from 'lucide-react';

export const MessageBubble = ({ message, isOwn, onReact, onDelete, onForward, onReply, onEdit, selectable, selected, onToggleSelect }) => {
  const [showReactions, setShowReactions] = useState(false);
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
          {message.quoted && (
            <div className="mb-1 text-xs text-gray-600 border-l-2 border-gray-300 pl-2">
              Respondendo: {message.quoted.text?.slice(0, 100) || 'Mensagem'}
            </div>
          )}
          {message.msgType === 'image' && (
            <div className="mb-2">
              <img 
                src={message.mediaUrl || message.text} 
                alt="Image" 
                className="rounded-md max-h-64 object-cover" 
              />
              {message.caption && <p className="mt-1">{message.caption}</p>}
            </div>
          )}
          
          {message.msgType === 'audio' && (
             <audio controls className="w-full min-w-[200px] h-10" src={message.mediaUrl}>
             </audio>
          )}

          {message.msgType === 'video' && (
            <video controls className="w-full max-h-64 rounded-md" src={message.mediaUrl}></video>
          )}

          {message.msgType === 'document' && (
            <>
              {String(message.mediaUrl || '').toLowerCase().endsWith('.pdf') ? (
                <iframe title="PDF" src={message.mediaUrl} className="w-full h-64 rounded border" />
              ) : (
                <a className="text-primary underline" href={message.mediaUrl} target="_blank" rel="noreferrer">Abrir documento</a>
              )}
            </>
          )}

          {message.msgType === 'sticker' && (
            <img src={message.mediaUrl} alt="Sticker" className="h-32 w-32 object-contain" />
          )}

          {message.msgType === 'location' && (
            <a className="text-primary underline" href={`https://www.google.com/maps?q=${message.text}`} target="_blank" rel="noreferrer">Ver localização</a>
          )}

          {message.msgType === 'poll' && (
            <div className="mb-2">
              <div className="font-semibold mb-1">{message.text}</div>
              {/* options list not interactive */}
              {Array.isArray(message.options) && message.options.length > 0 && (
                 <div className="flex flex-wrap gap-2">
                   {message.options.map((opt, idx) => (
                     <span key={idx} className="px-2 py-1 text-xs bg-gray-100 rounded border border-gray-200">{opt}</span>
                   ))}
                 </div>
              )}
            </div>
          )}

          {(!message.msgType || message.msgType === 'text') && (
            <p className="whitespace-pre-wrap">{message.text}</p>
          )}
          
          {message.reaction && (
            <div className="mt-1 text-lg">{message.reaction}</div>
          )}
        </div>

        {/* Meta (Time & Status) */}
        <div className="flex items-center justify-end gap-1 mt-1 select-none">
          <span className="text-[10px] text-gray-500">
            {message.time || format(new Date(), 'HH:mm')}
          </span>
          {isOwn && (
            <>
              {(!message.status || message.status === 'sent') && (
                <span className="text-gray-400">
                  <Check size={14} />
                </span>
              )}
              {message.status === 'delivered' && (
                <span className="text-gray-500">
                  <CheckCheck size={14} />
                </span>
              )}
              {message.status === 'read' && (
                <span className="text-blue-500">
                  <CheckCheck size={14} />
                </span>
              )}
            </>
          )}
        </div>
        
        <div className="flex items-center gap-2 mt-1">
          {selectable && (
            <button className={cn("text-gray-500 hover:text-gray-700")} onClick={() => onToggleSelect && onToggleSelect(message)}>
              {selected ? <CheckSquare size={16} /> : <Square size={16} />}
            </button>
          )}
          <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowReactions(v => !v)}>
            <Smile size={16} />
          </button>
          <button className="text-gray-500 hover:text-gray-700" onClick={() => onReply && onReply(message)}>
            <Reply size={16} />
          </button>
          {isOwn && message.type === 'out' && message.msgType === 'text' && (
            <button className="text-gray-500 hover:text-gray-700" onClick={() => onEdit && onEdit(message)}>
              <Edit size={16} />
            </button>
          )}
          {isOwn && (
            <button className="text-gray-500 hover:text-red-600" onClick={() => onDelete && onDelete(message)}>
              <Trash2 size={16} />
            </button>
          )}
          <button className="text-gray-500 hover:text-gray-700" onClick={() => onForward && onForward(message)}>
            <Forward size={16} />
          </button>
        </div>
        {showReactions && (
          <div className="mt-1 flex gap-2">
            {['👍','❤️','😂','😮','😢','🙏'].map(e => (
              <button key={e} className="text-xl" onClick={() => { setShowReactions(false); onReact && onReact(message, e); }}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
