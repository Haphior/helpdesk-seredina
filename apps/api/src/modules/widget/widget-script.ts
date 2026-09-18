/**
 * The actual embeddable script a tenant puts on their own website:
 *   <script src="https://<this-seredina-instance>/widget.js" data-tenant="acme"></script>
 *
 * Served as a real .js response (see routes.ts) rather than a built frontend
 * asset -- it has to run standalone on an arbitrary third-party page with no
 * bundler, no React, no access to this repo's other frontend tooling. Style
 * isolation is via Shadow DOM rather than an iframe: simpler (no second
 * HTML-serving route, no cross-frame postMessage plumbing) and sufficient,
 * since the widget only needs to keep the HOST page's CSS out, not sandbox
 * untrusted host content the way an iframe would for the reverse direction.
 *
 * `document.currentScript.dataset.tenant` gives the tenant slug; the API's
 * own origin is derived from the script's own src (same Fastify app serves
 * both), so the embed snippet needs no separate API URL configuration.
 */
export function renderWidgetScript(): string {
  return WIDGET_SCRIPT_SOURCE;
}

const WIDGET_SCRIPT_SOURCE = String.raw`(function () {
  var currentScript = document.currentScript;
  if (!currentScript) return;

  var tenantSlug = currentScript.getAttribute('data-tenant');
  if (!tenantSlug) {
    console.error('[Seredina widget] missing required data-tenant attribute on the widget <script> tag');
    return;
  }

  var apiOrigin = new URL(currentScript.src).origin;
  var storageKey = 'seredina-widget-' + tenantSlug;

  function apiUrl(path) {
    return apiOrigin + '/public/' + encodeURIComponent(tenantSlug) + path;
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (e) {
      // Private browsing / blocked storage -- the widget still works for this
      // page view, it just won't resume the conversation on a later visit.
    }
  }

  var root = document.createElement('div');
  root.id = 'seredina-widget-root';
  document.body.appendChild(root);
  var shadow = root.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent =
    ':host { all: initial; }' +
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }' +
    '.bubble { position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px; border-radius: 50%; ' +
    'background: #2952e3; color: #fff; border: none; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.25); ' +
    'font-size: 24px; z-index: 2147483000; display: flex; align-items: center; justify-content: center; }' +
    '.panel { position: fixed; bottom: 88px; right: 20px; width: 320px; max-height: 460px; background: #fff; ' +
    'border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.2); display: flex; flex-direction: column; ' +
    'overflow: hidden; z-index: 2147483000; }' +
    '.panel.hidden { display: none; }' +
    '.header { background: #2952e3; color: #fff; padding: 12px 16px; font-size: 15px; font-weight: 600; ' +
    'display: flex; justify-content: space-between; align-items: center; }' +
    '.close { cursor: pointer; background: none; border: none; color: #fff; font-size: 18px; line-height: 1; }' +
    '.body { padding: 12px; overflow-y: auto; flex: 1; min-height: 120px; }' +
    '.form input, .form textarea { width: 100%; margin-bottom: 8px; padding: 8px; border: 1px solid #ccc; ' +
    'border-radius: 6px; font-size: 13px; }' +
    '.form textarea { resize: vertical; min-height: 60px; }' +
    '.form button, .send-row button { background: #2952e3; color: #fff; border: none; border-radius: 6px; ' +
    'padding: 8px 14px; font-size: 13px; cursor: pointer; }' +
    '.error { color: #c0392b; font-size: 12px; margin-bottom: 8px; }' +
    '.messages { display: flex; flex-direction: column; gap: 8px; }' +
    '.msg { max-width: 85%; padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }' +
    '.msg.contact { align-self: flex-end; background: #2952e3; color: #fff; }' +
    '.msg.other { align-self: flex-start; background: #f0f1f4; color: #222; }' +
    '.send-row { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #eee; }' +
    '.send-row textarea { flex: 1; resize: none; height: 36px; padding: 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; }';
  shadow.appendChild(style);

  var bubble = document.createElement('button');
  bubble.className = 'bubble';
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.textContent = String.fromCodePoint(0x1f4ac);
  shadow.appendChild(bubble);

  var panel = document.createElement('div');
  panel.className = 'panel hidden';
  shadow.appendChild(panel);

  var header = document.createElement('div');
  header.className = 'header';
  var headerTitle = document.createElement('span');
  headerTitle.textContent = 'Chat with us';
  var closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close chat');
  closeBtn.textContent = String.fromCodePoint(0x2715);
  header.appendChild(headerTitle);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  var body = document.createElement('div');
  body.className = 'body';
  panel.appendChild(body);

  bubble.addEventListener('click', function () {
    panel.classList.toggle('hidden');
  });
  closeBtn.addEventListener('click', function () {
    panel.classList.add('hidden');
  });

  var pollTimer = null;

  function renderPreChatForm() {
    body.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'form';

    var errorEl = document.createElement('div');
    errorEl.className = 'error';
    errorEl.style.display = 'none';

    var nameInput = document.createElement('input');
    nameInput.placeholder = 'Your name';
    var emailInput = document.createElement('input');
    emailInput.placeholder = 'Your email';
    emailInput.type = 'email';
    var messageInput = document.createElement('textarea');
    messageInput.placeholder = 'How can we help?';
    var submitBtn = document.createElement('button');
    submitBtn.textContent = 'Start chat';

    submitBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      var email = emailInput.value.trim();
      var message = messageInput.value.trim();
      if (!name || !email || !message) {
        errorEl.textContent = 'Please fill in your name, email, and message.';
        errorEl.style.display = 'block';
        return;
      }
      submitBtn.disabled = true;
      fetch(apiUrl('/widget/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, email: email, message: message }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('request failed');
          return res.json();
        })
        .then(function (data) {
          saveState({ widgetToken: data.widgetToken, ticketNumber: data.ticketNumber });
          renderConversation();
        })
        .catch(function () {
          submitBtn.disabled = false;
          errorEl.textContent = 'Something went wrong. Please try again.';
          errorEl.style.display = 'block';
        });
    });

    wrap.appendChild(errorEl);
    wrap.appendChild(nameInput);
    wrap.appendChild(emailInput);
    wrap.appendChild(messageInput);
    wrap.appendChild(submitBtn);
    body.appendChild(wrap);
  }

  function renderMessages(messages) {
    var list = document.createElement('div');
    list.className = 'messages';
    messages.forEach(function (m) {
      var bubbleEl = document.createElement('div');
      bubbleEl.className = 'msg ' + (m.authorType === 'CONTACT' ? 'contact' : 'other');
      bubbleEl.textContent = m.body;
      list.appendChild(bubbleEl);
    });
    return list;
  }

  function renderConversation() {
    var state = loadState();
    if (!state) {
      renderPreChatForm();
      return;
    }

    body.innerHTML = '';
    var messagesContainer = document.createElement('div');
    body.appendChild(messagesContainer);

    var sendRow = document.createElement('div');
    sendRow.className = 'send-row';
    var input = document.createElement('textarea');
    input.placeholder = 'Type a message...';
    var sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendRow.appendChild(input);
    sendRow.appendChild(sendBtn);
    panel.appendChild(sendRow);

    function refresh() {
      fetch(apiUrl('/widget/conversation?widgetToken=' + encodeURIComponent(state.widgetToken)))
        .then(function (res) {
          if (!res.ok) throw new Error('not found');
          return res.json();
        })
        .then(function (data) {
          messagesContainer.innerHTML = '';
          messagesContainer.appendChild(renderMessages(data.messages));
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        })
        .catch(function () {
          // A stale/invalid token from a previous session -- drop it and
          // fall back to the pre-chat form rather than polling forever.
          if (pollTimer) clearInterval(pollTimer);
          saveState(null);
          panel.removeChild(sendRow);
          renderPreChatForm();
        });
    }

    sendBtn.addEventListener('click', function () {
      var value = input.value.trim();
      if (!value) return;
      input.value = '';
      fetch(apiUrl('/widget/messages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgetToken: state.widgetToken, body: value }),
      }).then(refresh);
    });

    refresh();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(refresh, 5000);
  }

  renderConversation();
})();
`;
