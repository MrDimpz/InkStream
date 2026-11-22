import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AvatarConfig,
  PublicUser,
  RoundHistoryEntry,
  SavedArtworkRecord,
} from '../src/shared/types.ts';
import { AVATAR_COLORS } from '../src/shared/words.ts';

export interface StoredUserRecord {
  id: string;
  email: string;
  emailLower: string;
  username: string;
  usernameLower: string;
  passwordSalt: string;
  passwordHash: string;
  isStreamer: boolean;
  tiktokHandle: string;
  avatar: AvatarConfig;
  stats: {
    gamesPlayed: number;
    gamesWon: number;
    totalScore: number;
    wordsGuessed: number;
    bestScore: number;
  };
  createdAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.resolve(DATA_DIR, 'skribbl.db');

function assertConfinedPath(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Database path escaped data directory');
  }
}

interface UserRow {
  id: string;
  email: string;
  email_lower: string;
  username: string;
  username_lower: string;
  password_salt: string;
  password_hash: string;
  is_streamer?: number;
  tiktok_handle?: string;
  avatar_json: string;
  games_played: number;
  games_won: number;
  total_score: number;
  words_guessed: number;
  best_score: number;
  created_at: number;
}

interface ArtworkRow {
  id: string;
  user_id: string;
  word: string;
  artist_name: string;
  room_name: string;
  data_url: string;
  created_at: number;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
}

class SqliteStore {
  private db: DatabaseSync;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    assertConfinedPath(DB_PATH);
    this.db = new DatabaseSync(DB_PATH);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_lower TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_streamer INTEGER NOT NULL DEFAULT 0,
        tiktok_handle TEXT NOT NULL DEFAULT '',
        avatar_json TEXT NOT NULL,
        games_played INTEGER NOT NULL DEFAULT 0,
        games_won INTEGER NOT NULL DEFAULT 0,
        total_score INTEGER NOT NULL DEFAULT 0,
        words_guessed INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS saved_artworks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        word TEXT NOT NULL,
        artist_name TEXT NOT NULL,
        room_name TEXT NOT NULL,
        data_url TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS round_analytics_log (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        room_name TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        round_number INTEGER NOT NULL,
        turn_number INTEGER NOT NULL,
        word TEXT NOT NULL,
        drawer_name TEXT NOT NULL,
        guess_rate REAL NOT NULL,
        fastest_guess_sec REAL,
        stroke_count INTEGER NOT NULL,
        chat_count INTEGER NOT NULL,
        likes INTEGER NOT NULL DEFAULT 0,
        dislikes INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artworks_user ON saved_artworks(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_room ON round_analytics_log(room_id, created_at DESC);
    `);

    // Safe additive column migration for existing SQLite databases
    try {
      this.db.exec('ALTER TABLE users ADD COLUMN is_streamer INTEGER NOT NULL DEFAULT 0;');
    } catch {
      // column already exists
    }
    try {
      this.db.exec("ALTER TABLE users ADD COLUMN tiktok_handle TEXT NOT NULL DEFAULT '';");
    } catch {
      // column already exists
    }
  }

  private mapUserRow(row: UserRow): StoredUserRecord {
    let avatar: AvatarConfig = { color: AVATAR_COLORS[0], eyes: 0, mouth: 0, accessory: 0 };
    try {
      const parsed = JSON.parse(row.avatar_json) as Partial<AvatarConfig>;
      avatar = {
        color: typeof parsed.color === 'string' ? parsed.color : AVATAR_COLORS[0],
        eyes: typeof parsed.eyes === 'number' ? parsed.eyes : 0,
        mouth: typeof parsed.mouth === 'number' ? parsed.mouth : 0,
        accessory: typeof parsed.accessory === 'number' ? parsed.accessory : 0,
      };
    } catch {
      // keep fallback avatar
    }
    return {
      id: row.id,
      email: row.email,
      emailLower: row.email_lower,
      username: row.username,
      usernameLower: row.username_lower,
      passwordSalt: row.password_salt,
      passwordHash: row.password_hash,
      isStreamer: Boolean(row.is_streamer),
      tiktokHandle: row.tiktok_handle || '',
      avatar,
      stats: {
        gamesPlayed: row.games_played,
        gamesWon: row.games_won,
        totalScore: row.total_score,
        wordsGuessed: row.words_guessed,
        bestScore: row.best_score,
      },
      createdAt: row.created_at,
    };
  }

  findUserByEmail(email: string): StoredUserRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM users WHERE email_lower = ? LIMIT 1');
    const row = stmt.get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? this.mapUserRow(row) : undefined;
  }

  findUserByUsername(username: string): StoredUserRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username_lower = ? LIMIT 1');
    const row = stmt.get(username.trim().toLowerCase()) as UserRow | undefined;
    return row ? this.mapUserRow(row) : undefined;
  }

  findUserById(id: string): StoredUserRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
    const row = stmt.get(id) as UserRow | undefined;
    return row ? this.mapUserRow(row) : undefined;
  }

  createUser(record: StoredUserRecord): StoredUserRecord {
    const stmt = this.db.prepare(`
      INSERT INTO users (
        id, email, email_lower, username, username_lower,
        password_salt, password_hash, is_streamer, tiktok_handle, avatar_json,
        games_played, games_won, total_score, words_guessed, best_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?)
    `);
    stmt.run(
      record.id,
      record.email,
      record.emailLower,
      record.username,
      record.usernameLower,
      record.passwordSalt,
      record.passwordHash,
      record.isStreamer ? 1 : 0,
      record.tiktokHandle || '',
      JSON.stringify(record.avatar),
      record.createdAt
    );
    return record;
  }

  updateUserAvatar(userId: string, avatar: AvatarConfig): void {
    const stmt = this.db.prepare('UPDATE users SET avatar_json = ? WHERE id = ?');
    stmt.run(JSON.stringify(avatar), userId);
  }

  updateUserStreamerInfo(userId: string, isStreamer: boolean, tiktokHandle: string): void {
    const stmt = this.db.prepare(
      'UPDATE users SET is_streamer = ?, tiktok_handle = ? WHERE id = ?'
    );
    stmt.run(isStreamer ? 1 : 0, tiktokHandle, userId);
  }

  recordGameResult(userId: string, score: number, won: boolean, wordsGuessed: number): void {
    const stmt = this.db.prepare(`
      UPDATE users
      SET
        games_played = games_played + 1,
        games_won = games_won + ?,
        total_score = total_score + ?,
        words_guessed = words_guessed + ?,
        best_score = CASE WHEN ? > best_score THEN ? ELSE best_score END
      WHERE id = ?
    `);
    stmt.run(won ? 1 : 0, score, wordsGuessed, score, score, userId);
  }

  createPersistentSession(tokenHash: string, userId: string, expiresAt: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(tokenHash, userId, expiresAt, Date.now());
  }

  findPersistentSession(tokenHash: string): SessionRow | undefined {
    const stmt = this.db.prepare(
      'SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = ? LIMIT 1'
    );
    const row = stmt.get(tokenHash) as SessionRow | undefined;
    if (!row) return undefined;
    if (row.expires_at < Date.now()) {
      this.deletePersistentSession(tokenHash);
      return undefined;
    }
    return row;
  }

  deletePersistentSession(tokenHash: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    stmt.run(tokenHash);
  }

  toPublicUser(record: StoredUserRecord): PublicUser {
    return {
      id: record.id,
      username: record.username,
      email: record.email,
      isGuest: false,
      isStreamer: record.isStreamer,
      tiktokHandle: record.tiktokHandle || undefined,
      avatar: record.avatar,
      stats: { ...record.stats },
    };
  }

  saveArtwork(record: SavedArtworkRecord): SavedArtworkRecord {
    const insert = this.db.prepare(`
      INSERT INTO saved_artworks (id, user_id, word, artist_name, room_name, data_url, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      record.id,
      record.userId,
      record.word,
      record.artistName,
      record.roomName,
      record.dataUrl,
      record.createdAt
    );

    // Keep at most 40 artworks per user
    const prune = this.db.prepare(`
      DELETE FROM saved_artworks
      WHERE user_id = ? AND id NOT IN (
        SELECT id FROM saved_artworks WHERE user_id = ? ORDER BY created_at DESC LIMIT 40
      )
    `);
    prune.run(record.userId, record.userId);
    return record;
  }

  listUserArtworks(userId: string): SavedArtworkRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, user_id, word, artist_name, room_name, data_url, created_at
      FROM saved_artworks
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 40
    `);
    const rows = stmt.all(userId) as unknown as ArtworkRow[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      word: r.word,
      artistName: r.artist_name,
      roomName: r.room_name,
      dataUrl: r.data_url,
      createdAt: r.created_at,
    }));
  }

  deleteUserArtwork(userId: string, artworkId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM saved_artworks WHERE id = ? AND user_id = ?');
    const result = stmt.run(artworkId, userId);
    return Number(result.changes) > 0;
  }

  logRoundAnalytics(roomId: string, roomName: string, ownerId: string, entry: RoundHistoryEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO round_analytics_log (
        id, room_id, room_name, owner_id, round_number, turn_number,
        word, drawer_name, guess_rate, fastest_guess_sec, stroke_count,
        chat_count, likes, dislikes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      `${roomId}_${entry.turnNumber}_${entry.endedAt}`,
      roomId,
      roomName,
      ownerId,
      entry.roundNumber,
      entry.turnNumber,
      entry.word,
      entry.drawerName,
      entry.guessRate,
      entry.fastestGuessSec,
      entry.strokeCount,
      entry.chatMessagesCount,
      entry.likes,
      entry.dislikes,
      entry.endedAt
    );
  }
}

export const store = new SqliteStore();
