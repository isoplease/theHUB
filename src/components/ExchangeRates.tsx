import { useEffect, useState } from 'react';
import { getExchangeRate } from '../services/exchangeRates';
import type { ExchangeRatePair } from '../types/app';

interface ExchangeRatesState {
  usd: ExchangeRatePair | null;
  eur: ExchangeRatePair | null;
  error: string | null;
}

export function ExchangeRates() {
  const [state, setState] = useState<ExchangeRatesState>({
    usd: null,
    eur: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const loadRates = async () => {
      try {
        const [usd, eur] = await Promise.all([getExchangeRate('usd'), getExchangeRate('eur')]);
        if (!cancelled) {
          setState({ usd, eur, error: null });
        }
      } catch {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: 'Döviz kuru alınamadı. İnternet bağlantınızı kontrol edin.',
          }));
        }
      }
    };

    void loadRates();
    const intervalId = window.setInterval(() => {
      void loadRates();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const renderCard = (pair: ExchangeRatePair | null, label: string) => {
    const value = pair?.rate.toFixed(2) ?? '--';
    const updatedAt = pair?.updatedAt ? new Date(pair.updatedAt).toLocaleTimeString() : 'Bekleniyor';

    return (
      <div className="exchange-card">
        <p className="exchange-label">{label}</p>
        <p className="exchange-rate">{value} TRY</p>
        <p className="exchange-meta">Son güncelleme: {updatedAt}</p>
      </div>
    );
  };

  return (
    <section className="card exchange-card-section">
      <div className="card-header">
        <div>
          <p className="eyebrow">Markets</p>
          <h2>Döviz kurları</h2>
        </div>
        <span className="muted">Canlı / son başarılı veri</span>
      </div>
      {state.error && !state.usd && !state.eur ? (
        <p className="weather-error">{state.error}</p>
      ) : (
        <div className="exchange-grid">
          {renderCard(state.usd, 'USD/TRY')}
          {renderCard(state.eur, 'EUR/TRY')}
        </div>
      )}
    </section>
  );
}
