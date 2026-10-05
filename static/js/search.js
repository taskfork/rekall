import { API_BASE } from './api.js';
import { state, SEARCH_MESSAGES_LIMIT } from './state.js';
import { formatDate, getInitials, escapeHtml, formatSnippet } from './utils.js';
import { loadContacts, selectContact } from './contacts.js';
import { jumpToGlobalMessage } from './chat.js';

// DOM Elements
const searchInput = document.getElementById('global-search');
const btnClearSearch = document.getElementById('btn-clear-search');
const searchKbdHint = document.getElementById('search-kbd-hint');
const contactTabsContainer = document.getElementById('contact-tabs-container');
const contactsListEl = document.getElementById('contacts-list');

export function updateSearchControls() {
  const hasValue = !!(searchInput && searchInput.value.length > 0);
  if (btnClearSearch) {
    if (hasValue) btnClearSearch.classList.remove('hidden');
    else btnClearSearch.classList.add('hidden');
  }
  if (searchKbdHint) {
    if (hasValue) searchKbdHint.classList.add('!hidden');
    else searchKbdHint.classList.remove('!hidden');
  }
}

export async function executeGlobalSearch(q) {
  updateSearchControls();
  if (!q) {
    state.isSearchMode = false;
    if (contactTabsContainer) contactTabsContainer.classList.remove('hidden');
    loadContacts();
    return;
  }

  state.isSearchMode = true;
  state.currentSearchQuery = q;
  state.searchMessagesOffset = 0;
  if (contactTabsContainer) contactTabsContainer.classList.add('hidden');
  if (contactsListEl) {
    contactsListEl.innerHTML = '<div class="p-4 text-center opacity-50 text-sm">Searching...</div>';
  }

  try {
    // 1. Prefix match contacts in-memory (no arbitrary limit)
    const qLower = q.toLowerCase();
    const matchingContacts = state.allContactsCache.filter(c => {
      const nameLower = (c.name || '').toLowerCase();
      const words = nameLower.split(/\s+/);
      return words.some(w => w.startsWith(qLower)) || (c.address || '').includes(q);
    });

    // 2. Prefix search messages via SQLite FTS5
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${SEARCH_MESSAGES_LIMIT}&offset=0`);
    const data = await res.json();
    const matchingMessages = data.results || [];
    state.searchMessagesOffset = matchingMessages.length;
    state.searchMessagesHasMore = !!data.has_more;

    // 3. Mix contacts and messages together chronologically (most recent first)
    const unified = [];

    matchingContacts.forEach(c => {
      unified.push({
        type: 'contact',
        id: c.address,
        address: c.address,
        name: c.name,
        count: c.count,
        date: c.last_date || 0
      });
    });

    matchingMessages.forEach(m => {
      unified.push({
        type: 'message',
        id: m.id,
        address: m.address,
        name: m.contact_name,
        date: m.date || 0,
        msgType: m.type, // 1 = received, 2 = sent
        snippet: m.snippet || m.body
      });
    });

    // Interleave together by date
    unified.sort((a, b) => (b.date || 0) - (a.date || 0));

    renderSearchResults(unified, q);
  } catch (err) {
    if (contactsListEl) {
      contactsListEl.innerHTML = `<div class="p-4 text-error text-center text-sm">Search error: ${err.message}</div>`;
    }
  }
}

export function renderSearchResults(items, q) {
  if (!contactsListEl) return;
  if (items.length === 0) {
    contactsListEl.innerHTML = `<div class="p-6 text-center opacity-50 text-sm">No contacts or messages matching "${escapeHtml(q)}"</div>`;
    return;
  }

  contactsListEl.innerHTML = '';
  const feedContainer = document.createElement('div');
  feedContainer.id = 'search-feed-container';
  feedContainer.className = 'divide-y divide-base-300';

  items.forEach(item => {
    const el = document.createElement('div');
    if (item.type === 'contact') {
      const isGroup = item.is_group || (item.address && item.address.includes(','));
      const memberCount = isGroup ? item.address.split(',').length : 0;
      const avatarHtml = isGroup
        ? `<svg class="w-4 h-4 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`
        : `<span>${getInitials(item.name)}</span>`;
      el.className = 'contact-item flex items-center gap-3 p-3 cursor-pointer hover:bg-base-300 transition-colors select-none';
      el.innerHTML = `
        <div class="avatar placeholder flex-shrink-0">
          <div class="bg-primary/20 text-primary border border-primary/30 rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">
            ${avatarHtml}
          </div>
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <div class="flex justify-between items-baseline gap-2">
            <span class="font-semibold text-sm truncate text-base-content">${escapeHtml(item.name)}</span>
            <span class="badge badge-xs ${isGroup ? 'badge-neutral' : 'badge-primary'} font-medium">${isGroup ? 'Group' : 'Contact'}</span>
          </div>
          <div class="flex justify-between items-center gap-2 opacity-70 mt-0.5">
            <span class="text-xs truncate">${isGroup ? `${memberCount} members` : escapeHtml(item.address)}</span>
            <span class="text-[11px] opacity-50">${Number(item.count).toLocaleString()} texts</span>
          </div>
        </div>
      `;
      el.onclick = () => selectContact(item);
    } else {
      const isSent = item.msgType === 2;
      el.id = `search-msg-${item.id}`;
      el.className = 'search-msg-item flex items-start gap-3 p-3 cursor-pointer hover:bg-base-300 transition-colors select-none overflow-hidden';
      el.innerHTML = `
        <div class="avatar placeholder flex-shrink-0 mt-0.5">
          <div class="bg-neutral text-neutral-content rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">
            <span>${getInitials(item.name)}</span>
          </div>
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <div class="flex justify-between items-baseline gap-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="font-semibold text-sm truncate text-base-content">${escapeHtml(item.name)}</span>
              <span class="badge badge-xs ${isSent ? 'badge-primary' : 'badge-neutral'} font-medium flex-shrink-0">${isSent ? 'Sent' : 'Received'}</span>
            </div>
            <span class="text-[11px] opacity-50 flex-shrink-0">${formatDate(item.date)}</span>
          </div>
          <div class="text-xs opacity-80 line-clamp-2 leading-relaxed mt-1">${formatSnippet(item.snippet || '')}</div>
        </div>
      `;
      el.onclick = () => jumpToGlobalMessage(item.id, item.address, item.name);
    }
    feedContainer.appendChild(el);
  });

  contactsListEl.appendChild(feedContainer);
}

export async function loadMoreSearchMessages() {
  if (state.isFetchingMoreSearch || !state.searchMessagesHasMore) return;
  state.isFetchingMoreSearch = true;

  const container = document.getElementById('search-feed-container') || contactsListEl;
  const loader = document.createElement('div');
  loader.id = 'search-loading-more';
  loader.className = 'p-3 text-center opacity-50 text-xs flex justify-center items-center gap-2';
  loader.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Loading more messages...';
  if (container) container.appendChild(loader);

  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(state.currentSearchQuery)}&limit=${SEARCH_MESSAGES_LIMIT}&offset=${state.searchMessagesOffset}`);
    const data = await res.json();
    const newMsgs = data.results || [];
    state.searchMessagesOffset += newMsgs.length;
    state.searchMessagesHasMore = !!data.has_more;

    if (loader.parentNode) loader.parentNode.removeChild(loader);
    appendSearchMessages(newMsgs);
  } catch (err) {
    if (loader.parentNode) loader.parentNode.removeChild(loader);
    console.error('Error loading more search messages:', err);
  } finally {
    state.isFetchingMoreSearch = false;
  }
}

export function appendSearchMessages(msgs) {
  const container = document.getElementById('search-feed-container') || contactsListEl;
  if (!container) return;

  msgs.forEach(m => {
    const isSent = m.type === 2;
    const item = document.createElement('div');
    item.id = `search-msg-${m.id}`;
    item.className = 'search-msg-item flex items-start gap-3 p-3 cursor-pointer hover:bg-base-300 transition-colors select-none overflow-hidden';
    item.innerHTML = `
      <div class="avatar placeholder flex-shrink-0 mt-0.5">
        <div class="bg-neutral text-neutral-content rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">
          <span>${getInitials(m.contact_name)}</span>
        </div>
      </div>
      <div class="flex-1 min-w-0 overflow-hidden">
        <div class="flex justify-between items-baseline gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="font-semibold text-sm truncate text-base-content">${escapeHtml(m.contact_name)}</span>
            <span class="badge badge-xs ${isSent ? 'badge-primary' : 'badge-neutral'} font-medium flex-shrink-0">${isSent ? 'Sent' : 'Received'}</span>
          </div>
          <span class="text-[11px] opacity-50 flex-shrink-0">${formatDate(m.date)}</span>
        </div>
        <div class="text-xs opacity-80 line-clamp-2 leading-relaxed mt-1">${formatSnippet(m.snippet || m.body || '')}</div>
      </div>
    `;
    item.onclick = () => jumpToGlobalMessage(m.id, m.address, m.contact_name);
    container.appendChild(item);
  });
}

export function initSearch() {
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      updateSearchControls();
      clearTimeout(state.searchDebounceTimer);
      const q = e.target.value.trim();
      state.searchDebounceTimer = setTimeout(() => {
        executeGlobalSearch(q);
      }, 200);
    });
  }

  if (btnClearSearch) {
    btnClearSearch.onclick = () => {
      if (searchInput) {
        searchInput.value = '';
        updateSearchControls();
        executeGlobalSearch('');
        searchInput.focus();
      }
    };
  }
}
