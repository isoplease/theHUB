import { useEffect, useState } from 'react';
import { getWeatherSnapshot } from '../services/weather';
import type { WeatherSnapshot } from '../types/app';

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadWeather = async () => {
      try {
        const snapshot = await getWeatherSnapshot();
        if (!cancelled) {
          setWeather(snapshot);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError('Hava durumu alınamadı');
        }
      }
    };

    void loadWeather();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card weather-card">
      <div className="card-header">
        <div>
          <p className="eyebrow">Outdoor</p>
          <h2>Hava durumu</h2>
        </div>
        <span className="muted">30 dk önbellek</span>
      </div>
      {error ? (
        <p className="weather-error">{error}</p>
      ) : weather ? (
        <div className="weather-content">
          <div className="weather-main">
            <span className="weather-icon">{weather.icon}</span>
            <div>
              <p className="weather-temp">{weather.temperature}°C</p>
              <p className="weather-label">{weather.label}</p>
            </div>
          </div>
          <p className="weather-city">{weather.city}</p>
        </div>
      ) : (
        <p className="weather-loading">Yükleniyor…</p>
      )}
    </section>
  );
}
