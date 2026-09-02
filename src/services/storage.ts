import type {
  DateEventFormat,
  DateEventItem,
  NoteItem,
  TodoHistoryItem,
  TodoItem,
} from '../types/app';
import { isValidDateKey } from './dateTracker';

const DB_NAME = 'desktop-dashboard.db';
const DB_VERSION = 3;
const QUICK_NOTE_WORKSPACE_COUNT = 4;
export const MAX_TODO_TITLE_LENGTH = 200;
export const MAX_NOTE_LENGTH = 10_000;
export const MAX_NOTE_STORAGE_LENGTH = 1_000_000;
export const MAX_DATE_EVENT_TITLE_LENGTH = 120;

interface DatabaseRow {
  id: number;
  workspaceId?: number;
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
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
        };
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
        if (!database.objectStoreNames.contains('todoHistory')) {
          const historyStore = database.createObjectStore('todoHistory', { keyPath: 'archiveId' });
          historyStore.createIndex('archivedAt', 'archivedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('dateEvents')) {
          const dateEventStore = database.createObjectStore('dateEvents', { keyPath: 'id' });
          dateEventStore.createIndex('date', 'date', { unique: false });
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
            const updated: TodoItem = {
              ...todo,
              completed,
              completedAt: completed ? new Date().toISOString() : undefined,
            };
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

  async getTodoHistory(): Promise<TodoHistoryItem[]> {
    await this.init();
    return this.run<TodoHistoryItem[]>('todoHistory', 'readonly', (store) => {
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result as TodoHistoryItem[]);
      });
    });
  }

  async deleteTodo(id: number): Promise<TodoHistoryItem | null> {
    await this.init();
    return new Promise<TodoHistoryItem | null>((resolve, reject) => {
      const transaction = this.db!.transaction(['todos', 'todoHistory'], 'readwrite');
      const todoStore = transaction.objectStore('todos');
      const historyStore = transaction.objectStore('todoHistory');
      let archivedTodo: TodoHistoryItem | null = null;

      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Todo archive transaction aborted'));
      transaction.oncomplete = () => resolve(archivedTodo);

      const getRequest = todoStore.get(id);
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        const todo = getRequest.result as TodoItem | undefined;
        if (!todo) return;

        archivedTodo = {
          ...todo,
          archiveId: `${todo.id}-${Date.now()}`,
          archivedAt: new Date().toISOString(),
          reason: 'deleted',
        };
        const archiveRequest = historyStore.put(archivedTodo);
        archiveRequest.onerror = () => reject(archiveRequest.error);
        archiveRequest.onsuccess = () => {
          const deleteRequest = todoStore.delete(id);
          deleteRequest.onerror = () => reject(deleteRequest.error);
        };
      };
    });
  }

  async deleteTodoPermanently(id: number): Promise<void> {
    await this.init();
    await this.run<void>('todos', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    });
  }

  async deleteTodoHistoryItem(archiveId: string): Promise<void> {
    await this.init();
    await this.run<void>('todoHistory', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const request = store.delete(archiveId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    });
  }

  async clearTodoHistory(todoIds: number[]): Promise<void> {
    await this.init();
    await new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(['todos', 'todoHistory'], 'readwrite');
      const todoStore = transaction.objectStore('todos');
      const historyStore = transaction.objectStore('todoHistory');

      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Todo history cleanup aborted'));
      transaction.oncomplete = () => resolve();

      historyStore.clear();
      todoIds.forEach((id) => todoStore.delete(id));
    });
  }

  async getNote(workspaceId = 1): Promise<NoteItem | null> {
    await this.init();
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || workspaceId > QUICK_NOTE_WORKSPACE_COUNT) {
      throw new Error('Invalid note workspace');
    }
    return this.run<NoteItem | null>('notes', 'readwrite', (store) => {
      return new Promise((resolve, reject) => {
        const normalize = (row: DatabaseRow): NoteItem => ({
          id: workspaceId,
          workspaceId,
          content: row.content ?? '',
          updatedAt: row.updatedAt ?? row.updated_at ?? new Date().toISOString(),
        });
        const request = store.get(workspaceId);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const direct = request.result as DatabaseRow | undefined;
          if (direct?.workspaceId === workspaceId) {
            resolve(normalize(direct));
            return;
          }
          if (workspaceId !== 1) {
            resolve(null);
            return;
          }
          const legacyRequest = store.getAll();
          legacyRequest.onerror = () => reject(legacyRequest.error);
          legacyRequest.onsuccess = () => {
            const legacyRows = (legacyRequest.result as DatabaseRow[]).filter((row) => (
              row.workspaceId === undefined || row.workspaceId === 1
            ));
            if (legacyRows.length === 0) {
              resolve(null);
              return;
            }
            const latest = legacyRows.reduce((newest, candidate) => {
              const newestTime = Date.parse(newest.updatedAt ?? newest.updated_at ?? '');
              const candidateTime = Date.parse(candidate.updatedAt ?? candidate.updated_at ?? '');
              const normalizedNewestTime = Number.isNaN(newestTime) ? newest.id : newestTime;
              const normalizedCandidateTime = Number.isNaN(candidateTime) ? candidate.id : candidateTime;
              return normalizedCandidateTime > normalizedNewestTime ? candidate : newest;
            });
            const migrated = normalize(latest);
            const migrateRequest = store.put(migrated);
            migrateRequest.onerror = () => reject(migrateRequest.error);
            migrateRequest.onsuccess = () => resolve(migrated);
          };
        };
      });
    });
  }

  async saveNote(content: string, workspaceId = 1): Promise<NoteItem> {
    await this.init();
    if (!Number.isInteger(workspaceId) || workspaceId < 1 || workspaceId > QUICK_NOTE_WORKSPACE_COUNT) {
      throw new Error('Invalid note workspace');
    }
    // Rich notes contain safe HTML markup for colors, lists and markers.
    // The user-facing 10,000 character limit is checked against visible text
    // in QuickNote; this separate ceiling only guards the stored payload.
    if (content.length > MAX_NOTE_STORAGE_LENGTH) {
      throw new Error('Note is too long');
    }
    const note: NoteItem = {
      id: workspaceId,
      workspaceId,
      content,
      updatedAt: new Date().toISOString(),
    };

    await this.run<void>('notes', 'readwrite', (store) => {
      return new Promise<void>((resolve, reject) => {
        const putRequest = store.put(note);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve();
      });
    });
    return note;
  }

  async getDateEvents(): Promise<DateEventItem[]> {
    await this.init();
    return this.run<DateEventItem[]>('dateEvents', 'readonly', (store) => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve((request.result as DateEventItem[]).filter((item) => (
        typeof item.id === 'string'
        && typeof item.title === 'string'
        && item.title.length > 0
        && item.title.length <= MAX_DATE_EVENT_TITLE_LENGTH
        && isValidDateKey(item.date)
        && (item.format === 'dmy' || item.format === 'mdy')
        && (item.indefinite === undefined || typeof item.indefinite === 'boolean')
      )));
    }));
  }

  async addDateEvent(
    title: string,
    date: string,
    format: DateEventFormat,
    indefinite = false,
  ): Promise<DateEventItem> {
    await this.init();
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle.length > MAX_DATE_EVENT_TITLE_LENGTH) {
      throw new Error('Invalid date event title');
    }
    if (!isValidDateKey(date) || (format !== 'dmy' && format !== 'mdy')) {
      throw new Error('Invalid date event');
    }

    const event: DateEventItem = {
      id: typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: normalizedTitle,
      date,
      format,
      indefinite,
      createdAt: new Date().toISOString(),
    };
    await this.run<void>('dateEvents', 'readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.add(event);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    }));
    return event;
  }

  async deleteDateEvent(id: string): Promise<void> {
    await this.init();
    if (!id || id.length > 200) throw new Error('Invalid date event id');
    await this.run<void>('dateEvents', 'readwrite', (store) => new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    }));
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
