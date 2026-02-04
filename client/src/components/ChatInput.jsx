import React, { useState, useRef } from 'react';
import { Smile, Paperclip, Mic, Send, Image as ImageIcon, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { cn } from '../lib/utils';

export const ChatInput = ({ onSend, onSendMedia }) => {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const fileInputRef = useRef(null);

  const handleSend = () => {
    if (text.trim()) {
      onSend(text);
      setText('');
      setShowEmoji(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const onEmojiClick = (emojiData) => {
    setText((prev) => prev + emojiData.emoji);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // For now, we'll just simulate sending media or pass the file object up
      // In a real app, upload to server/S3 first, then send URL.
      // Or send as base64.
      onSendMedia(file);
      e.target.value = null; // reset
    }
  };

  return (
    <div className="bg-[#f0f2f5] px-4 py-3 flex items-center gap-4 relative">
      {/* Emoji Picker Popover */}
      {showEmoji && (
        <div className="absolute bottom-16 left-4 z-50">
          <div className="fixed inset-0" onClick={() => setShowEmoji(false)} />
          <div className="relative z-50">
            <EmojiPicker onEmojiClick={onEmojiClick} width={300} height={400} />
          </div>
        </div>
      )}

      {/* Attachments */}
      <div className="flex items-center gap-3 text-gray-500">
        <button 
          onClick={() => setShowEmoji(!showEmoji)}
          className="hover:text-gray-700 transition-colors"
        >
          <Smile size={24} />
        </button>
        <button 
          onClick={() => fileInputRef.current?.click()}
          className="hover:text-gray-700 transition-colors"
        >
          <Paperclip size={24} />
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*,audio/*,video/*"
          onChange={handleFileChange}
        />
      </div>

      {/* Input Field */}
      <div className="flex-1 bg-white rounded-lg px-4 py-2 flex items-center">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Digite uma mensagem"
          className="flex-1 outline-none text-gray-700 bg-transparent"
        />
      </div>

      {/* Mic / Send */}
      <div className="flex items-center">
        {text.trim() ? (
          <button 
            onClick={handleSend}
            className="text-gray-500 hover:text-primary transition-colors"
          >
            <Send size={24} />
          </button>
        ) : (
          <button className="text-gray-500 hover:text-gray-700">
             <Mic size={24} />
          </button>
        )}
      </div>
    </div>
  );
};
