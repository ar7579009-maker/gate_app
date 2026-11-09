// Binds SqliteStore to the Capacitor SQLite plugin. Only imported on Android (see main.ts).
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { SqliteStore as Store, type SqlDb } from './store.js';

export class SqliteStore extends Store {
  static async open(name: string): Promise<SqliteStore> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    // no encryption, version 1, read-write, not read-only
    const conn = await sqlite.createConnection(name, false, 'no-encryption', 1, false);
    return new SqliteStore(conn as unknown as SqlDb);
  }
}
