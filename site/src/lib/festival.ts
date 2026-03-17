import fs from 'node:fs';
import path from 'node:path';
import mediaManifest from '../data/media-manifest.json';

type MediaManifest = {
  events: Record<string, string>;
  speakers: Record<string, string[]>;
};

const media = mediaManifest as MediaManifest;

export type FestivalEvent = {
  slug: string;
  title: string;
  format: string;
  formatLabel: string;
  dateLabel: string;
  monthLabel: string;
  monthAnchor: string;
  timeLabel: string;
  durationLabel: string;
  venue: string;
  address: string;
  city: string;
  speakerLabel: string;
  affiliation: string;
  summary: string;
  whyGo: string;
  registrationUrl?: string;
  calendarReady: boolean;
  googleCalendarUrl?: string;
  icsUrl?: string;
  calendarNote?: string;
  image?: string;
  speakerImages: string[];
  kind: 'dated' | 'range' | 'special';
  isoStart?: string;
};

const MONTHS: Record<string, { number: string; label: string; anchor: string }> = {
  января: { number: '01', label: 'Январь', anchor: 'january' },
  февраля: { number: '02', label: 'Февраль', anchor: 'february' },
  марта: { number: '03', label: 'Март', anchor: 'march' },
  апреля: { number: '04', label: 'Апрель', anchor: 'april' },
  мая: { number: '05', label: 'Май', anchor: 'may' },
  июня: { number: '06', label: 'Июнь', anchor: 'june' },
  июля: { number: '07', label: 'Июль', anchor: 'july' },
};

const ROOT_DIR = path.resolve(process.cwd(), '..');
const MASTER_PATH = path.resolve(ROOT_DIR, 'Исходные данные', 'festival_site_master_actual_v3.md');
const DEFAULT_CITY = 'Калининград';

const EVENT_IMAGE_RULES: Array<{ matches: string[]; manifestKey: string }> = [
  {
    matches: ['советское монументальное искусство'],
    manifestKey: 'Советское монументальное искусство - Мосиенко',
  },
  {
    matches: ['поэт', 'поэтов'],
    manifestKey: 'Калининград - город поэтов - Ярцев',
  },
  {
    matches: ['кирхи', 'форты'],
    manifestKey: 'Кирхи, форты - Долотова',
  },
  {
    matches: ['мост', 'времени'],
    manifestKey: 'Мосты времени - Мосиенко',
  },
  {
    matches: ['куршск', 'коса'],
    manifestKey: 'Образование куршской косы - Скребкова',
  },
  {
    matches: ['балтийск', 'коса'],
    manifestKey: 'Самая западная точка России Балтийская коса - Надымова',
  },
  {
    matches: ['архитектура', 'советск'],
    manifestKey: 'Советская архитектура - Попадин',
  },
  {
    matches: ['торговый порт'],
    manifestKey: 'Торговый порт - Нижегородцева',
  },
  {
    matches: ['яхт', 'парус'],
    manifestKey: 'Яхты1 - Жадобко',
  },
  {
    matches: ['великие учителя'],
    manifestKey: 'Великие учителя - Илюшкина',
  },
  {
    matches: ['этюды той весны'],
    manifestKey: 'Этюды той весны - 1',
  },
];

const SPEAKER_IMAGE_RULES: Array<{ matches: string[]; manifestKey: string }> = [
  { matches: ['жадобко'], manifestKey: 'Жадобко Сергей' },
  { matches: ['илюшкина'], manifestKey: 'Илюшкина Екатерина' },
  { matches: ['машинская'], manifestKey: 'Машинская Екатерина' },
  { matches: ['мосиенко'], manifestKey: 'Мосиенко Евгений' },
  { matches: ['надымова'], manifestKey: 'Надымова Валерия' },
  { matches: ['нижегородцева'], manifestKey: 'Нижегородцева Евгения' },
  { matches: ['попадин'], manifestKey: 'Попадин Александр' },
  { matches: ['скребцова', 'скребкова'], manifestKey: 'Скребцова Анастасия' },
  { matches: ['удовенко'], manifestKey: 'Удовенко Татьяна' },
  { matches: ['ярцев'], manifestKey: 'Ярцев Андрей' },
];

let cache: FestivalEvent[] | null = null;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractField(body: string, label: string) {
  const pattern = new RegExp(`\\*\\*${escapeRegex(label)}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*|$)`);
  const match = body.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function extractFirst(body: string, labels: string[]) {
  for (const label of labels) {
    const value = extractField(body, label);
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^"+|"+$/g, '')
    .trim();
}

function transliterate(input: string) {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y',
    ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  return input
    .toLowerCase()
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function toSlug(title: string) {
  return transliterate(title) || 'sobytiye';
}

function parseDurationMinutes(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('длительный') || normalized.includes('уточ')) {
    return null;
  }

  const hours = normalized.match(/(\d+)\s*час/);
  const minutes = normalized.match(/(\d+)\s*мин/);
  return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0) || null;
}

function parseExactDate(dateLabel: string, timeLabel: string) {
  if (!dateLabel || !timeLabel || timeLabel.includes('уточ') || timeLabel.includes('объяв')) {
    return null;
  }

  const dateMatch = dateLabel.match(/(\d{1,2})\s+([а-я]+)\s+2026/i);
  const timeMatch = timeLabel.match(/(\d{1,2}):(\d{2})/);
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const monthInfo = MONTHS[dateMatch[2].toLowerCase()];
  if (!monthInfo) {
    return null;
  }

  const day = dateMatch[1].padStart(2, '0');
  const hour = timeMatch[1].padStart(2, '0');
  const minute = timeMatch[2];

  return {
    isoStart: `2026-${monthInfo.number}-${day}T${hour}:${minute}:00`,
    monthLabel: monthInfo.label,
    monthAnchor: monthInfo.anchor,
  };
}

function parseRangeStart(heading: string) {
  const match = heading.match(/(?:с\s+)?(\d{1,2})\s+([а-я]+)(?:\s+по|\s*-\s*)(\d{1,2})?\s*([а-я]+)?\s+2026/i);
  if (!match) {
    return null;
  }

  const monthInfo = MONTHS[match[2].toLowerCase()];
  if (!monthInfo) {
    return null;
  }

  const day = match[1].padStart(2, '0');
  return {
    isoStart: `2026-${monthInfo.number}-${day}T00:00:00`,
    monthLabel: monthInfo.label,
    monthAnchor: monthInfo.anchor,
  };
}

function parseHeaderTitle(heading: string) {
  if (heading.includes(' — ')) {
    return heading.split(' — ').slice(1).join(' — ').trim().replace(/^«|»$/g, '');
  }
  return heading.trim();
}

function normalizeFormatName(raw: string) {
  return raw
    .replace('Паблик-ток', 'Открытый диалог')
    .replace('паблик-ток', 'Открытый диалог')
    .replace('Открытие фестиваля + паблик-ток', 'Открытие фестиваля');
}

function matchByRules(value: string, rules: Array<{ matches: string[]; manifestKey: string }>) {
  const lowered = value.toLowerCase();
  const rule = rules.find((entry) => entry.matches.every((match) => lowered.includes(match)));
  return rule?.manifestKey;
}

function assignImage(title: string) {
  const key = matchByRules(title, EVENT_IMAGE_RULES);
  return key ? media.events[key] : undefined;
}

function assignSpeakerImages(speakerValue: string) {
  const key = matchByRules(speakerValue, SPEAKER_IMAGE_RULES);
  return key ? media.speakers[key] ?? [] : [];
}

function splitSpeakerData(raw: string) {
  if (!raw) {
    return { speakerLabel: '', affiliation: '' };
  }

  const normalized = normalizeText(raw);
  const parts = normalized.split(' — ');
  return {
    speakerLabel: parts[0] ?? normalized,
    affiliation: parts.slice(1).join(' — '),
  };
}

function toUtcDate(isoStart: string, durationMinutes: number) {
  const start = new Date(isoStart);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const utcShiftMs = 2 * 60 * 60 * 1000;
  return {
    start: new Date(start.getTime() - utcShiftMs),
    end: new Date(end.getTime() - utcShiftMs),
  };
}

function formatIcsDate(date: Date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function createCalendarLinks(event: {
  title: string;
  slug: string;
  summary: string;
  venue: string;
  address: string;
  isoStart?: string;
  durationMinutes: number | null;
}) {
  if (!event.isoStart || !event.durationMinutes) {
    return { ready: false, note: 'Календарь появится после уточнения времени.' };
  }

  const utc = toUtcDate(event.isoStart, event.durationMinutes);
  const dateRange = `${formatIcsDate(utc.start)}/${formatIcsDate(utc.end)}`;
  const details = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    details: event.summary,
    location: `${event.venue}, ${event.address}, ${DEFAULT_CITY}`,
    ctz: 'Europe/Kaliningrad',
    dates: dateRange,
  });

  return {
    ready: true,
    googleUrl: `https://calendar.google.com/calendar/render?${details.toString()}`,
    icsUrl: `/calendar/${event.slug}.ics`,
  };
}

function sortEvents(events: FestivalEvent[]) {
  return events.sort((left, right) => {
    if (left.kind === 'special' && right.kind !== 'special') {
      return 1;
    }
    if (left.kind !== 'special' && right.kind === 'special') {
      return -1;
    }
    if (left.isoStart && right.isoStart) {
      return left.isoStart.localeCompare(right.isoStart);
    }
    if (left.isoStart) {
      return -1;
    }
    if (right.isoStart) {
      return 1;
    }
    return left.title.localeCompare(right.title, 'ru');
  });
}

function parseSections() {
  const source = fs.readFileSync(MASTER_PATH, 'utf-8');
  const programText = source.split('## Подтверждённая программа')[1] ?? source;

  const chunks = programText
    .split('\n## ')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, index) => (index === 0 ? chunk.replace(/^##\s*/, '') : chunk));

  const events: FestivalEvent[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    const heading = lines[0]?.trim();
    const body = lines.slice(1).join('\n').trim();

    if (!heading || !body) {
      continue;
    }

    const title = parseHeaderTitle(heading);
    const slug = toSlug(title);
    const formatRaw = extractField(body, 'Формат') || 'Событие';
    const formatLabel = normalizeFormatName(formatRaw);
    const durationLabel = extractField(body, 'Длительность') || '1 час';
    const summary = normalizeText(
      extractField(body, 'Короткое описание для афиши — версия 1') ||
      extractField(body, 'Короткое описание для афиши — версия 2') ||
      extractField(body, 'Основа для описания'),
    );
    const whyGo = normalizeText(
      extractFirst(body, [
        'Зачем идти на эту лекцию',
        'Зачем идти на это событие',
        'Зачем посетить выставку',
        'Зачем идти на фестиваль',
        'Зачем идти на спектакль',
      ]),
    );
    const venue = extractField(body, 'Площадка') || 'Площадка уточняется';
    const address = extractField(body, 'Короткий адрес') || 'Адрес уточняется';
    const speakerRaw = normalizeText(
      extractField(body, 'Спикер') ||
      extractField(body, 'Участники') ||
      extractField(body, 'Партнёр / источник материалов') ||
      extractField(body, 'Рабочая привязка в таблице'),
    );
    const speakerData = splitSpeakerData(speakerRaw);
    const dateLabel = extractField(body, 'Дата') || extractField(body, 'Период проведения') || 'Дата будет объявлена';
    const timeLabel = extractField(body, 'Время') || extractField(body, 'Время посещения') || 'Время будет объявлено';
    const kind: FestivalEvent['kind'] = heading.startsWith('Спецсобытие')
      ? 'special'
      : formatRaw.includes('Выставка') || body.includes('**Период проведения:**')
        ? 'range'
        : 'dated';

    const exactDate = parseExactDate(dateLabel, timeLabel);
    const rangeDate = kind === 'range' ? parseRangeStart(heading) : null;
    const monthInfo = exactDate || rangeDate || { monthLabel: 'Скоро', monthAnchor: 'soon' };
    const durationMinutes = parseDurationMinutes(durationLabel);
    const calendar = createCalendarLinks({
      title,
      slug,
      summary: whyGo || summary,
      venue,
      address,
      isoStart: exactDate?.isoStart,
      durationMinutes,
    });

    events.push({
      slug,
      title,
      format: formatRaw,
      formatLabel,
      dateLabel,
      monthLabel: monthInfo.monthLabel,
      monthAnchor: monthInfo.monthAnchor,
      timeLabel,
      durationLabel,
      venue,
      address,
      city: DEFAULT_CITY,
      speakerLabel: speakerData.speakerLabel,
      affiliation: speakerData.affiliation,
      summary,
      whyGo,
      registrationUrl: kind === 'special' ? undefined : `https://example.com/register?event=${slug}`,
      calendarReady: kind === 'special' ? false : calendar.ready,
      googleCalendarUrl: kind === 'special' ? undefined : calendar.googleUrl,
      icsUrl: kind === 'special' ? undefined : calendar.icsUrl,
      calendarNote: kind === 'special' ? 'Дата спектакля будет объявлена позже.' : calendar.note,
      image: assignImage(title),
      speakerImages: assignSpeakerImages(`${speakerData.speakerLabel} ${speakerData.affiliation}`),
      kind,
      isoStart: exactDate?.isoStart ?? rangeDate?.isoStart,
    });
  }

  return sortEvents(events);
}

export function getFestivalEvents() {
  if (!cache) {
    cache = parseSections();
  }
  return cache;
}

export function getMonthGroups(events: FestivalEvent[]) {
  const groups = new Map<string, { label: string; anchor: string; events: FestivalEvent[] }>();

  for (const event of events) {
    const key = event.monthAnchor;
    const current = groups.get(key);
    if (current) {
      current.events.push(event);
    } else {
      groups.set(key, {
        label: event.monthLabel,
        anchor: event.monthAnchor,
        events: [event],
      });
    }
  }

  return Array.from(groups.values());
}

export function getSpeakerShowcase(events: FestivalEvent[]) {
  const bySpeaker = new Map<string, { name: string; affiliation: string; image: string; anchor: string }>();

  for (const event of events) {
    if (!event.speakerLabel || !event.speakerImages.length || bySpeaker.has(event.speakerLabel)) {
      continue;
    }

    bySpeaker.set(event.speakerLabel, {
      name: event.speakerLabel,
      affiliation: event.affiliation,
      image: event.speakerImages[0],
      anchor: `event-${event.slug}`,
    });
  }

  return Array.from(bySpeaker.values()).slice(0, 8);
}

export function getHookQuotes(events: FestivalEvent[]) {
  return events
    .filter((event) => event.whyGo)
    .slice(0, 3)
    .map((event) => ({
      quote: event.whyGo,
      title: event.title,
      anchor: `event-${event.slug}`,
    }));
}

export function getOpenDialogues(events: FestivalEvent[]) {
  return events.filter((event) => event.formatLabel.includes('Открытый диалог'));
}

export function buildIcs(event: FestivalEvent) {
  if (!event.isoStart) {
    return '';
  }

  const durationMinutes = parseDurationMinutes(event.durationLabel);
  if (!durationMinutes) {
    return '';
  }

  const utc = toUtcDate(event.isoStart, durationMinutes);
  const stamp = formatIcsDate(new Date());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//80 историй о главном//Festival Calendar//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.slug}@80istoriy.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${formatIcsDate(utc.start)}`,
    `DTEND:${formatIcsDate(utc.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.whyGo || event.summary)}`,
    `LOCATION:${escapeIcs(`${event.venue}, ${event.address}, ${event.city}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
