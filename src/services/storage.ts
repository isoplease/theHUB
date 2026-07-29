import type { NoteItem, TodoItem } from '../types/app';

const DB_NAME = 'desktop-dashboard.db';
const DB_VERSION = 1;
export const MAX_TODO_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 10_000;

interface DatabaseRow {
  id: number;
  title?: string;
  completed?: number;
  created_at?: string;
  content?: string;
  updated_at?: string;
}

class StorageService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('todos')) {
          const todoStore = database.createObjectStore('todos', { keyPath: 'id', autoIncrement: true });
          todoStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('notes')) {
          const noteStore = database.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
          noteStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
  }

  async getTodos(): Promise<TodoItem[]> {
    await this.init();
    return this.run<TodoItem[]>('todos', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as TodoItem[]);
      });
    });
  }

  async addTodo(title: string, dueDate?: string, reminderTime = '09:00'): Promise<TodoItem> {
    await this.init();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle.length > MAX_TODO_TITLE_LENGTH) {
      throw new Error('Invalid todo title');
    }
    const todo: TodoItem = {
      id: Date.now(),
      title: normalizedTitle,
      completed: false,
      createdAt: new Date().toISOString(),
      dueDate: dueDate || undefined,
      reminderTime: dueDate ? reminderTime : undefined,
    };

    await this.run<void>('todos', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.add(todo);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    });
    return todo;
  }

  async toggleTodo(id: number, completed: boolean): Promise<TodoItem | null> {
    await this.init();
    return this.run<TodoItem | null>('todos', 'readwrite', (store) => {
      return new Promise<TodoItem | null>((resolve, reject) => {
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const todo = request.result as TodoItem | null;
          if (todo) {
            const updated: TodoItem = { ...todo, completed };
            const updateRequest = store.put(updated);
            updateRequest.onerror = () => reject(updateRequest.error);
            updateRequest.onsuccess = () => resolve(updated);
          } else {
            resolve(null);
          }
        };
      });
    });
  }

  async deleteTodo(id: number): Promise<void> {
    await this.init();
    await this.run<void>('todos', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    });
  }

  async getNote(): Promise<NoteItem | null> {
    await this.init();
    return this.run<NoteItem | null>('notes', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const results = request.result as DatabaseRow[];
          if (results[0]) {
            resolve({
              id: results[0].id,
              content: results[0].content ?? '',
              updatedAt: results[0].updated_at ?? new Date().toISOString(),
            });
          }
          resolve(null);
        };
      });
    });
  }

  async saveNote(content: string): Promise<NoteItem> {
    await this.init();
    if (content.length > MAX_NOTE_LENGTH) {
      throw new Error('Note is too long');
    }
    const note: NoteItem = {
      id: Date.now(),
      content,
      updatedAt: new Date().toISOString(),
    };

    await this.run<void>('notes', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.put(note);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    });
    return note;
  }

  private async run<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    if (!this.db) {
      await this.init();
    }
    return new Promise<T>((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      operation(store)
        .then(resolve)
        .catch(reject);
    });
  }
}

export const storageService = new StorageService();
