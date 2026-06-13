import "dotenv/config";

import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";

const app = express();

const port = readPositiveInteger("PORT", 3000);
const baseUrl = (process.env.INFISTAR_BASE_URL || "https://infistar.ai/v1").replace(
  /\/+$/,
  "",
);
const apiKey = process.env.INFISTAR_API_KEY?.trim();
const model = process.env.INFISTAR_MODEL?.trim();
const upstreamTimeoutMs = readPositiveInteger("UPSTREAM_TIMEOUT_MS", 45_000);
const allowedOrigins = new Set(
  (process.env.ALLOWED_EXTENSION_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (!apiKey || !model) {
  console.error(
    "Missing required environment variables: INFISTAR_API_KEY and INFISTAR_MODEL.",
  );
  process.exit(1);
}

app.disable("x-powered-by");
app.set("trust proxy", readNonNegativeInteger("TRUST_PROXY", 0));
app.use(express.json({ limit: "20kb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed."));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86_400,
  }),
);

const askLimiter = rateLimit({
  windowMs: readPositiveInteger("RATE_LIMIT_WINDOW_MS", 60_000),
  limit: readPositiveInteger("RATE_LIMIT_MAX", 20),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "请求太频繁，请稍后再试。",
  },
});

app.post("/api/ask", askLimiter, async (request, response) => {
  const selectedText = normalizeText(request.body?.selectedText);
  const question = normalizeText(request.body?.question);
  const pageTitle = normalizeText(request.body?.pageTitle);
  const pageUrl = normalizeText(request.body?.pageUrl);

  if (!selectedText || !question) {
    response.status(400).json({ error: "选中文字和追问都不能为空。" });
    return;
  }

  if (selectedText.length > 8_000) {
    response.status(400).json({ error: "选中的文字太长，请缩短后再试。" });
    return;
  }

  if (question.length > 1_000) {
    response.status(400).json({ error: "问题太长，请缩短后再试。" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  try {
    const upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是一个帮助用户理解网页中 AI 回复的中文助手。请直接回答追问，解释清楚、简洁，并结合选中的原文。不要声称看到了未提供的网页内容。",
          },
          {
            role: "user",
            content: [
              `选中的原文：\n${selectedText}`,
              `用户追问：\n${question}`,
              pageTitle ? `页面标题：${pageTitle.slice(0, 300)}` : "",
              pageUrl ? `页面地址：${pageUrl.slice(0, 1_000)}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      console.error(
        `AI upstream request failed with status ${upstreamResponse.status}:`,
        errorText.slice(0, 500),
      );
      response.status(502).json({ error: "AI 服务暂时不可用，请稍后再试。" });
      return;
    }

    const data = await upstreamResponse.json();
    const answer = data?.choices?.[0]?.message?.content;

    if (typeof answer !== "string" || !answer.trim()) {
      console.error("AI upstream response did not contain a text answer.");
      response.status(502).json({ error: "AI 没有返回可显示的回答。" });
      return;
    }

    response.json({ answer: answer.trim() });
  } catch (error) {
    if (error.name === "AbortError") {
      response.status(504).json({ error: "AI 回答超时，请稍后再试。" });
      return;
    }

    console.error("Unexpected proxy error:", error);
    response.status(500).json({ error: "后端请求失败，请稍后再试。" });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: "请求格式不正确。" });
    return;
  }

  if (error.message === "Origin is not allowed.") {
    response.status(403).json({ error: "当前请求来源未被允许。" });
    return;
  }

  console.error("Unhandled server error:", error);
  response.status(500).json({ error: "服务器发生错误。" });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.size === 0) {
    return process.env.NODE_ENV !== "production";
  }

  return allowedOrigins.has(origin);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readNonNegativeInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
