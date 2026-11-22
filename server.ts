import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import {
  getSessionByToken,
  handleGuestLogin,
  handleLogin,
  handleLogout,
  handleRegister,
  handleUpdateProfile,
  requireAuth,
  type ActiveSession,
} from './server/auth.ts';
import { GameManager } from './server/gameManager.ts';
import { store } from './server/store.ts';
import type { RoomSettings } from './src/shared/types.ts';

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  const io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
    destroyUpgrade: false,
  });

  const gameManager = new GameManager(io);

  // --- Auth REST Routes ---
  app.post('/api/auth/register', (req, res) => {
    void handleRegister(req, res);
  });
  app.post('/api/auth/login', (req, res) => {
    void handleLogin(req, res);
  });
  app.post('/api/auth/guest', handleGuestLogin);
  app.post('/api/auth/logout', handleLogout);
  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    res.json({ user: session.user });
  });
  app.patch('/api/auth/profile', requireAuth, handleUpdateProfile);

  // --- Rooms, Analytics & TikTok Webhook REST Routes ---
  app.get('/api/rooms/public', (_req, res) => {
    res.json({ rooms: gameManager.listPublicRooms() });
  });

  app.get('/api/rooms/:roomId/analytics', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const ownerId = gameManager.getRoomOwnerId(roomId);
    if (!ownerId) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    if (ownerId !== session.user.id) {
      res.status(403).json({ error: 'Only the lobby owner can view room analytics.' });
      return;
    }
    const analytics = gameManager.getAnalyticsForRoom(roomId, session.user.id);
    res.json({ analytics });
  });

  app.post('/api/rooms/:roomId/tiktok-webhook', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : '';
    const uniqueId = typeof req.body?.uniqueId === 'string' ? req.body.uniqueId : undefined;
    const nickname = typeof req.body?.nickname === 'string' ? req.body.nickname : undefined;
    const profilePictureUrl =
      typeof req.body?.profilePictureUrl === 'string' ? req.body.profilePictureUrl : undefined;

    const result = gameManager.injectTikTokWebhook(roomId, session.user.id, {
      uniqueId,
      nickname,
      comment,
      profilePictureUrl,
    });
    if (!result.ok) {
      res.status(403).json({ error: result.error });
      return;
    }
    res.json({ ok: true });
  });

  // --- Saved Personal Artwork Gallery Routes ---
  app.get('/api/artworks', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    const artworks = store.listUserArtworks(session.user.id);
    res.json({ artworks });
  });

  app.post('/api/artworks', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    const word = typeof req.body?.word === 'string' ? req.body.word.trim().slice(0, 60) : 'Sketch';
    const artistName =
      typeof req.body?.artistName === 'string'
        ? req.body.artistName.trim().slice(0, 30)
        : session.user.username;
    const roomName =
      typeof req.body?.roomName === 'string'
        ? req.body.roomName.trim().slice(0, 40)
        : 'InkStream Studio';
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';

    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 3_500_000) {
      res.status(400).json({ error: 'Invalid PNG artwork data.' });
      return;
    }

    const saved = store.saveArtwork({
      id: `saved_${crypto.randomBytes(6).toString('hex')}`,
      userId: session.user.id,
      word,
      artistName,
      roomName,
      dataUrl,
      createdAt: Date.now(),
    });
    res.status(201).json({ artwork: saved });
  });

  app.delete('/api/artworks/:id', requireAuth, (req, res) => {
    const session = (req as express.Request & { session?: ActiveSession }).session!;
    const id = String(req.params.id || '');
    const deleted = store.deleteUserArtwork(session.user.id, id);
    if (!deleted) {
      res.status(404).json({ error: 'Artwork not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Socket.io Authentication Middleware (Player OR Private Streamer Popup) ---
  io.use((socket, next) => {
    const auth = socket.handshake.auth as {
      token?: string;
      streamerRoomId?: string;
      streamerSecret?: string;
    };

    if (
      typeof auth?.streamerRoomId === 'string' &&
      typeof auth?.streamerSecret === 'string' &&
      auth.streamerRoomId &&
      auth.streamerSecret
    ) {
      const roomId = auth.streamerRoomId.trim().toUpperCase();
      if (!gameManager.verifyStreamerPopupCredentials(roomId, auth.streamerSecret)) {
        next(new Error('INVALID_STREAMER_POPUP_KEY'));
        return;
      }
      socket.data.isStreamerPopup = true;
      socket.data.streamerRoomId = roomId;
      next();
      return;
    }

    const token = typeof auth?.token === 'string' ? auth.token : undefined;
    const session = getSessionByToken(token);
    if (!session) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    socket.data.session = session;
    next();
  });

  io.on('connection', (socket) => {
    // Dedicated isolated channel for Streamer Private Word Popup window
    if (socket.data.isStreamerPopup) {
      const roomId = String(socket.data.streamerRoomId || '');
      socket.join(`streamer:${roomId}`);
      const initial = gameManager.getStreamerPopupState(roomId);
      if (initial) {
        socket.emit('streamer:state', initial);
      }

      socket.on('streamer:select-word', (payload: { index: number }) => {
        gameManager.selectWordFromStreamerPopup(roomId, Number(payload?.index));
      });
      return;
    }

    const getUser = () => {
      const token = (socket.data.session as ActiveSession | undefined)?.token;
      const fresh = getSessionByToken(token);
      return fresh?.user ?? (socket.data.session as ActiveSession).user;
    };

    socket.on(
      'room:create',
      (
        settings: Partial<RoomSettings> | undefined,
        ack?: (res: { ok: boolean; roomId?: string; error?: string }) => void
      ) => {
        const room = gameManager.createRoom(getUser(), socket.id, settings);
        ack?.({ ok: true, roomId: room.id });
      }
    );

    socket.on(
      'room:quick-play',
      (ack?: (res: { ok: boolean; roomId?: string; error?: string }) => void) => {
        const room = gameManager.joinOrQuickPlay(getUser(), socket.id);
        ack?.({ ok: true, roomId: room.id });
      }
    );

    socket.on(
      'room:join',
      (
        payload: { roomId: string },
        ack?: (res: { ok: boolean; roomId?: string; error?: string }) => void
      ) => {
        const result = gameManager.joinRoom(String(payload?.roomId ?? ''), getUser(), socket.id);
        if (result.error) {
          ack?.({ ok: false, error: result.error });
        } else {
          ack?.({ ok: true, roomId: result.room?.id });
        }
      }
    );

    socket.on('room:leave', () => {
      gameManager.leaveCurrentRoom(socket.id);
    });

    socket.on(
      'room:update-settings',
      (
        patch: Partial<RoomSettings>,
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const res = gameManager.updateSettings(socket.id, patch ?? {});
        ack?.(res.error ? { ok: false, error: res.error } : { ok: true });
      }
    );

    socket.on(
      'room:kick',
      (
        payload: { targetUserId: string },
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const res = gameManager.kickPlayer(socket.id, String(payload?.targetUserId ?? ''));
        ack?.(res.error ? { ok: false, error: res.error } : { ok: true });
      }
    );

    // --- TikTok LIVE Socket Events (Host Only) ---
    socket.on(
      'tiktok:connect',
      async (
        payload: { username: string; isTestMode?: boolean },
        ack?: (res: { ok: boolean; status?: unknown; error?: string }) => void
      ) => {
        const result = await gameManager.connectTikTok(
          socket.id,
          String(payload?.username ?? ''),
          Boolean(payload?.isTestMode)
        );
        ack?.(result);
      }
    );

    socket.on(
      'tiktok:disconnect',
      (ack?: (res: { ok: boolean; error?: string }) => void) => {
        const res = gameManager.disconnectTikTok(socket.id);
        ack?.(res);
      }
    );

    socket.on(
      'tiktok:test-chat',
      (
        payload: { nickname: string; text: string },
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const res = gameManager.injectTikTokTestChat(
          socket.id,
          String(payload?.nickname ?? 'viewer'),
          String(payload?.text ?? '')
        );
        ack?.(res);
      }
    );

    socket.on(
      'game:start',
      (
        payload: { solo?: boolean } | undefined,
        ack?: (res: { ok: boolean; error?: string }) => void
      ) => {
        const res = gameManager.startGame(socket.id, Boolean(payload?.solo));
        ack?.(res.error ? { ok: false, error: res.error } : { ok: true });
      }
    );

    socket.on('game:solo-finish', () => {
      gameManager.finishSoloTurnEarly(socket.id);
    });

    socket.on(
      'game:return-lobby',
      (ack?: (res: { ok: boolean; error?: string }) => void) => {
        const res = gameManager.returnToLobby(socket.id);
        ack?.(res.error ? { ok: false, error: res.error } : { ok: true });
      }
    );

    socket.on('game:select-word', (payload: { index: number }) => {
      gameManager.selectWord(socket.id, Number(payload?.index));
    });

    socket.on('canvas:command', (command: unknown) => {
      gameManager.handleCanvasCommand(socket.id, command);
    });

    socket.on(
      'canvas:live-segment',
      (segment: {
        strokeId: string;
        tool: string;
        color: string;
        size: number;
        seed: number;
        points: Array<{ x: number; y: number }>;
      }) => {
        gameManager.handleLiveStrokeSegment(socket.id, segment);
      }
    );

    socket.on('canvas:undo', () => {
      gameManager.handleCanvasUndo(socket.id);
    });

    socket.on('canvas:redo', () => {
      gameManager.handleCanvasRedo(socket.id);
    });

    socket.on('canvas:clear', () => {
      gameManager.handleCanvasClear(socket.id);
    });

    socket.on('chat:send', (payload: { text: string }) => {
      gameManager.handleChatMessage(socket.id, payload?.text);
    });

    socket.on('game:react', (payload: { reaction: 'like' | 'dislike' }) => {
      gameManager.handleReaction(socket.id, payload?.reaction);
    });

    socket.on(
      'room:request-analytics',
      (
        payload: { roomId: string },
        ack?: (res: { ok: boolean; analytics?: unknown; error?: string }) => void
      ) => {
        const analytics = gameManager.getAnalyticsForRoom(
          String(payload?.roomId ?? ''),
          getUser().id
        );
        if (!analytics) {
          ack?.({ ok: false, error: 'Only the lobby owner can view room analytics.' });
        } else {
          ack?.({ ok: true, analytics });
        }
      }
    );

    socket.on('disconnect', () => {
      gameManager.leaveCurrentRoom(socket.id);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: {
          server: httpServer,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`InkStream server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
