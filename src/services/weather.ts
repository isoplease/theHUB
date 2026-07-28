import type { WeatherSnapshot } from '../types/app';

const WEATHER_CACHE_KEY = 'weather-cache-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const LOCATION_PRECISION = 100;

interface WeatherApiResponse {
  current_weather?: {
    temperature?: number;
    weathercode?: number;
    time?: string;
  };
}

const WEATHER_LABELS: Record<number, string> = {
  0: 'Açık',
  1: 'Çoğunlukla açık',
  2: 'Parçalı bulutlu',
  3: 'Kapalı',
  45: 'Sis',
  48: 'Pus',
  51: 'Hafif yağmur',
  53: 'Orta yağmur',
  55: 'Yoğun yağmur',
  61: 'Hafif kar',
  63: 'Orta kar',
  65: 'Yoğun kar',
  80: 'Sağanak',
  95: 'Fırtına',
};

function getCachedWeather(): WeatherSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const cached = window.localStorage.getItem(WEATHER_CACHE_KEY);
  if (!cached) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached) as { expiresAt: number; data: WeatherSnapshot };
    if (parsed.expiresAt > Date.now()) {
      return parsed.data;
    }
  } catch {
    window.localStorage.removeItem(WEATHER_CACHE_KEY);
  }

  return null;
}

function setCachedWeather(data: WeatherSnapshot): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    WEATHER_CACHE_KEY,
    JSON.stringify({
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    }),
  );
}

async function getCurrentLocation(): Promise<{ latitude: number; longitude: number; city: string }> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { latitude: 41.0082, longitude: 28.9784, city: 'İstanbul' };
  }

  try {
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: CACHE_TTL_MS,
      });
    });
    return {
      // Weather data does not require exact coordinates. Rounding to two decimal
      // places avoids sharing a user's precise location with the weather provider.
      latitude: Math.round(position.coords.latitude * LOCATION_PRECISION) / LOCATION_PRECISION,
      longitude: Math.round(position.coords.longitude * LOCATION_PRECISION) / LOCATION_PRECISION,
      city: 'Konum',
    };
  } catch {
    return { latitude: 41.0082, longitude: 28.9784, city: 'İstanbul' };
  }
}

function getWeatherLabel(code: number): string {
  return WEATHER_LABELS[code] ?? 'Hava durumu';
}

export async function getWeatherSnapshot(): Promise<WeatherSnapshot> {
  const cached = getCachedWeather();
  if (cached) {
    return cached;
  }

  const location = await getCurrentLocation();
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true&timezone=auto`;
  const response = await fetch(weatherUrl);

  if (!response.ok) {
    throw new Error('Weather request failed');
  }

  const payload = (await response.json()) as WeatherApiResponse;
  const currentWeather = payload.current_weather;
  const temperature = currentWeather?.temperature ?? 0;
  const weatherCode = currentWeather?.weathercode ?? 0;
  const snapshot: WeatherSnapshot = {
    city: location.city,
    temperature: Number(temperature.toFixed(1)),
    label: getWeatherLabel(weatherCode),
    updatedAt: new Date().toISOString(),
    icon: weatherCode >= 95 ? '⛈️' : weatherCode >= 80 ? '🌦️' : weatherCode >= 60 ? '🌨️' : weatherCode >= 45 ? '🌫️' : weatherCode >= 3 ? '☁️' : '☀️',
  };

  setCachedWeather(snapshot);
  return snapshot;
}
