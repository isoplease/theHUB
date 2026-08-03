import { useCallback, useEffect, useState } from 'react';
import { getExchangeRate } from '../services/exchangeRates';
import type { ExchangeRatePair } from '../types/app';

interface ExchangeRatesState {
  usd: ExchangeRatePair | null;
  eur: ExchangeRatePair | null;
  error: string | null;
  loading: boolean;
}

export function ExchangeRates() {
  const [state, setState] = useState<ExchangeRatesState>({
    usd: null,
    eur: null,
    error: null,
    loading: true,
  });

  const loadRates = useCallback(async () => {
    setState((current) => ({ ...current, loading: true }));
    const [usdResult, eurResult] = await Promise.allSettled([
      getExchangeRate('usd'),
      getExchangeRate('eur'),
    ]);

    const usd = usdResult.status === 'fulfilled' ? usdResult.value : null;
    const eur = eurResult.status === 'fulfilled' ? eurResult.value : null;
    setState({
      usd,
      eur,
      loading: false,
      error: usd && eur ? null : 'Bazı döviz kurları alınamadı. Bağlantınızı kontrol edip yeniden deneyin.',
    });
  }, []);

  useEffect(() => {
    void loadRates();
    const intervalId = window.setInterval(() => void loadRates(), 5 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [loadRates]);

  const renderCard = (pair: ExchangeRatePair | null, label: string) => {
    const value = pair?.rate.toFixed(2) ?? '--';
    const updatedAt = pair?.updatedAt
      ? new Date(pair.updatedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })
      : 'Bekleniyor';

    return (
      <div className="rounded-2xl border border-theme-border bg-panel p-3.5">
        <p className="mb-2 text-[0.84rem] font-bold tracking-[0.18em] text-white uppercase">{label}</p>
        <p className="m-0 text-[1.4rem] font-bold text-heading">{value} TRY</p>
        <p className="mt-1.5 text-sm text-info">Son güncelleme: {updatedAt}</p>
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-start justify-between">
        <div>
          <p className="hidden">Markets</p>
          <h2 className="text-[1.1rem] font-bold text-heading">Döviz kurları</h2>
        </div>
        <span className="text-sm text-info">Frankfurter / ECB referans verisi</span>
      </div>
      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        {renderCard(state.usd, 'USD/TRY')}
        {renderCard(state.eur, 'EUR/TRY')}
      </div>
      <div className="flex items-center justify-between gap-3">
        {state.error && <p className="mt-1 text-info">{state.error}</p>}
        <button
          type="button"
          className="ml-auto grid size-[38px] cursor-pointer place-items-center rounded-xl border border-theme-border bg-panel p-0 text-xl leading-none font-semibold text-heading transition-transform duration-150 hover:-translate-y-px disabled:cursor-wait disabled:opacity-65"
          disabled={state.loading}
          aria-label={state.loading ? 'Döviz kurları güncelleniyor' : 'Döviz kurlarını yeniden dene'}
          title={state.loading ? 'Güncelleniyor' : 'Yeniden dene'}
          onClick={() => void loadRates()}
        >
          <span className={`block ${state.loading ? 'animate-spin' : ''}`} aria-hidden="true">↻</span>
        </button>
      </div>
    </section>
  );
}
