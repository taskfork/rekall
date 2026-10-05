import { API_BASE } from './api.js';
import { state } from './state.js';
import { formatDate, formatTime, getSenderColor, escapeHtml } from './utils.js';
import { fetchConversationMedia, openLightboxForMessageId, closeGalleryView } from './gallery.js';
import { closeStatsView } from './stats.js';
import { selectContact } from './contacts.js';

// DOM Elements
const sidebar = document.getElementById('sidebar');
const mainChat = document.getElementById('main-chat');
const chatTitle = document.getElementById('chat-title');
const chatSub = document.getElementById('chat-sub');
const chatDatePill = document.getElementById('chat-date-pill');
const viewport = document.getElementById('messages-viewport');
const bottomBar = document.getElementById('chat-bottom-bar');
const loadedCountLabel = document.getElementById('loaded-count-label');
const btnJumpLatest = document.getElementById('btn-jump-latest');
const btnBack = document.getElementById('btn-back');
const statsSpanBadge = document.getElementById('stats-span-badge');
const btnGalleryToggle = document.getElementById('btn-gallery-toggle');

export function openChatView() {
  state.isMobileChatOpen = true;
  if (window.innerWidth < 768) {
    if (mainChat) {
      mainChat.classList.remove('translate-x-full', 'pointer-events-none');
      mainChat.classList.add('translate-x-0', 'pointer-events-auto');
    }
  } else {
    if (sidebar) sidebar.classList.remove('hidden');
    if (mainChat) {
      mainChat.classList.remove('translate-x-full', 'pointer-events-none');
      mainChat.classList.add('translate-x-0', 'pointer-events-auto');
    }
  }
}

export function openListView() {
  state.isMobileChatOpen = false;
  if (state.isStatsOpen) closeStatsView();
  if (state.isGalleryOpen) closeGalleryView();
  if (sidebar) sidebar.classList.remove('hidden');
  if (window.innerWidth < 768 && mainChat) {
    mainChat.classList.remove('translate-x-0', 'pointer-events-auto');
    mainChat.classList.add('translate-x-full', 'pointer-events-none');
  }
  if (chatDatePill) chatDatePill.classList.add('hidden');
}

export async function jumpToGlobalMessage(msgId, address, contactName) {
  if (state.isStatsOpen) closeStatsView();
  if (state.isGalleryOpen) closeGalleryView();
  state.isJumpingToContext = true;
  const isGroup = address && address.includes(',');
  state.currentContact = { address, name: contactName, is_group: isGroup };

  document.querySelectorAll('.contact-item, .search-msg-item').forEach(el => el.classList.remove('bg-base-300'));
  const activeEl = document.getElementById(`search-msg-${msgId}`);
  if (activeEl) activeEl.classList.add('bg-base-300');

  if (chatTitle) chatTitle.textContent = contactName;
  if (chatSub) {
    if (isGroup) {
      const memberCount = address.split(',').length;
      chatSub.textContent = `Group (${memberCount} members)`;
      chatSub.title = address;
    } else {
      chatSub.textContent = `${address}`;
      chatSub.title = '';
    }
  }
  if (statsSpanBadge) statsSpanBadge.classList.add('hidden');
  if (bottomBar) bottomBar.classList.remove('hidden');

  openChatView();
  fetchConversationMedia(address);

  if (viewport) {
    viewport.innerHTML = `<div class="hero h-full"><div class="hero-content opacity-50">Jumping to message context...</div></div>`;
  }
  if (chatDatePill) chatDatePill.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/context?id=${msgId}`);
    const data = await res.json();
    state.messages = data.messages || [];
    state.hasMoreOlder = true;
    state.hasMoreNewer = true;

    renderMessages();

    // Double-RAF ensures DOM layout & heights are fully painted before scrolling
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const targetEl = document.getElementById(`msg-${msgId}`);
        if (targetEl && viewport) {
          const vpRect = viewport.getBoundingClientRect();
          const targetRect = targetEl.getBoundingClientRect();
          const offset = (targetRect.top - vpRect.top) - (viewport.clientHeight / 2) + (targetRect.height / 2);
          viewport.scrollTop += offset;

          const bubble = targetEl.querySelector('.chat-bubble');
          if (bubble) {
            bubble.classList.add('chat-bubble-highlight');
            setTimeout(() => {
              bubble.classList.remove('chat-bubble-highlight');
            }, 2600);
          }
        }
        updateVisibleDatePill();
        setTimeout(() => {
          state.isJumpingToContext = false;
        }, 600);
      });
    });
  } catch (err) {
    state.isJumpingToContext = false;
    if (viewport) {
      viewport.innerHTML = `<div class="hero h-full"><div class="hero-content text-error">Error jumping to context: ${err.message}</div></div>`;
    }
  }
}

export function renderMessages() {
  if (!viewport) return;
  if (state.messages.length === 0) {
    viewport.innerHTML = `<div class="hero h-full"><div class="hero-content opacity-50">No messages in this conversation.</div></div>`;
    if (loadedCountLabel) loadedCountLabel.textContent = '0 messages';
    return;
  }

  if (loadedCountLabel) {
    loadedCountLabel.textContent = `${state.messages.length.toLocaleString()} messages loaded`;
  }

  const fragment = document.createDocumentFragment();
  let lastDateStr = '';

  state.messages.forEach(m => {
    const dStr = new Date(m.date * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (dStr !== lastDateStr) {
      const sep = document.createElement('div');
      sep.className = 'divider';
      sep.textContent = dStr;
      fragment.appendChild(sep);
      lastDateStr = dStr;
    }

    const isOut = m.type === 2;
    const row = document.createElement('div');
    row.className = `chat ${isOut ? 'chat-end' : 'chat-start'}`;
    row.id = `msg-${m.id}`;
    row.dataset.date = m.date;

    const isGroup = (state.currentContact && (state.currentContact.is_group || (state.currentContact.address && state.currentContact.address.includes(',')))) || (m.address && m.address.includes(','));

    let senderHeader = '';
    if (!isOut && isGroup) {
      const senderDisplay = m.sender_name || m.sender || m.contact_name;
      if (senderDisplay) {
        const colorClass = getSenderColor(m.sender || senderDisplay);
        senderHeader = `<span class="text-xs font-semibold ${colorClass} mr-1.5 select-text">${escapeHtml(senderDisplay)}</span>`;
      }
    }

    let mediaHtml = '';
    if (m.media_type) {
      if (m.media_type.startsWith('image/')) {
        const mediaCard = document.createElement('div');
        mediaCard.className = 'mb-1 rounded-lg overflow-hidden max-w-xs sm:max-w-sm max-h-72 cursor-pointer bg-base-300/40 select-none';
        mediaCard.onclick = () => openLightboxForMessageId(m.id);
        mediaCard.innerHTML = `<img src="${API_BASE}/media?id=${m.id}&thumb=1&v=2" loading="lazy" class="w-full h-auto max-h-72 object-cover hover:opacity-90 transition-opacity" alt="Image attachment">`;
        mediaHtml = mediaCard.outerHTML;
      } else if (m.media_type.startsWith('video/')) {
        mediaHtml = `
          <div class="mb-1 rounded-lg overflow-hidden max-w-xs sm:max-w-sm max-h-72 bg-base-300/40">
            <video src="${API_BASE}/media?id=${m.id}" controls preload="metadata" class="w-full h-auto max-h-72 rounded-lg"></video>
          </div>
        `;
      }
    }

    const bodyText = m.body ? escapeHtml(m.body) : (mediaHtml ? '' : '<span class="opacity-50 italic">(Attachment or empty message)</span>');

    row.innerHTML = `
      <div class="chat-header flex items-baseline">
        ${senderHeader}
        <time class="text-xs opacity-50">${formatTime(m.date)}</time>
      </div>
      <div class="chat-bubble ${isOut ? 'chat-bubble-primary' : ''} break-words">
        ${mediaHtml}
        ${bodyText ? `<div>${bodyText}</div>` : ''}
      </div>
    `;

    // Re-bind image click event
    if (m.media_type && m.media_type.startsWith('image/')) {
      const imgContainer = row.querySelector('.cursor-pointer');
      if (imgContainer) {
        imgContainer.onclick = () => openLightboxForMessageId(m.id);
      }
    }

    fragment.appendChild(row);
  });

  viewport.innerHTML = '';
  viewport.appendChild(fragment);
  updateVisibleDatePill();
}

export function scrollToBottom() {
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
    requestAnimationFrame(updateVisibleDatePill);
  }
}

let datePillRaf = null;
export function requestDatePillUpdate() {
  if (datePillRaf) return;
  datePillRaf = requestAnimationFrame(() => {
    datePillRaf = null;
    updateVisibleDatePill();
  });
}

export function updateVisibleDatePill() {
  if (!chatDatePill) return;
  if (window.innerWidth < 768 && !state.isMobileChatOpen) {
    chatDatePill.classList.add('hidden');
    return;
  }
  if (!state.currentContact || state.messages.length === 0) {
    chatDatePill.classList.add('hidden');
    return;
  }

  const vpRect = viewport ? viewport.getBoundingClientRect() : { top: 0, bottom: 0 };
  const chats = viewport ? viewport.querySelectorAll('.chat') : [];
  let targetDate = null;

  for (let i = 0; i < chats.length; i++) {
    const el = chats[i];
    const r = el.getBoundingClientRect();
    if (r.bottom >= vpRect.top + 10) {
      if (el.dataset && el.dataset.date) {
        targetDate = Number(el.dataset.date);
      }
      break;
    }
  }

  if (!targetDate && state.messages.length > 0) {
    if (viewport && viewport.scrollTop <= 10) {
      targetDate = state.messages[0].date;
    } else {
      targetDate = state.messages[state.messages.length - 1].date;
    }
  }

  if (targetDate) {
    chatDatePill.textContent = new Date(targetDate * 1000).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    chatDatePill.classList.remove('hidden');
  } else {
    chatDatePill.classList.add('hidden');
  }
}

export function initChat() {
  if (viewport) {
    viewport.addEventListener('scroll', async () => {
      requestDatePillUpdate();

      if (state.isJumpingToContext || !state.currentContact || state.messages.length === 0) return;

      // Top scroll -> Fetch older messages
      if (viewport.scrollTop < 60 && !state.isFetchingOlder && state.hasMoreOlder) {
        state.isFetchingOlder = true;
        const earliestTs = state.messages[0].date;
        const prevScrollHeight = viewport.scrollHeight;

        try {
          const res = await fetch(`${API_BASE}/messages?address=${encodeURIComponent(state.currentContact.address)}&before=${earliestTs}&limit=50`);
          const data = await res.json();
          const older = data.messages || [];

          if (older.length === 0) {
            state.hasMoreOlder = false;
          } else {
            state.messages = [...older, ...state.messages];
            renderMessages();
            viewport.scrollTop = viewport.scrollHeight - prevScrollHeight;
            updateVisibleDatePill();
          }
        } catch (err) {
          console.error(err);
        } finally {
          state.isFetchingOlder = false;
        }
      }

      // Bottom scroll -> Fetch newer messages
      if (viewport.scrollTop + viewport.clientHeight > viewport.scrollHeight - 60 && !state.isFetchingNewer && state.hasMoreNewer) {
        state.isFetchingNewer = true;
        const latestTs = state.messages[state.messages.length - 1].date;

        try {
          const res = await fetch(`${API_BASE}/messages?address=${encodeURIComponent(state.currentContact.address)}&after=${latestTs}&limit=50`);
          const data = await res.json();
          const newer = data.messages || [];

          if (newer.length === 0) {
            state.hasMoreNewer = false;
          } else {
            state.messages = [...state.messages, ...newer];
            renderMessages();
            updateVisibleDatePill();
          }
        } catch (err) {
          console.error(err);
        } finally {
          state.isFetchingNewer = false;
        }
      }
    });
  }

  if (btnJumpLatest) {
    btnJumpLatest.onclick = () => {
      if (!state.currentContact) return;
      selectContact(state.currentContact);
    };
  }

  if (btnBack) {
    btnBack.onclick = () => {
      if (state.isStatsOpen) {
        closeStatsView();
      } else {
        openListView();
      }
    };
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) {
      if (mainChat) {
        mainChat.classList.remove('translate-x-full', 'pointer-events-none');
        mainChat.classList.add('translate-x-0', 'pointer-events-auto');
      }
    } else {
      if (state.isMobileChatOpen || state.currentContact || state.isStatsOpen) {
        if (mainChat) {
          mainChat.classList.remove('translate-x-full', 'pointer-events-none');
          mainChat.classList.add('translate-x-0', 'pointer-events-auto');
        }
      } else {
        if (mainChat) {
          mainChat.classList.remove('translate-x-0', 'pointer-events-auto');
          mainChat.classList.add('translate-x-full', 'pointer-events-none');
        }
      }
    }
    updateVisibleDatePill();
  });
}
