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

export type DateEventFormat = 'dmy' | 'mdy';

export interface DateEventItem {
  id: string;
  title: string;
  date: string;
  format: DateEventFormat;
  createdAt: string;
}

export type ThemeMode = 'light' | 'dark';
