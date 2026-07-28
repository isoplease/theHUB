import { useEffect, useState } from 'react';
import type { TodoItem } from '../types/app';
import { MAX_TODO_TITLE_LENGTH, storageService } from '../services/storage';

interface TodoListProps {
  readonly onCountChange?: (count: number) => void;
}

export function TodoList({ onCountChange }: TodoListProps) {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const loadTodos = async () => {
      const items = await storageService.getTodos();
      setTodos(items);
      onCountChange?.(items.length);
    };
    void loadTodos();
  }, [onCountChange]);

  const handleAdd = async () => {
    const title = draft.trim();
    if (!title) {
      return;
    }

    const created = await storageService.addTodo(title);
    setTodos((current) => [created, ...current]);
    setDraft('');
    onCountChange?.(todos.length + 1);
  };

  const handleToggle = async (todo: TodoItem) => {
    await storageService.toggleTodo(todo.id, !todo.completed);
    setTodos((current) =>
      current.map((item) => (item.id === todo.id ? { ...item, completed: !item.completed } : item)),
    );
  };

  const handleDelete = async (id: number) => {
    await storageService.deleteTodo(id);
    setTodos((current) => current.filter((item) => item.id !== id));
    onCountChange?.(todos.length - 1);
  };

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Plan</p>
          <h2>Todo listesi</h2>
        </div>
      </div>
      <div className="todo-form">
        <input
          value={draft}
          maxLength={MAX_TODO_TITLE_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Yeni görev ekle"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void handleAdd();
            }
          }}
        />
        <button type="button" onClick={() => void handleAdd()}>
          Ekle
        </button>
      </div>
      <ul className="todo-list">
        {todos.map((todo) => (
          <li key={todo.id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
            <label>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => void handleToggle(todo)}
              />
              <span>{todo.title}</span>
            </label>
            <button type="button" onClick={() => void handleDelete(todo.id)}>
              Sil
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
