import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";

dotenv.config();

const token = process.env.BOT_TOKEN || "";
const supportGroupId = Number(process.env.SUPPORT_GROUP_ID || 0);

if (!token) {
  console.error("BOT_TOKEN is missing. Set it in /opt/somon-support-bot/.env");
  process.exit(1);
}
if (!supportGroupId) {
  console.error("SUPPORT_GROUP_ID is missing. Set it in /opt/somon-support-bot/.env");
  process.exit(1);
}

const bot = new Telegraf(token);

const DATA_DIR = path.resolve(process.cwd(), "data");
const MAP_FILE = path.join(DATA_DIR, "user_topic_map.json");

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const loadMap = () => {
  try {
    ensureDataDir();
    if (!fs.existsSync(MAP_FILE)) return {};
    const raw = fs.readFileSync(MAP_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("Failed to load map:", error);
    return {};
  }
};

const saveMap = (map) => {
  try {
    ensureDataDir();
    fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save map:", error);
  }
};

const map = loadMap();

const getTopicForUser = async (user) => {
  const userId = String(user.id);
  if (map[userId]) return map[userId];

  const titleParts = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const username = user.username ? `@${user.username}` : "";
  const title = `${titleParts || "Пользователь"} ${username} (${user.id})`;

  const topic = await bot.telegram.createForumTopic(supportGroupId, title.trim());
  map[userId] = topic.message_thread_id;
  map[`topic_${topic.message_thread_id}`] = userId;
  saveMap(map);

  return topic.message_thread_id;
};

bot.start(async (ctx) => {
  const text =
    "Здравствуйте! Опишите вашу проблему, и мы передадим ее в поддержку.";
  return ctx.reply(text);
});

bot.on("message", async (ctx) => {
  if (ctx.chat?.type === "private") {
    const user = ctx.from;
    if (!user) return;

    const threadId = await getTopicForUser(user);

    await ctx.telegram.copyMessage(supportGroupId, ctx.chat.id, ctx.message.message_id, {
      message_thread_id: threadId,
    });

    return;
  }

  if (ctx.chat?.id === supportGroupId && ctx.message?.message_thread_id) {
    if (ctx.from?.is_bot) return;
    const threadId = ctx.message.message_thread_id;
    const userId = map[`topic_${threadId}`];
    if (!userId) return;

    await ctx.telegram.copyMessage(Number(userId), ctx.chat.id, ctx.message.message_id);
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
