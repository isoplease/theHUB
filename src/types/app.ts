export interface TodoItem {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
  dueDate?: string;
  reminderTime?: string;
}

export interface NoteItem {
  id: number;
  content: string;
  updatedAt: string;
}

export type ThemeMode = 'light' | 'dark';

export interface WeatherSnapshot {
  city: string;
  temperature: number;
  label: string;
  updatedAt: string;
  icon: string;
}

export interface WeatherLocation {
  id: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface ExchangeRatePair {
  code: string;
  rate: number;
  updatedAt: string;
}
