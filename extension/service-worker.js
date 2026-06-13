importScripts("config.js");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ASK_AI") {
    return false;
  }

  askBackend(message.payload)
    .then((answer) => sendResponse({ ok: true, answer }))
    .catch((error) => {
      console.error("AI request failed:", error);
      sendResponse({
        ok: false,
        error: error.message || "请求失败，请稍后再试。",
      });
    });

  return true;
});

async function askBackend(payload) {
  const response = await fetch(globalThis.APP_CONFIG.backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("后端返回了无法识别的内容。");
  }

  if (!response.ok) {
    throw new Error(data?.error || `后端请求失败（${response.status}）。`);
  }

  if (typeof data?.answer !== "string" || !data.answer.trim()) {
    throw new Error("后端没有返回回答。");
  }

  return data.answer.trim();
}

