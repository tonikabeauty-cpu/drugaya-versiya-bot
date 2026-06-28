const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ELINA_ID = process.env.TELEGRAM_ELINA_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Хранилище постов ожидающих публикации (в памяти)
const pendingPosts = {};

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const update = req.body;

  // Нажатие кнопки
  if (update.callback_query) {
    const query = update.callback_query;
    const data = query.data;
    const msgId = query.message.message_id;
    const chatId = query.message.chat.id;

    // Убираем кнопки с сообщения
    await tg('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: { inline_keyboard: [] }
    });

    if (data === 'approve') {
      // Публикуем в канал
      const post = pendingPosts[msgId];
      if (post) {
        if (post.photo_file_id) {
          await tg('sendPhoto', {
            chat_id: CHANNEL_ID,
            photo: post.photo_file_id,
            caption: post.text
          });
        } else {
          await tg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: post.text
          });
        }
        delete pendingPosts[msgId];
      }

      await tg('sendMessage', {
        chat_id: ELINA_ID,
        text: '✅ Опубликовано в канал!'
      });

    } else if (data === 'reject') {
      delete pendingPosts[msgId];
      await tg('sendMessage', {
        chat_id: ELINA_ID,
        text: '❌ Пост отклонён.'
      });
    }

    await tg('answerCallbackQuery', { callback_query_id: query.id });
  }
});

// Эндпоинт для отправки поста на согласование (вызываю из Claude)
app.post('/send-for-approval', async (req, res) => {
  const { text, photo_file_id } = req.body;

  let result;
  if (photo_file_id) {
    result = await tg('sendPhoto', {
      chat_id: ELINA_ID,
      photo: photo_file_id,
      caption: text,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Опубликовать', callback_data: 'approve' },
          { text: '❌ Отклонить', callback_data: 'reject' }
        ]]
      }
    });
  } else {
    result = await tg('sendMessage', {
      chat_id: ELINA_ID,
      text: `📝 Пост на согласование:\n\n${text}`,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Опубликовать', callback_data: 'approve' },
          { text: '❌ Отклонить', callback_data: 'reject' }
        ]]
      }
    });
  }

  if (result.ok) {
    // Запоминаем пост по message_id
    pendingPosts[result.result.message_id] = { text, photo_file_id };
    res.json({ ok: true, message_id: result.result.message_id });
  } else {
    res.json({ ok: false, error: result.description });
  }
});

app.get('/', (req, res) => res.send('Bot is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
