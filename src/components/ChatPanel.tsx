import React, { useEffect, useRef, useState } from 'react';
import { Flame, Send, X } from 'lucide-react';
import type { ChatMessage, GamePhase } from '../shared/types.ts';

interface ChatPanelProps {
  messages: ChatMessage[];
  phase: GamePhase;
  isDrawer: boolean;
  hasGuessed: boolean;
  closeGuessNotice: { guess: string; message: string } | null;
  onDismissCloseGuess: () => void;
  onSendMessage: (text: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  phase,
  isDrawer,
  hasGuessed,
  closeGuessNotice,
  onDismissCloseGuess,
  onSendMessage,
}) => {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const placeholder =
    phase === 'DRAWING'
      ? isDrawer
        ? 'Chat with players (do not spoil the word)...'
        : hasGuessed
          ? 'You guessed it! Chat with other guessers...'
          : 'Type your guess here...'
      : 'Type a chat message...';

  return (
    <aside className="bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden h-full min-h-[360px] lg:min-h-0">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="font-display font-bold text-sm text-slate-900">Guesses &amp; Chat</h2>
        <span className="text-xs text-slate-500">
          {phase === 'DRAWING' && !isDrawer && !hasGuessed ? 'Guessing open' : 'Live room chat'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto thin-scrollbar px-3 py-2.5 flex flex-col gap-1.5 text-sm">
        {messages.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-8">
            Messages and guesses will appear here.
          </p>
        )}

        {messages.map((msg) => {
          if (msg.type === 'system') {
            return (
              <div key={msg.id} className="text-xs text-slate-500 py-1 px-2 bg-slate-50 rounded-md">
                {msg.text}
              </div>
            );
          }

          if (msg.type === 'correct') {
            return (
              <div
                key={msg.id}
                className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200/80 py-1.5 px-2.5 rounded-md"
              >
                {msg.text}
              </div>
            );
          }

          if (msg.type === 'guessed-chat') {
            return (
              <div
                key={msg.id}
                className="text-xs text-emerald-900 bg-emerald-50/50 py-1 px-2 rounded-md break-words"
              >
                <span className="font-semibold text-emerald-700 mr-1">
                  {msg.senderName} (guessed):
                </span>
                <span>{msg.text}</span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className="text-sm text-slate-800 px-1.5 py-0.5 break-words leading-snug"
            >
              <span className="font-semibold text-slate-900 mr-1.5">{msg.senderName}:</span>
              <span>{msg.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Private Close-Guess Banner (ONLY shown to the guesser, NEVER in shared chat!) */}
      {closeGuessNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-2.5 mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-300 flex items-center justify-between gap-2 text-xs font-semibold text-amber-900"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <Flame className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">{closeGuessNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={onDismissCloseGuess}
            aria-label="Dismiss hint"
            className="text-amber-700 hover:text-amber-950 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-2.5 border-t border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={160}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send message"
            className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </aside>
  );
};
