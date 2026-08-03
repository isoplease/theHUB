import type { NoteItem, TodoItem } from '../types/app';

const DB_NAME = 'desktop-dashboard.db';
const DB_VERSION = 1;
const QUICK_NOTE_ID = 1;
export const MAX_TODO_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 10_000;

interface DatabaseRow {
  id: number;
  title?: string;
  completed?: number;
  created_at?: string;
  content?: string;
  updatedAt?: string;
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
          if (results.length === 0) {
            resolve(null);
            return;
          }

          // Older versions created a new row for every save and then read the
          // oldest row. Pick the genuinely newest legacy/current row so users
          // do not lose the last note they saved.
          const latest = results.reduce((newest, candidate) => {
            const newestTime = Date.parse(newest.updatedAt ?? newest.updated_at ?? '');
            const candidateTime = Date.parse(candidate.updatedAt ?? candidate.updated_at ?? '');
            const normalizedNewestTime = Number.isNaN(newestTime) ? newest.id : newestTime;
            const normalizedCandidateTime = Number.isNaN(candidateTime) ? candidate.id : candidateTime;
            return normalizedCandidateTime > normalizedNewestTime ? candidate : newest;
          });

          resolve({
            id: latest.id,
            content: latest.content ?? '',
            updatedAt: latest.updatedAt ?? latest.updated_at ?? new Date().toISOString(),
          });
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
      id: QUICK_NOTE_ID,
      content,
      updatedAt: new Date().toISOString(),
    };

    await this.run<void>('notes', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        // Keep one canonical quick-note row and remove rows left by older
        // versions. This makes every subsequent load deterministic.
        const clearRequest = store.clear();
        clearRequest.onerror = () => reject(clearRequest.error);
        clearRequest.onsuccess = () => {
          const putRequest = store.put(note);
          putRequest.onerror = () => reject(putRequest.error);
          putRequest.onsuccess = () => resolve();
        };
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
      let operationResult!: T;
      let operationFinished = false;
      let transactionFinished = false;
      const resolveWhenFinished = () => {
        if (operationFinished && transactionFinished) {
          resolve(operationResult);
        }
      };

      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Storage transaction aborted'));
      transaction.oncomplete = () => {
        transactionFinished = true;
        resolveWhenFinished();
      };

      operation(store)
        .then((result) => {
          operationResult = result;
          operationFinished = true;
          resolveWhenFinished();
        })
        .catch((error) => {
          transaction.abort();
          reject(error);
        });
    });
  }
}

export const storageService = new StorageService();
