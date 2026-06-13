(() => {
  const ROOT_ID = "ai-selection-follow-up-root";
  const MAX_SELECTED_TEXT_LENGTH = 8_000;
  const MAX_QUESTION_LENGTH = 1_000;

  let selectedText = "";
  let selectionRect = null;
  let isSubmitting = false;

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.zIndex = "2147483647";
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      .panel {
        position: fixed;
        display: none;
        width: min(360px, calc(100vw - 24px));
        max-height: min(520px, calc(100vh - 24px));
        overflow: auto;
        padding: 14px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 14px;
        background: #ffffff;
        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2);
        color: #172033;
        font-family:
          -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }

      .panel.visible {
        display: block;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .title {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
      }

      .close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #667085;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
      }

      .close:hover {
        background: #f2f4f7;
      }

      .quote {
        display: -webkit-box;
        margin-bottom: 10px;
        overflow: hidden;
        color: #667085;
        font-size: 12px;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      textarea {
        display: block;
        width: 100%;
        min-height: 78px;
        resize: vertical;
        padding: 10px 11px;
        border: 1px solid #d0d5dd;
        border-radius: 10px;
        outline: none;
        background: #ffffff;
        color: #172033;
        font: inherit;
      }

      textarea:focus {
        border-color: #7f56d9;
        box-shadow: 0 0 0 3px rgba(127, 86, 217, 0.12);
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 10px;
      }

      .hint {
        color: #98a2b3;
        font-size: 11px;
      }

      .submit {
        min-width: 74px;
        padding: 8px 14px;
        border: 0;
        border-radius: 9px;
        background: #6941c6;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-weight: 600;
      }

      .submit:hover {
        background: #5934ad;
      }

      .submit:disabled {
        background: #bdb4d7;
        cursor: wait;
      }

      .answer {
        display: none;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid #eaecf0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      .answer.visible {
        display: block;
      }

      .answer.error {
        color: #b42318;
      }
    </style>

    <section class="panel" role="dialog" aria-label="AI 划词追问">
      <div class="topbar">
        <h2 class="title">追问选中内容</h2>
        <button class="close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="quote"></div>
      <textarea
        maxlength="${MAX_QUESTION_LENGTH}"
        placeholder="哪里不明白？在这里继续问…"
        aria-label="输入追问"
      ></textarea>
      <div class="actions">
        <span class="hint">Enter 发送，Shift+Enter 换行</span>
        <button class="submit" type="button">追问</button>
      </div>
      <div class="answer" aria-live="polite"></div>
    </section>
  `;

  const panel = shadow.querySelector(".panel");
  const quote = shadow.querySelector(".quote");
  const textarea = shadow.querySelector("textarea");
  const submitButton = shadow.querySelector(".submit");
  const closeButton = shadow.querySelector(".close");
  const answer = shadow.querySelector(".answer");

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("keydown", handleDocumentKeyDown);
  window.addEventListener("resize", repositionPanel);

  closeButton.addEventListener("click", closePanel);
  submitButton.addEventListener("click", submitQuestion);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitQuestion();
    }
  });

  function handleMouseUp(event) {
    if (host.contains(event.target)) {
      return;
    }

    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";

      if (!text || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);
      if (!range || isEditable(range.commonAncestorContainer)) {
        return;
      }

      selectedText = text.slice(0, MAX_SELECTED_TEXT_LENGTH);
      selectionRect = range.getBoundingClientRect();
      quote.textContent =
        text.length > MAX_SELECTED_TEXT_LENGTH
          ? `“${selectedText}…”`
          : `“${selectedText}”`;
      textarea.value = "";
      setAnswer("");
      openPanel();
    }, 0);
  }

  function openPanel() {
    panel.classList.add("visible");
    repositionPanel();
    textarea.focus({ preventScroll: true });
  }

  function closePanel() {
    if (isSubmitting) {
      return;
    }

    panel.classList.remove("visible");
    setAnswer("");
    selectedText = "";
    selectionRect = null;
  }

  function repositionPanel() {
    if (!panel.classList.contains("visible") || !selectionRect) {
      return;
    }

    const gap = 10;
    const viewportPadding = 12;
    const panelWidth = panel.offsetWidth || 360;
    const panelHeight = panel.offsetHeight || 220;

    let left = selectionRect.right + gap;
    if (left + panelWidth > window.innerWidth - viewportPadding) {
      left = selectionRect.left - panelWidth - gap;
    }
    left = clamp(
      left,
      viewportPadding,
      Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding),
    );

    let top = selectionRect.top;
    if (top + panelHeight > window.innerHeight - viewportPadding) {
      top = window.innerHeight - panelHeight - viewportPadding;
    }
    top = Math.max(viewportPadding, top);

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  async function submitQuestion() {
    const question = textarea.value.trim();
    if (!selectedText || !question || isSubmitting) {
      if (!question) {
        setAnswer("请先输入你的追问。", true);
      }
      return;
    }

    isSubmitting = true;
    textarea.disabled = true;
    submitButton.disabled = true;
    submitButton.textContent = "思考中";
    setAnswer("正在请求 AI…");
    repositionPanel();

    try {
      const result = await chrome.runtime.sendMessage({
        type: "ASK_AI",
        payload: {
          selectedText,
          question,
          pageTitle: document.title,
          pageUrl: window.location.href,
        },
      });

      if (!result?.ok) {
        throw new Error(result?.error || "请求失败，请稍后再试。");
      }

      setAnswer(result.answer);
    } catch (error) {
      setAnswer(error.message || "扩展无法连接后端，请确认后端已经启动。", true);
    } finally {
      isSubmitting = false;
      textarea.disabled = false;
      submitButton.disabled = false;
      submitButton.textContent = "追问";
      repositionPanel();
      textarea.focus({ preventScroll: true });
    }
  }

  function setAnswer(text, isError = false) {
    answer.textContent = text;
    answer.classList.toggle("visible", Boolean(text));
    answer.classList.toggle("error", isError);
  }

  function handleDocumentKeyDown(event) {
    if (event.key === "Escape" && panel.classList.contains("visible")) {
      closePanel();
    }
  }

  function isEditable(node) {
    const element =
      node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(
      element?.closest(
        "input, textarea, select, [contenteditable='true'], [contenteditable='']",
      ),
    );
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
})();
