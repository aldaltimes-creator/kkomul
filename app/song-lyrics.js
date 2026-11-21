const timedLine = /^\[(\d+):([0-5]\d(?:\.\d{1,3})?)\]\s*(.+)$/;

export function parseLyrics(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.some((line) => /^\[\d+:/.test(line))) return { lines };

  const lineTimes = [];
  const lyrics = lines.map((line, index) => {
    const match = timedLine.exec(line);
    if (!match) throw new Error(`${index + 1}번째 가사 줄의 시간을 [00:12.50] 형식으로 적어 주세요.`);
    const time = Number(match[1]) * 60 + Number(match[2]);
    if (!Number.isFinite(time) || (index > 0 && time <= lineTimes[index - 1])) {
      throw new Error('가사 시간은 앞줄보다 뒤 시각으로 적어 주세요.');
    }
    lineTimes.push(time);
    return match[3];
  });
  return { lines: lyrics, line_times: lineTimes };
}

export function formatLyrics({ lines = [], line_times: times } = {}) {
  return lines.map((line, index) => {
    if (!Number.isFinite(times?.[index])) return line;
    const milliseconds = Math.round(times[index] * 1000);
    const minutes = String(Math.floor(milliseconds / 60000)).padStart(2, '0');
    const seconds = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0');
    return `[${minutes}:${seconds}] ${line}`;
  }).join('\n');
}

export function hasLyricTiming(lines, times) {
  return Boolean(lines.length && Array.isArray(times) && times.length === lines.length
    && times.every((time, index) => Number.isFinite(time) && time >= 0 && (!index || time > times[index - 1])));
}

export function activeLyric(time, times) {
  const next = times.findIndex((start) => time < start);
  return (next < 0 ? times.length : next) - 1;
}
