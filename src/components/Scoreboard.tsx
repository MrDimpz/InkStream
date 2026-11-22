import React from 'react';
import { Check, Crown, Pencil, UserX } from 'lucide-react';
import type { PlayerState } from '../shared/types.ts';
import { Avatar } from './Avatar.tsx';

interface ScoreboardProps {
  players: PlayerState[];
  currentUserId: string;
  isCurrentUserOwner: boolean;
  onKickPlayer: (userId: string) => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({
  players,
  currentUserId,
  isCurrentUserOwner,
  onKickPlayer,
}) => {
  return (
    <aside className="bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden h-full">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="font-display font-bold text-sm text-slate-900">Scoreboard</h2>
        <span className="font-mono-tabular text-xs text-slate-500">
          {players.length} {players.length === 1 ? 'player' : 'players'}
        </span>
      </div>

      <div className="divide-y divide-slate-100 overflow-y-auto thin-scrollbar flex-1">
        {players.map((player, idx) => {
          const isMe = player.id === currentUserId;
          const rank = idx + 1;

          return (
            <div
              key={player.id}
              className={`px-3 py-2.5 flex items-center gap-2.5 transition-colors ${
                player.hasGuessed
                  ? 'bg-emerald-50/75'
                  : player.isDrawing
                    ? 'bg-blue-50/70'
                    : isMe
                      ? 'bg-slate-50/80'
                      : 'bg-white'
              }`}
            >
              <span
                className={`font-mono-tabular text-xs font-bold w-6 text-center shrink-0 ${
                  rank === 1
                    ? 'text-amber-600'
                    : rank === 2
                      ? 'text-slate-500'
                      : rank === 3
                        ? 'text-orange-700'
                        : 'text-slate-400'
                }`}
              >
                #{rank}
              </span>

              <Avatar config={player.avatar} size={36} />

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm font-semibold truncate ${
                      isMe ? 'text-blue-700' : 'text-slate-900'
                    }`}
                  >
                    {player.username}
                  </span>
                  {isMe && <span className="text-[11px] text-slate-500 shrink-0">(You)</span>}
                  {player.isOwner && (
                    <span title="Lobby Owner" className="text-amber-500 shrink-0">
                      <Crown className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="font-mono-tabular font-semibold text-slate-700">
                    {player.score} pts
                  </span>
                  {player.roundScore > 0 && (
                    <span className="font-mono-tabular text-emerald-700 font-semibold">
                      +{player.roundScore}
                    </span>
                  )}
                  {player.isDrawing && (
                    <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                      <Pencil className="w-3 h-3" />
                      Drawing
                    </span>
                  )}
                  {player.hasGuessed && !player.isDrawing && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <Check className="w-3 h-3" />
                      Guessed
                    </span>
                  )}
                </div>
              </div>

              {isCurrentUserOwner && !isMe && (
                <button
                  type="button"
                  onClick={() => onKickPlayer(player.id)}
                  title={`Remove ${player.username}`}
                  className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                  aria-label={`Remove ${player.username}`}
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
