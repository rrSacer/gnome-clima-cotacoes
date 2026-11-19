import {getJson} from './http.js';

// Códigos WMO do Open-Meteo -> texto em português e ícone simbólico do tema.
const CODES = [
  [[0], 'Céu limpo', 'weather-clear', 'weather-clear-night', 'sun'],
  [[1], 'Predominantemente limpo', 'weather-few-clouds', 'weather-few-clouds-night', 'sun'],
  [[2], 'Parcialmente nublado', 'weather-few-clouds', 'weather-few-clouds-night', 'cloud'],
  [[3], 'Nublado', 'weather-overcast', 'weather-overcast', 'cloud'],
  [[45, 48], 'Neblina', 'weather-fog', 'weather-fog', 'cloud'],
  [[51, 53, 55, 56, 57], 'Garoa', 'weather-showers-scattered', 'weather-showers-scattered', 'rain'],
  [[61, 63, 65, 66, 67], 'Chuva', 'weather-showers', 'weather-showers', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Neve', 'weather-snow', 'weather-snow', 'snow'],
  [[80, 81, 82], 'Pancadas de chuva', 'weather-showers', 'weather-showers', 'rain'],
  [[95, 96, 99], 'Trovoadas', 'weather-storm', 'weather-storm', 'storm'],
];

export function describeCode(code, isDay = true) {
  for (const [codes, label, day, night, tone] of CODES) {
    if (codes.includes(code))
      return {label, icon: `${isDay ? day : night}-symbolic`, tone};
  }
  return {label: 'Sem dados', icon: 'weather-overcast-symbolic', tone: 'cloud'};
}

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAYS_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function weekdayShort(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

export function weekdayLong(date = new Date()) {
  return DAYS_LONG[date.getDay()];
}

export async function fetchWeather(lat, lon, cancellable = null) {
  const params = [
    `latitude=${lat}`, `longitude=${lon}`,
    'current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day',
    'hourly=temperature_2m,precipitation_probability,weather_code,is_day',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    'timezone=auto', 'forecast_days=7', 'wind_speed_unit=kmh',
  ].join('&');
  const data = await getJson(`https://api.open-meteo.com/v1/forecast?${params}`, cancellable);

  const cur = data.current;
  const hourKey = cur.time.slice(0, 13);
  let start = data.hourly.time.findIndex(t => t.startsWith(hourKey));
  if (start < 0) start = 0;

  const hours = [];
  for (let i = start; i < start + 24 && i < data.hourly.time.length; i += 3) {
    hours.push({
      hour: Number(data.hourly.time[i].slice(11, 13)),
      temp: data.hourly.temperature_2m[i],
      rain: data.hourly.precipitation_probability[i],
      code: data.hourly.weather_code[i],
      isDay: data.hourly.is_day[i] === 1,
    });
  }

  const rainNow = data.hourly.precipitation_probability[start];
  const days = data.daily.time.map((t, i) => ({
    date: t,
    max: data.daily.temperature_2m_max[i],
    min: data.daily.temperature_2m_min[i],
    rain: data.daily.precipitation_probability_max[i],
    code: data.daily.weather_code[i],
  }));

  return {
    temp: cur.temperature_2m,
    feels: cur.apparent_temperature,
    humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m,
    rain: rainNow,
    code: cur.weather_code,
    isDay: cur.is_day === 1,
    hours,
    days,
    fetchedAt: new Date(),
  };
}

export async function searchCity(name, cancellable = null) {
  const q = encodeURIComponent(name.split(',')[0].trim());
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=5&language=pt&format=json`, cancellable);
  return (data.results ?? []).map(r => ({
    name: [r.name, r.admin1].filter(Boolean).join(', '),
    country: r.country ?? '',
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}
