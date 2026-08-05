export interface TodoItem {
  id: number;
  title: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  dueDate?: string;
  reminderTime?: string;
}

export interface TodoHistoryItem extends TodoItem {
  archiveId: string;
  archivedAt: string;
  reason: 'deleted';
}

export interface NoteItem {
  id: number;
  content: string;
  updatedAt: string;
}

export type ThemeMode = 'light' | 'dark';
