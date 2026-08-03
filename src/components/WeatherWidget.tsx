import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getWeatherForLocation,
  resolveCurrentLocation,
  searchWeatherLocations,
} from '../services/weather';
import type { WeatherLocation, WeatherSnapshot } from '../types/app';

const LOCATIONS_STORAGE_KEY = 'weather-selected-locations-v1';
const MAX_EXTRA_CITIES = 3;

function readSelectedLocations(): WeatherLocation[] {
  try {
    const stored = window.localStorage.getItem(LOCATIONS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as WeatherLocation[]).slice(0, MAX_EXTRA_CITIES) : [];
  } catch {
    return [];
  }
}

export function WeatherWidget() {
  const [currentLocation, setCurrentLocation] = useState<WeatherLocation | null>(null);
  const [selectedLocations, setSelectedLocations] = useState<WeatherLocation[]>(readSelectedLocations);
  const [weatherById, setWeatherById] = useState<Record<string, WeatherSnapshot>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<WeatherLocation[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const locations = useMemo(
    () => (currentLocation ? [currentLocation, ...selectedLocations] : selectedLocations),
    [currentLocation, selectedLocations],
  );

  useEffect(() => {
    void resolveCurrentLocation().then(setCurrentLocation);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(selectedLocations));
  }, [selectedLocations]);

  const loadWeather = useCallback(async (items: WeatherLocation[], forceRefresh = false) => {
    if (items.length === 0) return;
    setIsRefreshing(true);
    const results = await Promise.allSettled(
      items.map(async (location) => ({
        id: location.id,
        snapshot: await getWeatherForLocation(location, forceRefresh),
      })),
    );

    const failureCount = results.filter((result) => result.status === 'rejected').length;
    setWeatherById((current) => {
      const next = { ...current };
      for (const result of results) {
        if (result.status === 'fulfilled') {
          next[result.value.id] = result.value.snapshot;
        }
      }
      return next;
    });
    setError(failureCount > 0 ? 'Bazı şehirlerin hava durumu güncellenemedi.' : null);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void loadWeather(locations);
  }, [loadWeather, locations]);

  const searchCities = async () => {
    if (query.trim().length < 3) {
      setSearchResults([]);
      setError('Şehir aramak için en az 3 karakter yazın.');
      return;
    }
    setIsSearching(true);
    setError(null);
    try {
      setSearchResults(await searchWeatherLocations(query));
    } catch {
      setError('Şehir listesi alınamadı. Bağlantınızı kontrol edin.');
    } finally {
      setIsSearching(false);
    }
  };

  const addLocation = (location: WeatherLocation) => {
    if (
      selectedLocations.length >= MAX_EXTRA_CITIES
      || selectedLocations.some((item) => item.id === location.id)
    ) {
      return;
    }
    setSelectedLocations((current) => [...current, location]);
    setQuery('');
    setSearchResults([]);
    setIsSearchOpen(false);
  };

  const removeLocation = (id: string) => {
    setSelectedLocations((current) => current.filter((location) => location.id !== id));
    setWeatherById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  return (
    <section className="rounded-3xl border border-theme-border bg-card p-5 shadow-[var(--shadow)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="hidden">Outdoor</p>
          <h2 className="text-[1.1rem] font-bold text-heading">Hava durumu</h2>
          <span className="text-sm text-info">Konum + en fazla 3 şehir</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="grid size-[38px] cursor-pointer place-items-center rounded-xl border border-theme-border bg-panel text-xl text-heading transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedLocations.length >= MAX_EXTRA_CITIES}
            aria-label="Şehir ekle"
            title="Şehir ekle"
            onClick={() => setIsSearchOpen((current) => !current)}
          >
            +
          </button>
          <button
            type="button"
            className="grid size-[38px] cursor-pointer place-items-center rounded-xl border border-theme-border bg-panel text-xl text-heading transition-transform hover:-translate-y-px disabled:cursor-wait disabled:opacity-60"
            disabled={isRefreshing || locations.length === 0}
            aria-label="Hava durumunu yenile"
            title="Yenile"
            onClick={() => void loadWeather(locations, true)}
          >
            <span className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true">↻</span>
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="mb-4 rounded-2xl border border-theme-border bg-panel p-3">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void searchCities();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-xl border border-theme-border bg-card px-3 py-2 text-heading outline-none focus:ring-2 focus:ring-theme-accent/30"
              value={query}
              placeholder="Şehir adı yazın…"
              aria-label="Şehir adı"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="submit"
              className="cursor-pointer rounded-xl bg-theme-accent px-3 py-2 font-semibold text-white disabled:opacity-60"
              disabled={isSearching}
            >
              {isSearching ? 'Aranıyor…' : 'Ara'}
            </button>
          </form>
          {searchResults.length > 0 && (
            <ul className="mt-2 flex max-h-48 list-none flex-col gap-1 overflow-y-auto p-0">
              {searchResults.map((location) => (
                <li key={location.id}>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-heading hover:bg-card disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={selectedLocations.some((item) => item.id === location.id)}
                    onClick={() => addLocation(location)}
                  >
                    <strong>{location.name}</strong>
                    <span className="ml-1 text-info">{location.country}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-info">{error}</p>}

      <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        {!currentLocation && (
          <div className="rounded-2xl border border-theme-border bg-panel p-3.5 text-info">
            Konum belirleniyor…
          </div>
        )}
        {locations.map((location, index) => {
          const weather = weatherById[location.id];
          return (
            <article key={location.id} className="relative rounded-2xl border border-theme-border bg-panel p-3.5">
              {index > 0 && (
                <button
                  type="button"
                  className="absolute top-2 right-2 grid size-7 cursor-pointer place-items-center rounded-lg bg-card text-sm text-info hover:text-white"
                  aria-label={`${location.name} şehrini kaldır`}
                  title="Şehri kaldır"
                  onClick={() => removeLocation(location.id)}
                >
                  ×
                </button>
              )}
              <p className="pr-7 text-sm font-bold text-heading">{weather?.city ?? location.name}</p>
              {weather ? (
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-3xl">{weather.icon}</span>
                  <div>
                    <p className="text-xl font-bold text-heading">{weather.temperature}°C</p>
                    <p className="text-sm text-info">{weather.label}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-info">Yükleniyor…</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
