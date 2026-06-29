const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const ELINA_ID = process.env.TELEGRAM_ELINA_ID;
const API = `https://api.telegram.org/bot${TOKEN}`;

const POSTS_FILE = path.join(__dirname, 'pending_posts.json');

function loadPosts() {
  try {
    if (fs.existsSync(POSTS_FILE)) {
      return JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load pending_posts.json:', e.message);
  }
  return {};
}

function savePosts(posts) {
  try {
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts), 'utf8');
  } catch (e) {
    console.error('Failed to save pending_posts.json:', e.message);
  }
}

async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Загружаем посты с диска при старте
const pendingPosts = loadPosts();
console.log(`Loaded ${Object.keys(pendingPosts).length} pending post(s) from disk`);

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const update = req.body;

  if (update.callback_query) {
    const query = update.callback_query;
    const data = query.data;
    const msgId = query.message.message_id;
    const chatId = query.message.chat.id;

    await tg('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: msgId,
      reply_markup: { inline_keyboard: [] }
    });

    if (data === 'approve') {
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
        savePosts(pendingPosts);
      }

      await tg('sendMessage', {
        chat_id: ELINA_ID,
        text: '✅ Опубликовано в канал!'
      });

    } else if (data === 'reject') {
      delete pendingPosts[msgId];
      savePosts(pendingPosts);
      await tg('sendMessage', {
        chat_id: ELINA_ID,
        text: '❌ Пост отклонён.'
      });
    }

    await tg('answerCallbackQuery', { callback_query_id: query.id });
  }
});

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
    pendingPosts[result.result.message_id] = { text, photo_file_id };
    savePosts(pendingPosts);
    res.json({ ok: true, message_id: result.result.message_id });
  } else {
    res.json({ ok: false, error: result.description });
  }
});

app.get('/', (req, res) => res.send('Bot is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
