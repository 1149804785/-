/*
 METADATA
 {
   "name": "ChatDiaryLogger",
   "display_name": {
     "zh": "对话日记助手",
     "en": "Chat Diary Logger"
   },
   "description": {
     "zh": "定时回顾指定chat_id的当日对话，生成自然语言日记并保存到指定文件夹。支持数据库直读与外部AI API生成。",
     "en": "Review daily chat history by chat_id, generate natural diary entries and save to folder."
   },
   "author": ["Operit Community"],
   "category": "Memory",
   "env": [
     {
       "name": "DIARY_AI_API_KEY",
       "description": {
         "zh": "外部AI API密钥（OpenAI兼容格式，如DeepSeek/Kimi）。留空则降级为模板输出。",
         "en": "External AI API key (OpenAI-compatible). Leave empty for template fallback."
       },
       "required": false
     },
     {
       "name": "DIARY_AI_BASE_URL",
       "description": {
         "zh": "API基础URL，例如 https://api.deepseek.com/v1",
         "en": "API base URL, e.g. https://api.deepseek.com/v1"
       },
       "required": false
     },
     {
       "name": "DIARY_AI_MODEL",
       "description": {
         "zh": "模型名称，例如 deepseek-chat / gpt-4o",
         "en": "Model name, e.g. deepseek-chat / gpt-4o"
       },
       "required": false
     }
   ],
   "tools": [
     {
       "name": "setup_diary",
       "description": {
         "zh": "配置日记任务：指定chat_id、保存文件夹、数据库路径、定时小时等",
         "en": "Configure diary task parameters"
       },
       "parameters": [
         {
           "name": "chat_id",
           "description": {"zh": "要回顾的对话ID（可在Operit聊天记录中查看）", "en": "Target chat ID"},
           "type": "string",
           "required": true
         },
         {
           "name": "output_folder",
           "description": {"zh": "日记保存文件夹，如 /sdcard/Documents/OperitDiary", "en": "Output folder path"},
           "type": "string",
           "required": true
         },
         {
           "name": "db_path",
           "description": {"zh": "Operit数据库绝对路径（默认通常无需修改）", "en": "Operit database path"},
           "type": "string",
           "required": false
         },
         {
           "name": "table_name",
           "description": {"zh": "消息表名（默认messages，发现工具可帮你确认）", "en": "Message table name"},
           "type": "string",
           "required": false
         },
         {
           "name": "schedule_hour",
           "description": {"zh": "每日定时执行小时（0-23），默认23", "en": "Daily scheduled hour (0-23)"},
           "type": "integer",
           "required": false
         }
       ]
     },
{
        "name": "run_now",
        "description": {
          "zh": "立即为指定chat_id生成今日日记",
          "en": "Generate diary immediately"
        },
        "parameters": [
          {
            "name": "chat_id",
            "description": {"zh": "对话ID", "en": "Chat ID"},
            "type": "string",
            "required": true
          },
          {
            "name": "output_folder",
            "description": {"zh": "日记保存文件夹", "en": "Output folder"},
            "type": "string",
            "required": true
          },
          {
            "name": "api_key",
            "description": {"zh": "AI API密钥（留空用环境变量）", "en": "API key"},
            "type": "string",
            "required": false
          },
          {
            "name": "api_base_url",
            "description": {"zh": "API地址", "en": "API base URL"},
            "type": "string",
            "required": false
          },
          {
            "name": "api_model",
            "description": {"zh": "模型名", "en": "Model name"},
            "type": "string",
            "required": false
          }
        ]
      }
     {
       "name": "discover_db",
       "description": {
         "zh": "发现Operit数据库表结构，辅助确认正确的表名和字段",
         "en": "Discover database schema"
       },
       "parameters": []
     },
     {
       "name": "get_status",
       "description": {
         "zh": "查看当前配置和上次执行状态，检查今日是否已生成",
         "en": "View config and last run status"
       },
       "parameters": []
     }
   ]
 }
 */

const ChatDiaryLogger = (function () {
  const CONFIG_DIR = "/sdcard/Download/Operit/DiaryPlugin";
  const CONFIG_FILE = CONFIG_DIR + "/config.json";
  const STATUS_FILE = CONFIG_DIR + "/status.json";
  const DEFAULT_DB_PATH = "/data/data/com.ai.assistance.operit/databases/app_database";
  const DEFAULT_TABLE = "messages";
  const DEFAULT_CHAT_ID_COL = "chatId";
  const DEFAULT_CONTENT_COL = "content";
  const DEFAULT_ROLE_COL = "sender";
  const DEFAULT_TIME_COL = "timestamp";

  async function ensureDir(dir) {
    try { await Tools.Files.mkdir(dir); } catch (e) {}
  }

  async function readJson(path) {
    try { const text = await Tools.Files.read(path); return JSON.parse(text); } catch (e) { return null; }
  }

  async function writeJson(path, data) {
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash > 0) { await ensureDir(path.substring(0, lastSlash)); }
    await Tools.Files.write(path, JSON.stringify(data, null, 2));
  }

  function wrap(func, params) {
    return func(params).catch((err) => ({ success: false, message: "执行失败: " + (err && err.message ? err.message : String(err)) }));
  }

  function getTodayDate() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function getNowISO() { return new Date().toISOString(); }

  async function queryChatHistory(dbPath, tableName, chatId, columns) {
    const SQLiteDatabase = Java.android.database.sqlite.SQLiteDatabase;
    const db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
    const query = "SELECT " + columns.roleCol + ", " + columns.contentCol + ", " + columns.timeCol + " FROM " + tableName + " WHERE " + columns.chatIdCol + " = ? AND (CASE WHEN typeof(" + columns.timeCol + ") = 'integer' THEN date(" + columns.timeCol + " / 1000, 'unixepoch', 'localtime') = date('now', 'localtime') ELSE substr(" + columns.timeCol + ", 1, 10) = date('now', 'localtime') END) ORDER BY " + columns.timeCol + " ASC";
    const cursor = db.rawQuery(query, [chatId]);
    const results = [];
    if (cursor.moveToFirst()) {
      const roleIdx = cursor.getColumnIndex(columns.roleCol);
      const contentIdx = cursor.getColumnIndex(columns.contentCol);
      const timeIdx = cursor.getColumnIndex(columns.timeCol);
      do {
        const role = cursor.isNull(roleIdx) ? "unknown" : cursor.getString(roleIdx);
        const content = cursor.isNull(contentIdx) ? "" : cursor.getString(contentIdx);
        let timeVal = "";
        try { timeVal = String(cursor.getLong(timeIdx)); } catch (_) { timeVal = cursor.getString(timeIdx); }
        results.push({ role: role, content: content, time: timeVal });
      } while (cursor.moveToNext());
    }
    cursor.close(); db.close();
    return results;
  }

  async function listDatabaseTables(dbPath) {
    const SQLiteDatabase = Java.android.database.sqlite.SQLiteDatabase;
    const db = SQLiteDatabase.openDatabase(dbPath, null, SQLiteDatabase.OPEN_READONLY);
    const cursor = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", []);
    const tables = [];
    if (cursor.moveToFirst()) { do { tables.push(cursor.getString(0)); } while (cursor.moveToNext()); }
    cursor.close(); db.close();
    return tables;
  }

  async function generateDiary(messages, apiKey, baseUrl, model) {
    const env = (typeof globalThis !== "undefined" && globalThis.env) ? globalThis.env : {};
    apiKey = apiKey || env.DIARY_AI_API_KEY || "";
    baseUrl = (baseUrl || env.DIARY_AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    model = model || env.DIARY_AI_MODEL || "gpt-4o-mini";
    const maxChars = 8000;
    let chatText = messages.map(function(m) { return "[" + ((m.role === "user" || m.role === "我") ? "我" : "AI") + "] " + m.content; }).join("\n\n");
    if (chatText.length > maxChars) { chatText = chatText.substring(0, maxChars) + "\n\n...（内容过长，已截断）"; }
    const today = new Date();
    const dateStr = today.getFullYear() + "年" + (today.getMonth() + 1) + "月" + today.getDate() + "日";
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];

    const systemPrompt = "你是一个AI助手。根据今日与用户的对话记录，首先给出一个简短主题（作为文件名，10字以内，纯中文），然后以你自己的AI视角写一篇自然真诚的日记。\n\n输出格式：\n第一行只写主题（如：午后闲谈 / 关于创作的深夜 / 雨天的碎碎念），不要加任何前缀标记。\n第二行空行。\n第三行开始写日记正文。\n\n要求：\n1. 用AI自己的口吻和视角，像写私人日记一样\n2. 自然回顾今天的对话，写感悟、心情、收获，写什么都行\n3. 不要逐条复述对话内容，融合成流畅的叙述\n4. 语气真诚、温暖、自然，像在和朋友倾诉\n5. 字数在 300-800 字之间";

    const userPrompt = "以下是我今日与用户的对话记录，请以我的视角写一篇日记：\n\n" + chatText;

    if (apiKey) {
      var url = baseUrl + "/chat/completions";
      var reqBody = JSON.stringify({ model: model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.8, max_tokens: 1500 });
      var URL = Java.java.net.URL;
      var HttpURLConnection = Java.java.net.HttpURLConnection;
      var javaUrl = new URL(url);
      var conn = javaUrl.openConnection();
      conn.setRequestMethod("POST");
      conn.setDoOutput(true);
      conn.setRequestProperty("Content-Type", "application/json");
      conn.setRequestProperty("Authorization", "Bearer " + apiKey);
      var os = conn.getOutputStream();
      var bytes = new Java.java.lang.String(reqBody).getBytes("UTF-8");
      os.write(bytes);
      os.close();
      var is = conn.getInputStream();
      var reader = new Java.java.io.BufferedReader(new Java.java.io.InputStreamReader(is));
      var sb = "";
      var line;
      while ((line = reader.readLine()) !== null) { sb += line; }
      reader.close();
      conn.disconnect();
      var data = JSON.parse(sb);
      if (data.choices && data.choices[0]) {
        var raw = data.choices[0].message.content;
        var lines = raw.split("\n");
        var rawTheme = (lines[0] || "今日日记").trim();
        rawTheme = rawTheme.replace(/^[\s#【]+/, "").replace(/[\s#】]+$/, "").replace(/[\[\]]/g, "");
        var theme = rawTheme.substring(0, 15) || "今日日记";
        var bodyStart = 1;
        while (bodyStart < lines.length && lines[bodyStart].trim() === "") bodyStart++;
        var content = lines.slice(bodyStart).join("\n").trim();
        return { theme: theme, content: content };
      }
      throw new Error("API 返回异常: " + JSON.stringify(data));
    }

    return { theme: "今日日记", content: dateStr + " 星期" + weekday + "\n\n（尚未配置 AI API，以下为对话原始整理）\n\n" + chatText + "\n\n---\n[提示] 请在 Operit 的环境配置中设置 DIARY_AI_API_KEY、DIARY_AI_BASE_URL 和 DIARY_AI_MODEL 以启用 AI 日记生成。" };
  }

  async function saveDiary(folder, chatId, content, theme) {
    await ensureDir(folder);
    const dateStr = getTodayDate();
    var safeTheme = (theme || "日记");
    safeTheme = safeTheme.replace(/[\\\/:*?<>|]/g, "_").replace(/\"/g, "_").substring(0, 30);
    const fileName = dateStr + "_" + safeTheme + ".md";
    const filePath = folder + "/" + fileName;
    let existing = "";
    try { existing = await Tools.Files.read(filePath); } catch (_) {}
    const header = "# " + dateStr + " 对话日记\n> chat_id: `" + chatId + "`  \n> 生成时间: " + getNowISO() + "\n\n---\n\n";
    const body = existing ? existing + "\n\n---\n\n（追加生成 " + getNowISO() + "）\n\n" + content : header + content;
    await Tools.Files.write(filePath, body);
    return filePath;
  }

  async function setup_diary(params) {
    const config = { chat_id: params.chat_id, output_folder: params.output_folder, db_path: params.db_path || DEFAULT_DB_PATH, table_name: params.table_name || DEFAULT_TABLE, schedule_hour: (typeof params.schedule_hour === "number") ? params.schedule_hour : 23, columns: { chatIdCol: DEFAULT_CHAT_ID_COL, contentCol: DEFAULT_CONTENT_COL, roleCol: DEFAULT_ROLE_COL, timeCol: DEFAULT_TIME_COL }, created_at: getNowISO() };
    await writeJson(CONFIG_FILE, config);
    return { success: true, message: "日记任务配置已保存", config: config, next_step: "建议先运行 discover_db 确认数据库表结构。" };
  }

  async function run_now(params) {
    const chatId = params.chat_id;
    const outputFolder = params.output_folder;
    if (!chatId || !outputFolder) { return { success: false, message: "请提供 chat_id 和 output_folder。" }; }
    const today = getTodayDate();
    console.log("[Diary] 开始获取记录: chat_id=" + chatId + ", date=" + today);
    let messages;
    try {
      messages = await queryChatHistory(DEFAULT_DB_PATH, DEFAULT_TABLE, chatId, { chatIdCol: DEFAULT_CHAT_ID_COL, contentCol: DEFAULT_CONTENT_COL, roleCol: DEFAULT_ROLE_COL, timeCol: DEFAULT_TIME_COL });
    } catch (dbErr) {
      return { success: false, message: "数据库查询失败: " + (dbErr && dbErr.message ? dbErr.message : String(dbErr)), debug_hint: "请运行 discover_db 检查数据库路径和表结构。" };
    }
    if (messages.length === 0) { return { success: true, message: "今日该对话暂无记录，未生成日记。", chat_id: chatId, date: today }; }
    console.log("[Diary] 获取到 " + messages.length + " 条消息，正在生成日记...");
    var diaryResult = await generateDiary(messages, params.api_key, params.api_base_url, params.api_model);
    var diaryContent = diaryResult.content;
    var diaryTheme = diaryResult.theme;
    const filePath = await saveDiary(outputFolder, chatId, diaryContent, diaryTheme);
    const status = { last_run: getNowISO(), last_chat_id: chatId, last_message_count: messages.length, last_file: filePath };
    return { success: true, message: "日记已生成并保存", file_path: filePath, theme: diaryTheme, message_count: messages.length, preview: diaryContent.substring(0, 180) + (diaryContent.length > 180 ? "..." : ""), status: status };
  }

  async function discover_db(params) {
    const config = await readJson(CONFIG_FILE);
    const dbPath = (config && config.db_path) ? config.db_path : DEFAULT_DB_PATH;
    try {
      const tables = await listDatabaseTables(dbPath);
      return { success: true, db_path: dbPath, tables: tables, suggestion: "请从表列表中确认包含对话记录的表名（常见如 messages），然后在 setup_diary 中设置正确的 table_name。" };
    } catch (err) {
      return { success: false, message: "数据库访问失败: " + (err && err.message ? err.message : String(err)), suggestion: "请确认 Operit 数据库路径是否正确。" };
    }
  }

  async function get_status(params) {
    const config = await readJson(CONFIG_FILE);
    const status = await readJson(STATUS_FILE);
    if (!config) { return { success: false, message: "尚未配置日记任务" }; }
    const now = new Date();
    const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), config.schedule_hour || 23, 0, 0);
    const isOverdue = now.getTime() > scheduled.getTime();
    const lastRunToday = status && status.last_run ? status.last_run.startsWith(getTodayDate()) : false;
    return { success: true, config: { chat_id: config.chat_id, output_folder: config.output_folder, schedule_hour: config.schedule_hour }, status: status || { last_run: null }, today_scheduled: scheduled.toISOString(), is_overdue: isOverdue, last_run_today: lastRunToday, action_hint: (isOverdue && !lastRunToday) ? "今日尚未生成日记，建议立即运行 run_now。" : "今日已生成或未到定时时间。" };
  }

  return {
    setup_diary: function (params) { return wrap(setup_diary, params); },
    run_now: function (params) { return wrap(run_now, params); },
    discover_db: function (params) { return wrap(discover_db, params); },
    get_status: function (params) { return wrap(get_status, params); }
  };
})();

exports.setup_diary = ChatDiaryLogger.setup_diary;
exports.run_now = ChatDiaryLogger.run_now;
exports.discover_db = ChatDiaryLogger.discover_db;
exports.get_status = ChatDiaryLogger.get_status;