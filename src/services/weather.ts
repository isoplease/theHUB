import type { WeatherLocation, WeatherSnapshot } from '../types/app';

const WEATHER_CACHE_PREFIX = 'weather-cache-v2';
const CACHE_TTL_MS = 30 * 60 * 1000;
const LOCATION_PRECISION = 100;

interface WeatherApiResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    time?: string;
  };
}

interface GeocodingApiResponse {
  results?: Array<{
    id: number;
    name: string;
    country?: string;
    admin1?: string;
    latitude: number;
    longitude: number;
  }>;
}

const WEATHER_LABELS: Record<number, string> = {
  0: 'Açık',
  1: 'Çoğunlukla açık',
  2: 'Parçalı bulutlu',
  3: 'Kapalı',
  45: 'Sis',
  48: 'Pus',
  51: 'Hafif çisenti',
  53: 'Çisenti',
  55: 'Yoğun çisenti',
  61: 'Hafif yağmur',
  63: 'Yağmur',
  65: 'Yoğun yağmur',
  71: 'Hafif kar',
  73: 'Kar',
  75: 'Yoğun kar',
  80: 'Sağanak',
  81: 'Sağanak',
  82: 'Yoğun sağanak',
  95: 'Fırtına',
};

const ISTANBUL: WeatherLocation = {
  id: 'current',
  name: 'İstanbul',
  country: 'Türkiye',
  latitude: 41.01,
  longitude: 28.98,
};

function cacheKey(location: WeatherLocation): string {
  return `${WEATHER_CACHE_PREFIX}-${location.id}`;
}

function readCachedWeather(location: WeatherLocation): WeatherSnapshot | null {
  const cached = window.localStorage.getItem(cacheKey(location));
  if (!cached) return null;

  try {
    const parsed = JSON.parse(cached) as { expiresAt: number; data: WeatherSnapshot };
    return parsed.expiresAt > Date.now() ? parsed.data : null;
  } catch {
    window.localStorage.removeItem(cacheKey(location));
    return null;
  }
}

function writeCachedWeather(location: WeatherLocation, data: WeatherSnapshot): void {
  window.localStorage.setItem(
    cacheKey(location),
    JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }),
  );
}

export async function resolveCurrentLocation(): Promise<WeatherLocation> {
  if (!navigator.geolocation) return ISTANBUL;

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: CACHE_TTL_MS,
      });
    });
    return {
      id: 'current',
      name: 'Mevcut konum',
      country: '',
      latitude: Math.round(position.coords.latitude * LOCATION_PRECISION) / LOCATION_PRECISION,
      longitude: Math.round(position.coords.longitude * LOCATION_PRECISION) / LOCATION_PRECISION,
    };
  } catch {
    return ISTANBUL;
  }
}

function weatherIcon(code: number): string {
  if (code >= 95) return '⛈️';
  if (code >= 80) return '🌦️';
  if (code >= 70) return '🌨️';
  if (code >= 60) return '🌧️';
  if (code >= 45) return '🌫️';
  if (code >= 3) return '☁️';
  return '☀️';
}

export async function getWeatherForLocation(
  location: WeatherLocation,
  forceRefresh = false,
): Promise<WeatherSnapshot> {
  if (!forceRefresh) {
    const cached = readCachedWeather(location);
    if (cached) return cached;
  }

  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,weather_code',
    timezone: 'auto',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Weather request failed');

  const payload = (await response.json()) as WeatherApiResponse;
  const temperature = payload.current?.temperature_2m;
  const code = payload.current?.weather_code;
  if (typeof temperature !== 'number' || typeof code !== 'number') {
    throw new Error('Weather response is incomplete');
  }

  const snapshot: WeatherSnapshot = {
    city: location.country ? `${location.name}, ${location.country}` : location.name,
    temperature: Number(temperature.toFixed(1)),
    label: WEATHER_LABELS[code] ?? 'Hava durumu',
    updatedAt: new Date().toISOString(),
    icon: weatherIcon(code),
  };
  writeCachedWeather(location, snapshot);
  return snapshot;
}

export async function searchWeatherLocations(query: string): Promise<WeatherLocation[]> {
  const normalized = query.trim();
  if (normalized.length < 3) return [];

  const params = new URLSearchParams({
    name: normalized,
    count: '8',
    language: 'tr',
    format: 'json',
  });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('City search failed');

  const payload = (await response.json()) as GeocodingApiResponse;
  return (payload.results ?? []).map((result) => ({
    id: String(result.id),
    name: result.name,
    country: [result.admin1, result.country].filter(Boolean).join(', '),
    latitude: result.latitude,
    longitude: result.longitude,
  }));
}
