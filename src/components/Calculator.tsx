import { useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  CalculatorError,
  evaluateCalculatorExpression,
  type AngleMode,
} from '../services/calculator';

type CalculatorMode = 'standard' | 'scientific';
type ButtonVariant = 'default' | 'operator' | 'action' | 'equals';

interface CalculatorButtonProps {
  readonly children: ReactNode;
  readonly label?: string;
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly onClick: () => void;
}

interface CalculationHistoryItem {
  id: string;
  expression: string;
  result: string;
  mode: CalculatorMode;
  angleMode: AngleMode;
  createdAt: string;
}

const OPERATOR_PATTERN = /[+\-*/^]$/;
const CALCULATION_HISTORY_KEY = 'dashboard-calculation-history-v1';
const MAX_HISTORY_ITEMS = 100;

function loadCalculationHistory(): CalculationHistoryItem[] {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(CALCULATION_HISTORY_KEY) ?? '[]',
    ) as CalculationHistoryItem[];
    if (!Array.isArray(stored)) return [];
    return stored.filter((item) => (
      typeof item?.id === 'string'
      && typeof item.expression === 'string'
      && typeof item.result === 'string'
      && (item.mode === 'standard' || item.mode === 'scientific')
      && (item.angleMode === 'DEG' || item.angleMode === 'RAD')
      && typeof item.createdAt === 'string'
    )).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function CalculatorButton({
  children,
  label,
  variant = 'default',
  className = '',
  onClick,
}: CalculatorButtonProps) {
  const variants: Record<ButtonVariant, string> = {
    default: 'border-theme-border bg-panel text-heading hover:bg-theme-accent-bg',
    operator: 'border-theme-accent/40 bg-theme-accent-bg text-heading hover:brightness-110',
    action: 'border-theme-border bg-transparent text-info hover:bg-panel',
    equals: 'border-theme-accent bg-theme-accent text-white hover:brightness-110',
  };

  return (
    <button
      type="button"
      aria-label={label}
      className={`min-h-11 cursor-pointer rounded-xl border px-2 py-2 text-sm font-semibold shadow-[0_5px_14px_rgba(14,26,69,0.08)] transition-all duration-150 hover:-translate-y-px active:translate-y-0 ${variants[variant]} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function displayExpression(value: string): string {
  return value
    .replaceAll('asin', 'sin⁻¹')
    .replaceAll('acos', 'cos⁻¹')
    .replaceAll('atan', 'tan⁻¹')
    .replaceAll('log10', 'log')
    .replaceAll('sqrt', '√')
    .replace(/\bpi\b/g, 'π')
    .replaceAll('*', '×')
    .replaceAll('/', '÷')
    .replaceAll('-', '−')
    .replaceAll('.', ',');
}

function endsWithValue(expression: string): boolean {
  return /(?:\d|\)|!|pi|e)$/.test(expression);
}

function countCharacter(value: string, character: string): number {
  return [...value].filter((entry) => entry === character).length;
}

export function Calculator() {
  const [mode, setMode] = useState<CalculatorMode>('standard');
  const [angleMode, setAngleMode] = useState<AngleMode>('DEG');
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('');
  const [history, setHistory] = useState('');
  const [error, setError] = useState('');
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [calculationHistory, setCalculationHistory] = useState(loadCalculationHistory);
  const [historyOpen, setHistoryOpen] = useState(false);

  const updateCalculationHistory = (
    updater: (current: CalculationHistoryItem[]) => CalculationHistoryItem[],
  ) => {
    setCalculationHistory((current) => {
      const updated = updater(current).slice(0, MAX_HISTORY_ITEMS);
      window.localStorage.setItem(CALCULATION_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeHistoryItem = (id: string) => {
    updateCalculationHistory((current) => current.filter((item) => item.id !== id));
  };

  const clearCalculationHistory = () => {
    setCalculationHistory([]);
    window.localStorage.removeItem(CALCULATION_HISTORY_KEY);
  };

  const resetFeedback = () => {
    setError('');
    setResult('');
  };

  const appendDigit = (digit: string) => {
    resetFeedback();
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      return /(?:\)|!|pi|e)$/.test(base) ? `${base}*${digit}` : `${base}${digit}`;
    });
    setJustEvaluated(false);
  };

  const appendDecimal = () => {
    resetFeedback();
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      if (/(?:\)|!|pi|e)$/.test(base)) return `${base}*0.`;
      const lastNumber = base.split(/[+\-*/^()]/).at(-1) ?? '';
      if (lastNumber.includes('.')) return base;
      return !base || OPERATOR_PATTERN.test(base) || base.endsWith('(') ? `${base}0.` : `${base}.`;
    });
    setJustEvaluated(false);
  };

  const appendOperator = (operator: string) => {
    setError('');
    setResult('');
    setExpression((current) => {
      if (!current) return operator === '-' ? '-' : '';
      if (current.endsWith('(')) return operator === '-' ? `${current}-` : current;
      return OPERATOR_PATTERN.test(current)
        ? `${current.slice(0, -1)}${operator}`
        : `${current}${operator}`;
    });
    setJustEvaluated(false);
  };

  const appendFunction = (functionName: string) => {
    resetFeedback();
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      return `${base}${endsWithValue(base) ? '*' : ''}${functionName}(`;
    });
    setJustEvaluated(false);
  };

  const appendConstant = (constant: 'pi' | 'e') => {
    resetFeedback();
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      return `${base}${endsWithValue(base) ? '*' : ''}${constant}`;
    });
    setJustEvaluated(false);
  };

  const appendParenthesis = (parenthesis: '(' | ')') => {
    resetFeedback();
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      if (parenthesis === '(') return `${base}${endsWithValue(base) ? '*' : ''}(`;
      const openCount = countCharacter(base, '(');
      const closeCount = countCharacter(base, ')');
      if (openCount <= closeCount || !endsWithValue(base)) return base;
      return `${base})`;
    });
    setJustEvaluated(false);
  };

  const appendFactorial = () => {
    resetFeedback();
    setExpression((current) => endsWithValue(current) ? `${current}!` : current);
    setJustEvaluated(false);
  };

  const appendSquare = () => {
    resetFeedback();
    setExpression((current) => endsWithValue(current) ? `${current}^2` : current);
    setJustEvaluated(false);
  };

  const applyReciprocal = () => {
    resetFeedback();
    setExpression((current) => current ? `1/(${current})` : '1/(');
    setJustEvaluated(false);
  };

  const applyPercent = () => {
    resetFeedback();
    setExpression((current) => current ? `(${current})/100` : current);
    setJustEvaluated(false);
  };

  const toggleSign = () => {
    resetFeedback();
    setExpression((current) => {
      if (!current) return '-';
      if (current.startsWith('-(') && current.endsWith(')')) return current.slice(2, -1);
      return `-(${current})`;
    });
    setJustEvaluated(false);
  };

  const clear = () => {
    setExpression('');
    setResult('');
    setHistory('');
    setError('');
    setJustEvaluated(false);
  };

  const backspace = () => {
    resetFeedback();
    setExpression((current) => justEvaluated ? '' : current.slice(0, -1));
    setJustEvaluated(false);
  };

  const calculate = () => {
    if (!expression) return;
    const missingParentheses = countCharacter(expression, '(') - countCharacter(expression, ')');
    const completeExpression = missingParentheses > 0
      ? `${expression}${')'.repeat(missingParentheses)}`
      : expression;

    try {
      const calculation = evaluateCalculatorExpression(completeExpression, angleMode);
      const formattedExpression = displayExpression(completeExpression);
      const formattedResult = displayExpression(calculation.display);
      setHistory(`${formattedExpression} =`);
      setExpression(calculation.exact);
      setResult(formattedResult);
      setError('');
      setJustEvaluated(true);
      updateCalculationHistory((current) => [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            expression: formattedExpression,
            result: formattedResult,
            mode,
            angleMode,
            createdAt: new Date().toISOString(),
          },
          ...current,
        ]);
    } catch (calculationError) {
      setError(
        calculationError instanceof CalculatorError
          ? calculationError.message
          : 'İşlem hesaplanamadı.',
      );
      setResult('');
      setJustEvaluated(false);
    }
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      appendDigit(event.key);
    } else if (event.key === '.' || event.key === ',') {
      event.preventDefault();
      appendDecimal();
    } else if (['+', '-', '*', '/', '^'].includes(event.key)) {
      event.preventDefault();
      appendOperator(event.key);
    } else if (event.key === '(' || event.key === ')') {
      event.preventDefault();
      appendParenthesis(event.key);
    } else if (event.key === 'Enter' || event.key === '=') {
      event.preventDefault();
      calculate();
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      backspace();
    } else if (event.key === 'Escape' || event.key === 'Delete') {
      event.preventDefault();
      clear();
    }
  };

  return (
    <section
      className="relative self-start rounded-3xl border border-theme-border bg-card p-5 pb-16 shadow-[var(--shadow)] outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/40"
      aria-label="Hesap makinesi"
      tabIndex={0}
      onKeyDown={handleKeyboard}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="hidden">Calculator</p>
          <h2 className="text-[1.1rem] font-bold text-heading">Hesap Makinesi</h2>
        </div>
        <div className="flex rounded-xl border border-theme-border bg-panel p-1" aria-label="Hesap makinesi modu">
          {(['standard', 'scientific'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={mode === entry}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                mode === entry ? 'bg-theme-accent text-white' : 'text-info hover:text-heading'
              }`}
              onClick={() => setMode(entry)}
            >
              {entry === 'standard' ? 'Standart' : 'Bilimsel'}
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative isolate mb-3 min-h-[108px] overflow-hidden rounded-2xl border border-[#7f8d69] bg-[#aab891] px-4 py-3 text-right shadow-[inset_0_2px_8px_rgba(35,48,30,0.38),inset_0_-1px_2px_rgba(255,255,230,0.5),0_0_16px_rgba(184,215,142,0.18)] before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle,rgba(41,57,36,0.2)_0_0.7px,transparent_0.9px)] before:[background-size:8px_8px] after:pointer-events-none after:absolute after:inset-0 after:-z-10 after:bg-[linear-gradient(115deg,rgba(255,255,255,0.23)_0%,transparent_34%,transparent_72%,rgba(255,255,255,0.1)_100%)]"
        aria-label="LCD hesaplama ekranı"
      >
        <div
          className="min-h-6 truncate text-xl font-bold tracking-[0.08em] text-[#33452d] drop-shadow-[0_0_2px_rgba(54,75,45,0.2)] [font-family:'DS_Digital',ui-monospace,monospace]"
          title={history}
        >
          {history}
        </div>
        <output
          className={`mt-1 block min-h-12 break-all text-5xl leading-12 font-bold tracking-[0.08em] drop-shadow-[0_0_3px_rgba(54,75,45,0.32)] [font-family:'DS_Digital',ui-monospace,monospace] ${error ? 'text-red-800' : 'text-[#263622]'}`}
          aria-live="polite"
          aria-label="Hesap makinesi sonucu"
        >
          {error || result || displayExpression(expression) || '0'}
        </output>
      </div>

      {mode === 'scientific' && (
        <div className="mb-3 grid grid-cols-5 gap-2">
          <CalculatorButton
            variant="action"
            label={`Açı birimi: ${angleMode}`}
            onClick={() => setAngleMode((current) => current === 'DEG' ? 'RAD' : 'DEG')}
          >
            {angleMode}
          </CalculatorButton>
          <CalculatorButton onClick={() => appendFunction('sin')}>sin</CalculatorButton>
          <CalculatorButton onClick={() => appendFunction('cos')}>cos</CalculatorButton>
          <CalculatorButton onClick={() => appendFunction('tan')}>tan</CalculatorButton>
          <CalculatorButton label="Pi" onClick={() => appendConstant('pi')}>π</CalculatorButton>

          <CalculatorButton label="Ters sinüs" onClick={() => appendFunction('asin')}>sin⁻¹</CalculatorButton>
          <CalculatorButton label="Ters kosinüs" onClick={() => appendFunction('acos')}>cos⁻¹</CalculatorButton>
          <CalculatorButton label="Ters tanjant" onClick={() => appendFunction('atan')}>tan⁻¹</CalculatorButton>
          <CalculatorButton label="Doğal logaritma" onClick={() => appendFunction('log')}>ln</CalculatorButton>
          <CalculatorButton label="10 tabanında logaritma" onClick={() => appendFunction('log10')}>log</CalculatorButton>

          <CalculatorButton label="Karekök" onClick={() => appendFunction('sqrt')}>√x</CalculatorButton>
          <CalculatorButton label="Karesi" onClick={appendSquare}>x²</CalculatorButton>
          <CalculatorButton label="Üs" onClick={() => appendOperator('^')}>xʸ</CalculatorButton>
          <CalculatorButton label="Faktöriyel" onClick={appendFactorial}>n!</CalculatorButton>
          <CalculatorButton label="Tersi" onClick={applyReciprocal}>1/x</CalculatorButton>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <CalculatorButton variant="action" onClick={clear}>C</CalculatorButton>
        <CalculatorButton variant="action" label="Son karakteri sil" onClick={backspace}>⌫</CalculatorButton>
        <CalculatorButton variant="action" onClick={() => appendParenthesis('(')}>(</CalculatorButton>
        <CalculatorButton variant="action" onClick={() => appendParenthesis(')')}>)</CalculatorButton>

        {['7', '8', '9'].map((digit) => (
          <CalculatorButton key={digit} onClick={() => appendDigit(digit)}>{digit}</CalculatorButton>
        ))}
        <CalculatorButton variant="operator" label="Böl" onClick={() => appendOperator('/')}>÷</CalculatorButton>

        {['4', '5', '6'].map((digit) => (
          <CalculatorButton key={digit} onClick={() => appendDigit(digit)}>{digit}</CalculatorButton>
        ))}
        <CalculatorButton variant="operator" label="Çarp" onClick={() => appendOperator('*')}>×</CalculatorButton>

        {['1', '2', '3'].map((digit) => (
          <CalculatorButton key={digit} onClick={() => appendDigit(digit)}>{digit}</CalculatorButton>
        ))}
        <CalculatorButton variant="operator" label="Çıkar" onClick={() => appendOperator('-')}>−</CalculatorButton>

        <CalculatorButton label="İşareti değiştir" onClick={toggleSign}>±</CalculatorButton>
        <CalculatorButton onClick={() => appendDigit('0')}>0</CalculatorButton>
        <CalculatorButton label="Ondalık ayırıcı" onClick={appendDecimal}>,</CalculatorButton>
        <CalculatorButton variant="operator" label="Topla" onClick={() => appendOperator('+')}>+</CalculatorButton>

        <CalculatorButton label="Yüzde" onClick={applyPercent}>%</CalculatorButton>
        <CalculatorButton variant="equals" className="col-span-3" label="Hesapla" onClick={calculate}>=</CalculatorButton>
      </div>

      {historyOpen && (
        <div className="absolute right-5 bottom-16 left-5 z-30 flex max-h-[360px] flex-col overflow-hidden rounded-2xl border border-theme-border bg-card p-3.5 shadow-[var(--shadow)]">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <h3 className="font-bold text-heading">Hesaplama geçmişi</h3>
            <div className="flex items-center gap-2">
              {calculationHistory.length > 0 && (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg border border-red-400/50 bg-red-500/10 px-2 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                  onClick={clearCalculationHistory}
                >
                  Tümünü Sil
                </button>
              )}
              <button
                type="button"
                className="grid size-7 cursor-pointer place-items-center rounded-lg bg-panel text-sm text-heading"
                aria-label="Hesaplama geçmişini kapat"
                onClick={() => setHistoryOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {calculationHistory.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0 pr-1">
              {calculationHistory.map((item) => (
                <li key={item.id} className="rounded-xl bg-panel px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-info" title={item.expression}>{item.expression} =</p>
                      <p className="mt-0.5 break-all text-sm font-semibold text-heading">{item.result}</p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-md border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 text-[0.65rem] font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                      aria-label={`Geçmişten sil: ${item.expression}`}
                      onClick={() => removeHistoryItem(item.id)}
                    >
                      Sil
                    </button>
                  </div>
                  <p className="mt-1 text-[0.65rem] text-info">
                    {item.mode === 'scientific' ? `Bilimsel · ${item.angleMode}` : 'Standart'} ·{' '}
                    {new Date(item.createdAt).toLocaleString('tr-TR')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-info">Henüz hesaplama geçmişi yok.</p>
          )}
        </div>
      )}

      <button
        type="button"
        className="absolute right-5 bottom-5 cursor-pointer rounded-xl border border-theme-border bg-panel px-3 py-2 text-xs font-semibold text-heading transition-transform hover:-translate-y-px"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((current) => !current)}
      >
        Geçmiş{calculationHistory.length > 0 ? ` (${calculationHistory.length})` : ''}
      </button>
    </section>
  );
}
