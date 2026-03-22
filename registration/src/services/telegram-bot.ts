import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Bot, type Context, InlineKeyboard, Keyboard, webhookCallback } from 'grammy';
import {
  claimFirstSuperadmin,
  getTelegramAdminByUserId,
  listTelegramAdmins,
  type TelegramAdminRole,
} from './telegram-admins';
import {
  getTelegramEventById,
  listTelegramEvents,
  setTelegramEventRegistrationState,
  type TelegramEventListFilter,
  type TelegramEventView,
} from './telegram-events';
import { searchRegistrationsByFullName } from './registration-search';

type TelegramBotDeps = {
  db: Database.Database;
  token: string;
  webhookSecret: string;
  appBaseUrl: string;
  webhookPath: string;
  privateKeyPemBase64: string | null;
};

const EVENTS_PER_PAGE = 6;

function formatDisplayName(from: {
  first_name?: string;
  last_name?: string;
  username?: string;
}) {
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }

  return from.username ? `@${from.username}` : null;
}

function buildMainKeyboard(role: TelegramAdminRole) {
  const keyboard = new Keyboard()
    .text('События')
    .text('Поиск')
    .text('Экспорт')
    .row();

  if (role === 'superadmin') {
    keyboard.text('Открыть регистрацию').text('Закрыть регистрацию').text('Операторы').row();
  }

  keyboard.text('Помощь').resized();
  return keyboard;
}

function formatHelp(role: TelegramAdminRole) {
  const lines = [
    'Доступные команды:',
    '/start — открыть главное меню.',
    '/help — показать список команд.',
    '/operators — список администраторов.',
    '',
    'Кнопки:',
    'События — список событий и карточки событий.',
    'Поиск — следующий шаг реализации.',
    'Экспорт — следующий шаг реализации.',
  ];

  if (role === 'superadmin') {
    lines.push('Открыть регистрацию — список будущих событий, доступных для открытия.');
    lines.push('Закрыть регистрацию — список открытых событий.');
    lines.push('Операторы — текущие роли и состав администраторов.');
  }

  return lines.join('\n');
}

function formatEventDate(isoValue: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Kaliningrad',
  }).format(new Date(isoValue));
}

function eventStateLabel(event: TelegramEventView) {
  switch (event.publicState) {
    case 'registration_open':
      return 'Открыта';
    case 'registration_closed':
      return 'Закрыта';
    case 'registration_soon':
      return 'Скоро откроется';
    case 'sold_out':
      return 'Мест нет';
    case 'past':
      return 'Событие прошло';
    default:
      return 'Неизвестно';
  }
}

function truncateLabel(value: string, maxLength = 42) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatEventCard(event: TelegramEventView) {
  return [
    event.title,
    '',
    `Статус: ${eventStateLabel(event)}`,
    `Дата и время: ${formatEventDate(event.startsAt)}`,
    `Площадка: ${event.venueName}`,
    `Зал: ${event.hallName}`,
    `Адрес: ${event.address}`,
    `Мест занято: ${event.seatsTaken} из ${event.capacity}`,
    `Осталось мест: ${event.seatsLeft}`,
  ].join('\n');
}

function formatSearchResults(results: ReturnType<typeof searchRegistrationsByFullName>) {
  return results.map((item, index) => [
    `${index + 1}. ${item.fullName}`,
    `Событие: ${item.eventTitle}`,
    `Дата: ${formatEventDate(item.startsAt)}`,
    `Email: ${item.emailMasked}`,
    `Телефон: ${item.phoneMasked}`,
    item.ticketUrl ? `Билет: ${item.ticketUrl}` : 'Билет: будет доступен после публикации',
  ].join('\n')).join('\n\n');
}

function listHeading(filter: TelegramEventListFilter) {
  if (filter === 'open') {
    return 'Открытые регистрации';
  }

  if (filter === 'closed') {
    return 'События, где можно открыть регистрацию';
  }

  return 'События фестиваля';
}

function buildListKeyboard(items: TelegramEventView[], filter: TelegramEventListFilter, page: number) {
  const keyboard = new InlineKeyboard();

  for (const item of items) {
    keyboard.text(truncateLabel(item.title), `e:${item.id}:${filter}:${page}`).row();
  }

  if (page > 1) {
    keyboard.text('‹ Назад', `l:${filter}:${page - 1}`);
  }

  if (items.length === EVENTS_PER_PAGE) {
    keyboard.text('Дальше ›', `l:${filter}:${page + 1}`);
  }

  return keyboard;
}

function buildEventKeyboard(event: TelegramEventView, role: TelegramAdminRole, filter: TelegramEventListFilter, page: number) {
  const keyboard = new InlineKeyboard();

  if (role === 'superadmin') {
    if (event.publicState === 'registration_open') {
      keyboard.text('Закрыть регистрацию', `s:${event.id}:c:${filter}:${page}`).row();
    } else if (event.publicState !== 'past' && event.publicState !== 'sold_out') {
      keyboard.text('Открыть регистрацию', `s:${event.id}:o:${filter}:${page}`).row();
    }
  }

  keyboard.text('Остаток мест', `m:${event.id}:${filter}:${page}`);
  keyboard.text('Отчёт', `r:${event.id}:${filter}:${page}`);
  keyboard.text('XLSX', `x:${event.id}:${filter}:${page}`).row();
  keyboard.text('Назад к списку', `l:${filter}:${page}`);
  return keyboard;
}

function paginate<T>(items: T[], page: number, perPage: number) {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

async function sendEventList(
  ctx: Context,
  db: Database.Database,
  _role: TelegramAdminRole,
  filter: TelegramEventListFilter,
  page: number,
  editCurrentMessage = false,
) {
  const allItems = listTelegramEvents(db, filter);
  const items = paginate(allItems, page, EVENTS_PER_PAGE);
  const text = items.length
    ? `${listHeading(filter)}\n\nВыберите событие ниже.`
    : `${listHeading(filter)}\n\nСейчас подходящих событий нет.`;
  const keyboard = items.length ? buildListKeyboard(items, filter, page) : undefined;

  if (editCurrentMessage && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, {
      reply_markup: keyboard,
    });
    return;
  }

  await ctx.reply(text, {
    reply_markup: keyboard,
  });
}

async function sendEventCard(
  ctx: Context,
  db: Database.Database,
  role: TelegramAdminRole,
  eventId: number,
  filter: TelegramEventListFilter,
  page: number,
) {
  const event = getTelegramEventById(db, eventId);
  if (!event) {
    await ctx.answerCallbackQuery({
      text: 'Событие не найдено.',
      show_alert: true,
    });
    return;
  }

  await ctx.editMessageText(formatEventCard(event), {
    reply_markup: buildEventKeyboard(event, role, filter, page),
  });
}

export function registerTelegramBot(app: FastifyInstance, deps: TelegramBotDeps) {
  const bot = new Bot(deps.token);
  const pendingFindPrompts = new Map<string, number>();

  const requireAdminRole = (telegramUserId: string) => getTelegramAdminByUserId(deps.db, telegramUserId);

  bot.catch((error) => {
    app.log.error({ err: error.error }, 'telegram_bot_error');
  });

  bot.command('start', async (ctx) => {
    const telegramUserId = String(ctx.from?.id ?? '');
    if (!telegramUserId) {
      return;
    }

    const claimed = claimFirstSuperadmin(deps.db, {
      telegramUserId,
      displayName: formatDisplayName(ctx.from ?? {}),
    });

    const admin = claimed ?? requireAdminRole(telegramUserId);
    if (!admin) {
      await ctx.reply(
        'Суперадмин уже назначен. Попросите действующего суперадмина добавить вам операторский доступ.',
      );
      return;
    }

    const greeting = claimed
      ? 'Вы стали суперадмином бота. Ниже доступна кнопочная навигация.'
      : 'Главное меню открыто. Используйте кнопки ниже.';

    await ctx.reply(greeting, {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.command('help', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.reply('Доступ к боту ограничен администраторами.');
      return;
    }

    await ctx.reply(formatHelp(admin.role), {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.command('events', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.reply('Доступ к боту ограничен администраторами.');
      return;
    }

    await sendEventList(ctx, deps.db, admin.role, 'all', 1);
  });

  bot.command('find', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.reply('Доступ к боту ограничен администраторами.');
      return;
    }

    if (!deps.privateKeyPemBase64) {
      await ctx.reply('Поиск пока недоступен: на сервере не настроен приватный ключ для расшифровки ПДн.');
      return;
    }

    const commandText = ctx.message?.text ?? '';
    const query = commandText.replace(/^\/find(@\w+)?/u, '').trim();

    if (!query) {
      pendingFindPrompts.set(String(ctx.from?.id ?? ''), Date.now());
      await ctx.reply('Пришлите ФИО следующим сообщением, и я покажу последние совпадения.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    const results = searchRegistrationsByFullName(deps.db, deps.privateKeyPemBase64, query);
    if (!results.length) {
      await ctx.reply('Совпадений не найдено.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    await ctx.reply(formatSearchResults(results), {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.command('operators', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.reply('Доступ к боту ограничен администраторами.');
      return;
    }

    if (admin.role !== 'superadmin') {
      await ctx.reply('Список операторов доступен только суперадмину.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    const admins = listTelegramAdmins(deps.db);
    const body = admins.length
      ? admins.map((item, index) => `${index + 1}. ${item.displayName ?? item.telegramUserId} — ${item.role}`).join('\n')
      : 'Администраторы пока не назначены.';

    await ctx.reply(`Администраторы бота:\n${body}`, {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.hears('События', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      return;
    }

    await sendEventList(ctx, deps.db, admin.role, 'all', 1);
  });

  bot.hears('Открыть регистрацию', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin || admin.role !== 'superadmin') {
      return;
    }

    await sendEventList(ctx, deps.db, admin.role, 'closed', 1);
  });

  bot.hears('Закрыть регистрацию', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin || admin.role !== 'superadmin') {
      return;
    }

    await sendEventList(ctx, deps.db, admin.role, 'open', 1);
  });

  bot.hears('Помощь', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      return;
    }

    await ctx.reply(formatHelp(admin.role), {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.hears(['Поиск', 'Экспорт'], async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      return;
    }

    if (ctx.message?.text === 'Поиск') {
      if (!deps.privateKeyPemBase64) {
        await ctx.reply('Поиск пока недоступен: на сервере не настроен приватный ключ.', {
          reply_markup: buildMainKeyboard(admin.role),
        });
        return;
      }

      pendingFindPrompts.set(String(ctx.from?.id ?? ''), Date.now());
      await ctx.reply('Пришлите ФИО следующим сообщением. Я покажу до 10 последних совпадений.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    await ctx.reply('Раздел экспорта будет добавлен следующим шагом. Уже доступен список событий и управление открытием/закрытием регистрации.', {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.hears('Операторы', async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      return;
    }

    if (admin.role !== 'superadmin') {
      await ctx.reply('Раздел операторов доступен только суперадмину.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    const admins = listTelegramAdmins(deps.db);
    const body = admins.length
      ? admins.map((item, index) => `${index + 1}. ${item.displayName ?? item.telegramUserId} — ${item.role}`).join('\n')
      : 'Администраторы пока не назначены.';

    await ctx.reply(`Администраторы бота:\n${body}`, {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  bot.callbackQuery(/^l:(all|open|closed):(\d+)$/u, async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.answerCallbackQuery({
        text: 'Недостаточно прав.',
        show_alert: true,
      });
      return;
    }

    const [, filter, pageRaw] = ctx.match;
    await ctx.answerCallbackQuery();
    await sendEventList(ctx, deps.db, admin.role, filter as TelegramEventListFilter, Number(pageRaw), true);
  });

  bot.callbackQuery(/^e:(\d+):(all|open|closed):(\d+)$/u, async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.answerCallbackQuery({
        text: 'Недостаточно прав.',
        show_alert: true,
      });
      return;
    }

    const [, eventIdRaw, filter, pageRaw] = ctx.match;
    await ctx.answerCallbackQuery();
    await sendEventCard(ctx, deps.db, admin.role, Number(eventIdRaw), filter as TelegramEventListFilter, Number(pageRaw));
  });

  bot.callbackQuery(/^s:(\d+):(o|c):(all|open|closed):(\d+)$/u, async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin || admin.role !== 'superadmin') {
      await ctx.answerCallbackQuery({
        text: 'Только суперадмин может менять статус регистрации.',
        show_alert: true,
      });
      return;
    }

    const [, eventIdRaw, action, filter, pageRaw] = ctx.match;
    const nextState = action === 'o' ? 'open' : 'closed';
    const updated = setTelegramEventRegistrationState(deps.db, Number(eventIdRaw), nextState);

    await ctx.answerCallbackQuery({
      text: updated
        ? action === 'o' ? 'Регистрация открыта.' : 'Регистрация закрыта.'
        : 'Событие не найдено.',
    });

    if (!updated) {
      return;
    }

    await ctx.editMessageText(formatEventCard(updated), {
      reply_markup: buildEventKeyboard(updated, admin.role, filter as TelegramEventListFilter, Number(pageRaw)),
    });
  });

  bot.callbackQuery(/^m:(\d+):(all|open|closed):(\d+)$/u, async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.answerCallbackQuery({
        text: 'Недостаточно прав.',
        show_alert: true,
      });
      return;
    }

    const [, eventIdRaw] = ctx.match;
    const event = getTelegramEventById(deps.db, Number(eventIdRaw));
    await ctx.answerCallbackQuery({
      text: event ? `Осталось мест: ${event.seatsLeft}` : 'Событие не найдено.',
      show_alert: true,
    });
  });

  bot.callbackQuery(/^(r|x):(\d+):(all|open|closed):(\d+)$/u, async (ctx) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await ctx.answerCallbackQuery({
        text: 'Недостаточно прав.',
        show_alert: true,
      });
      return;
    }

    const [, action] = ctx.match;
    await ctx.answerCallbackQuery({
      text: action === 'r'
        ? 'Кнопка отчёта уже зарезервирована. Добавлю event-level отчёт следующим шагом.'
        : 'Кнопка XLSX уже зарезервирована. Добавлю выгрузку следующим шагом.',
      show_alert: true,
    });
  });

  bot.on('message:text', async (ctx, next) => {
    const admin = requireAdminRole(String(ctx.from?.id ?? ''));
    if (!admin) {
      await next();
      return;
    }

    const userId = String(ctx.from?.id ?? '');
    const pendingAt = pendingFindPrompts.get(userId);
    const text = ctx.message.text.trim();
    const reservedLabels = new Set([
      'События',
      'Поиск',
      'Экспорт',
      'Открыть регистрацию',
      'Закрыть регистрацию',
      'Операторы',
      'Помощь',
    ]);

    if (!pendingAt || !deps.privateKeyPemBase64 || text.startsWith('/') || reservedLabels.has(text)) {
      await next();
      return;
    }

    pendingFindPrompts.delete(userId);
    const results = searchRegistrationsByFullName(deps.db, deps.privateKeyPemBase64, text);
    if (!results.length) {
      await ctx.reply('Совпадений не найдено.', {
        reply_markup: buildMainKeyboard(admin.role),
      });
      return;
    }

    await ctx.reply(formatSearchResults(results), {
      reply_markup: buildMainKeyboard(admin.role),
    });
  });

  const webhookHandler = webhookCallback(bot, 'fastify');

  app.post(deps.webhookPath, async (request, reply) => {
    const secret = request.headers['x-telegram-bot-api-secret-token'];
    if (secret !== deps.webhookSecret) {
      reply.code(401);
      return {
        error: 'telegram_secret_mismatch',
      };
    }

    return webhookHandler(request, reply);
  });

  return {
    bot,
    async ensureWebhook() {
      const webhookUrl = `${deps.appBaseUrl.replace(/\/+$/u, '')}${deps.webhookPath}`;
      await bot.api.setWebhook(webhookUrl, {
        secret_token: deps.webhookSecret,
        allowed_updates: ['message', 'callback_query'],
      });
    },
  };
}
