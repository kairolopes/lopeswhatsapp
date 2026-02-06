import React, { useState } from 'react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { Check, CheckCheck, Smile, Trash2, Forward, Reply, Edit, Square, CheckSquare, Download } from 'lucide-react';

export const MessageBubble = ({ message, isOwn, onReact, onDelete, onForward, onReply, onEdit, selectable, selected, onToggleSelect }) => {
  const [showReactions, setShowReactions] = useState(false);
  
  const handleDownload = (url, filename) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

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
            <div className="mb-2 relative group">
              <img 
                src={message.mediaUrl || message.text} 
                alt="Image" 
                className="rounded-md max-h-64 object-cover cursor-pointer bg-gray-100" 
                onClick={() => window.open(message.mediaUrl || message.text, '_blank')}
                onError={(e) => { e.target.onerror = null; e.target.src = 'https://via.placeholder.com/300x200?text=Imagem+N%C3%A3o+Carregada'; }}
              />
              <button 
                  onClick={(e) => { e.stopPropagation(); handleDownload(message.mediaUrl, `image-${message.id}.jpg`); }}
                  className="absolute bottom-2 right-2 bg-black/50 p-1.5 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                  title="Baixar Imagem"
              >
                  <Download size={16} />
              </button>
              {message.caption && <p className="mt-1">{message.caption}</p>}
            </div>
          )}
          
          {message.msgType === 'audio' && (
             <div className="flex items-center gap-2 mb-1">
                <audio controls className="w-full min-w-[220px] h-10" src={message.mediaUrl}>
                    Seu navegador não suporta áudio.
                </audio>
                <button 
                    onClick={() => handleDownload(message.mediaUrl, `audio-${message.id}.mp3`)}
                    className="p-2 text-gray-500 hover:text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                    title="Baixar Áudio"
                >
                    <Download size={16} />
                </button>
             </div>
          )}

          {message.msgType === 'video' && (
            <div className="mb-2 relative group">
                <video controls className="w-full max-h-64 rounded-md bg-black" src={message.mediaUrl}></video>
                <button 
                    onClick={() => handleDownload(message.mediaUrl, `video-${message.id}.mp4`)}
                    className="absolute top-2 right-2 bg-black/50 p-1.5 rounded text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    title="Baixar Vídeo"
                >
                    <Download size={16} />
                </button>
            </div>
          )}

          {message.msgType === 'document' && (
            <div className="flex items-center gap-3 bg-gray-50 p-3 rounded border border-gray-200 mb-2 max-w-[300px]">
                <div className="bg-red-100 p-2 rounded text-red-500 shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-medium truncate text-gray-700" title={message.text}>{message.text || 'Documento'}</p>
                    <span className="text-xs text-gray-500">Documento</span>
                </div>
                <button 
                    onClick={() => handleDownload(message.mediaUrl, message.text)} 
                    className="text-gray-500 hover:text-primary transition-colors p-2 hover:bg-gray-200 rounded-full"
                    title="Baixar Documento"
                >
                    <Download size={20} />
                </button>
            </div>
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
