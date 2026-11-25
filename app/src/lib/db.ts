import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { FolioDocument, ThemeChoice } from '../types';

interface FolioDb extends DBSchema {
  documents: {
    key: string;
    value: FolioDocument;
    indexes: { updatedAt: number };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
}

let database: Promise<IDBPDatabase<FolioDb>> | undefined;

function getDatabase() {
  database ??= openDB<FolioDb>('folio-cami-os', 1, {
    upgrade(db) {
      const documents = db.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  });
  return database;
}

export async function listDocuments(): Promise<FolioDocument[]> {
  const db = await getDatabase();
  const documents = await db.getAll('documents');
  return documents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putDocument(document: FolioDocument) {
  const db = await getDatabase();
  await db.put('documents', document);
}

export async function removeDocument(id: string) {
  const db = await getDatabase();
  await db.delete('documents', id);
}

export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDatabase();
  return ((await db.get('settings', key))?.value as T | undefined) ?? fallback;
}

export async function saveSetting<T>(key: string, value: T) {
  const db = await getDatabase();
  await db.put('settings', { key, value });
}

export async function readTheme(): Promise<ThemeChoice> {
  return readSetting<ThemeChoice>('theme', 'system');
}

export async function saveTheme(value: 'system' | 'light' | 'dark') {
  return saveSetting('theme', value);
}
