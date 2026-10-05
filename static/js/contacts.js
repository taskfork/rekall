import { API_BASE } from './api.js';
import { state, CONTACTS_LIMIT } from './state.js';
import { formatDate, getInitials, escapeHtml } from './utils.js';
import { openChatView, renderMessages, scrollToBottom } from './chat.js';
import { fetchConversationMedia, closeGalleryView } from './gallery.js';
import { closeStatsView } from './stats.js';
import { loadMoreSearchMessages } from './search.js';

// DOM Elements
const contactsListEl = document.getElementById('contacts-list');
const contactTabsContainer = document.getElementById('contact-tabs-container');
const tabKnown = document.getElementById('tab-known');
const tabUnknown = document.getElementById('tab-unknown');
const badgeKnownCount = document.getElementById('badge-known-count');
const badgeUnknownCount = document.getElementById('badge-unknown-count');
const chatTitle = document.getElementById('chat-title');
const chatSub = document.getElementById('chat-sub');
const statsSpanBadge = document.getElementById('stats-span-badge');
const bottomBar = document.getElementById('chat-bottom-bar');
const viewport = document.getElementById('messages-viewport');
const chatDatePill = document.getElementById('chat-date-pill');

export function setContactTab(tab) {
  if (state.currentContactTab === tab) return;
  state.currentContactTab = tab;
  if (tabKnown) tabKnown.classList.toggle('tab-active', tab === 'known');
  if (tabUnknown) tabUnknown.classList.toggle('tab-active', tab === 'unknown');
  loadContacts(false);
}

export function renderContactsSkeleton() {
  return `
    <div class="p-3 space-y-3">
      ${[1, 2, 3, 4, 5, 6, 7].map(() => `
        <div class="flex items-center gap-3">
          <div class="skeleton w-10 h-10 rounded-full shrink-0"></div>
          <div class="flex flex-col gap-1.5 flex-1 min-w-0">
            <div class="skeleton h-3.5 w-2/5"></div>
            <div class="skeleton h-2.5 w-3/5"></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export async function loadContacts(append = false) {
  if (state.isFetchingContacts || state.isSearchMode || !contactsListEl) return;
  state.isFetchingContacts = true;

  if (!append) {
    state.contactsOffset = 0;
    contactsListEl.innerHTML = renderContactsSkeleton();
  }

  try {
    const res = await fetch(`${API_BASE}/contacts?tab=${state.currentContactTab}&limit=${CONTACTS_LIMIT}&offset=${state.contactsOffset}`);
    const data = await res.json();
    
    const list = Array.isArray(data) ? data : (data.contacts || []);
    state.contactsHasMore = Array.isArray(data) ? false : !!data.has_more;
    state.contactsOffset += list.length;

    if (data.known_count !== undefined && badgeKnownCount) {
      badgeKnownCount.textContent = Number(data.known_count).toLocaleString();
    }
    if (data.unknown_count !== undefined && badgeUnknownCount) {
      badgeUnknownCount.textContent = Number(data.unknown_count).toLocaleString();
    }

    if (!append) state.allContactsCache = list;
    else state.allContactsCache = state.allContactsCache.concat(list);

    renderContacts(list, append);

    // Fetch full contact list in background for instant prefix search
    if (!append) {
      fetch(`${API_BASE}/contacts?limit=0`).then(r => r.json()).then(full => {
        const all = Array.isArray(full) ? full : (full.contacts || []);
        if (all.length > 0) {
          state.allContactsCache = all;
          if (full.known_count !== undefined && badgeKnownCount) {
            badgeKnownCount.textContent = Number(full.known_count).toLocaleString();
          }
          if (full.unknown_count !== undefined && badgeUnknownCount) {
            badgeUnknownCount.textContent = Number(full.unknown_count).toLocaleString();
          }
        }
      }).catch(() => {});
    }
  } catch (err) {
    if (!append && contactsListEl) {
      contactsListEl.innerHTML = `<div class="p-4 text-error text-center text-sm">Error loading contacts: ${err.message}</div>`;
    }
  } finally {
    state.isFetchingContacts = false;
  }
}

export function renderContacts(contacts, append = false) {
  if (!contactsListEl) return;
  if (!append) {
    contactsListEl.innerHTML = '';
  }
  if (!append && contacts.length === 0) {
    contactsListEl.innerHTML = '<div class="p-4 opacity-50 text-center text-sm">No contacts found</div>';
    return;
  }

  contacts.forEach(c => {
    const isActive = state.currentContact && state.currentContact.address === c.address;
    const item = document.createElement('div');
    item.className = `contact-item flex items-center gap-3 p-3 cursor-pointer hover:bg-base-300 transition-colors select-none ${isActive ? 'bg-base-300' : ''}`;
    
    const isGroup = c.is_group || (c.address && c.address.includes(','));
    const memberCount = isGroup ? c.address.split(',').length : 0;
    const avatarContent = isGroup
      ? `<svg class="w-4 h-4 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`
      : `<span>${getInitials(c.name)}</span>`;

    item.innerHTML = `
      <div class="avatar placeholder flex-shrink-0">
        <div class="bg-neutral text-neutral-content rounded-full w-9 h-9 flex items-center justify-center font-bold text-xs">
          ${avatarContent}
        </div>
      </div>
      <div class="flex-1 min-w-0 overflow-hidden">
        <div class="flex justify-between items-baseline gap-2">
          <span class="font-semibold text-sm truncate text-base-content flex items-center gap-1.5">
            ${escapeHtml(c.name)}
            ${isGroup ? '<span class="badge badge-xs badge-neutral opacity-70">Group</span>' : ''}
          </span>
          <span class="text-xs opacity-50 flex-shrink-0">${formatDate(c.last_date)}</span>
        </div>
        <div class="flex justify-between items-center gap-2 opacity-70 mt-0.5">
          <span class="text-xs truncate">${isGroup ? `${memberCount} members` : escapeHtml(c.address)}</span>
          <span class="badge badge-sm badge-ghost flex-shrink-0">${Number(c.count).toLocaleString()}</span>
        </div>
      </div>
    `;
    item.onclick = () => selectContact(c);
    contactsListEl.appendChild(item);
  });
}

export async function selectContact(contact) {
  if (state.isStatsOpen) closeStatsView();
  if (state.isGalleryOpen) closeGalleryView();
  state.currentContact = contact;
  document.querySelectorAll('.contact-item, .search-msg-item').forEach(el => el.classList.remove('bg-base-300'));

  if (chatTitle) chatTitle.textContent = contact.name;
  const isGroup = contact.is_group || (contact.address && contact.address.includes(','));
  if (chatSub) {
    if (isGroup) {
      const memberCount = contact.address.split(',').length;
      chatSub.textContent = `Group (${memberCount} members) · ${Number(contact.count || 0).toLocaleString()} texts`;
      chatSub.title = contact.address;
    } else {
      chatSub.textContent = `${contact.address} · ${Number(contact.count || 0).toLocaleString()} texts`;
      chatSub.title = '';
    }
  }
  if (statsSpanBadge) statsSpanBadge.classList.add('hidden');
  if (bottomBar) bottomBar.classList.remove('hidden');

  openChatView();
  fetchConversationMedia(contact.address);

  if (viewport) {
    viewport.innerHTML = `
      <div class="p-4 space-y-4 max-w-2xl mx-auto w-full">
        <div class="chat chat-start">
          <div class="chat-bubble skeleton w-48 h-12"></div>
        </div>
        <div class="chat chat-end">
          <div class="chat-bubble skeleton w-64 h-16"></div>
        </div>
        <div class="chat chat-start">
          <div class="chat-bubble skeleton w-36 h-10"></div>
        </div>
        <div class="chat chat-end">
          <div class="chat-bubble skeleton w-52 h-14"></div>
        </div>
      </div>
    `;
  }
  if (chatDatePill) chatDatePill.classList.add('hidden');
  state.messages = [];
  state.hasMoreOlder = true;
  state.hasMoreNewer = false;

  try {
    const res = await fetch(`${API_BASE}/messages?address=${encodeURIComponent(contact.address)}&limit=50`);
    const data = await res.json();
    state.messages = data.messages || [];
    renderMessages();
    scrollToBottom();
  } catch (err) {
    if (viewport) {
      viewport.innerHTML = `<div class="hero h-full"><div class="hero-content text-error">Error: ${err.message}</div></div>`;
    }
  }
}

export function initContacts() {
  if (tabKnown) tabKnown.onclick = () => setContactTab('known');
  if (tabUnknown) tabUnknown.onclick = () => setContactTab('unknown');

  if (contactsListEl) {
    contactsListEl.addEventListener('scroll', () => {
      const nearBottom = contactsListEl.scrollTop + contactsListEl.clientHeight >= contactsListEl.scrollHeight - 80;
      if (!nearBottom) return;

      if (!state.isSearchMode) {
        if (state.contactsHasMore && !state.isFetchingContacts) {
          loadContacts(true);
        }
      } else {
        if (state.searchMessagesHasMore && !state.isFetchingMoreSearch) {
          loadMoreSearchMessages();
        }
      }
    });
  }
}
