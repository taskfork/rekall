import { API_BASE } from './api.js';
import { state } from './state.js';
import { getInitials } from './utils.js';
import { initGallery, toggleGalleryView, closeGalleryView, lightboxPrev, lightboxNext } from './gallery.js';
import { initStats, toggleStatsView, closeStatsView, loadStatsData } from './stats.js';
import { initChat, openListView } from './chat.js';
import { initContacts, loadContacts, setContactTab } from './contacts.js';
import { initSearch, executeGlobalSearch } from './search.js';
import { initUpload } from './upload.js';

// DOM Elements
const contactsListEl = document.getElementById('contacts-list');
const searchInput = document.getElementById('global-search');
const btnJumpLatest = document.getElementById('btn-jump-latest');
const btnShortcuts = document.getElementById('btn-shortcuts');
const modalShortcuts = document.getElementById('modal-shortcuts');
const modalLightbox = document.getElementById('modal-lightbox');
const btnRefreshDb = document.getElementById('btn-refresh-db');
const refreshIcon = document.getElementById('refresh-icon-container');
const refreshText = document.getElementById('refresh-text-container');
const refreshSvg = `<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`;

// Keyboard Navigation & Shortcuts
function getSelectableItems() {
  if (!contactsListEl) return [];
  return Array.from(contactsListEl.querySelectorAll('.contact-item, .search-msg-item'));
}

function moveHighlight(direction) {
  const items = getSelectableItems();
  if (items.length === 0) return;
  let currentIndex = items.findIndex(el => el.classList.contains('bg-base-300'));
  let nextIndex = currentIndex + direction;
  if (currentIndex === -1) {
    nextIndex = direction > 0 ? 0 : items.length - 1;
  } else {
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= items.length) nextIndex = items.length - 1;
  }
  const target = items[nextIndex];
  if (target) {
    items.forEach(el => el.classList.remove('bg-base-300'));
    target.classList.add('bg-base-300');
    target.scrollIntoView({ block: 'nearest' });
  }
}

function navigateList(direction) {
  const items = getSelectableItems();
  if (items.length === 0) return;
  let currentIndex = items.findIndex(el => el.classList.contains('bg-base-300'));
  let nextIndex = currentIndex + direction;
  if (currentIndex === -1) {
    nextIndex = direction > 0 ? 0 : items.length - 1;
  } else {
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= items.length) nextIndex = items.length - 1;
  }
  const target = items[nextIndex];
  if (target) {
    items.forEach(el => el.classList.remove('bg-base-300'));
    target.classList.add('bg-base-300');
    target.scrollIntoView({ block: 'nearest' });
    target.click();
  }
}

function initKeybindings() {
  if (btnShortcuts && modalShortcuts) {
    btnShortcuts.onclick = () => {
      if (document.activeElement) document.activeElement.blur();
      modalShortcuts.showModal();
    };
  }

  window.addEventListener('keydown', (e) => {
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    // 1. Lightbox Active: Handle Esc and Left/Right navigation
    if (modalLightbox && modalLightbox.open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        modalLightbox.close();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        lightboxPrev();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        lightboxNext();
        return;
      }
      return;
    }

    // 2. Focus Search: "/" or Cmd+K / Ctrl+K
    if ((e.key === '/' && !isInput) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // 3. Escape Hierarchy: Close modal / Close stats view / Close gallery view / Clear search / Mobile back
    if (e.key === 'Escape') {
      if (modalShortcuts && modalShortcuts.open) {
        modalShortcuts.close();
        return;
      }
      if (state.isStatsOpen) {
        e.preventDefault();
        closeStatsView();
        return;
      }
      if (state.isGalleryOpen) {
        e.preventDefault();
        closeGalleryView();
        return;
      }
      if ((searchInput && searchInput.value) || isInput) {
        if (searchInput) {
          searchInput.value = '';
          searchInput.blur();
        }
        executeGlobalSearch('');
        return;
      }
      if (window.innerWidth < 768 && state.isMobileChatOpen) {
        openListView();
        return;
      }
    }

    // 4. Search input navigation
    if (isInput && e.target === searchInput) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const items = getSelectableItems();
        if (items.length > 0) {
          const active = items.find(el => el.classList.contains('bg-base-300')) || items[0];
          active.click();
          searchInput.blur();
        }
        return;
      }
      return;
    }

    // Ignore remaining shortcuts if user is typing in another input
    if (isInput) return;

    // 5. Toggle Media Gallery ("g")
    if (e.key.toLowerCase() === 'g' && state.currentContact) {
      e.preventDefault();
      toggleGalleryView();
      return;
    }

    // 5b. Toggle Archive Stats ("s")
    if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      toggleStatsView();
      return;
    }

    // 6. Arrow navigation & vim keys (j / k) - only when gallery & stats are NOT open
    if (!state.isGalleryOpen && !state.isStatsOpen) {
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        navigateList(1);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        navigateList(-1);
        return;
      }

      // Enter: Open currently selected item
      if (e.key === 'Enter') {
        const items = getSelectableItems();
        const active = items.find(el => el.classList.contains('bg-base-300'));
        if (active) {
          e.preventDefault();
          active.click();
          return;
        }
      }
    }

    // 7. Number keys 1 and 2: Switch Tabs (Contacts / Unknown)
    if (!state.isSearchMode && !state.isGalleryOpen) {
      if (e.key === '1') {
        e.preventDefault();
        setContactTab('known');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        setContactTab('unknown');
        return;
      }
    }

    // 8. Jump to latest message: "l" or End
    if (e.key.toLowerCase() === 'l' || e.key === 'End') {
      if (state.currentContact && !state.isGalleryOpen && btnJumpLatest) {
        e.preventDefault();
        btnJumpLatest.click();
        return;
      }
    }

    // 9. Help dialog: "?"
    if (e.key === '?') {
      e.preventDefault();
      if (modalShortcuts) {
        if (modalShortcuts.open) modalShortcuts.close();
        else modalShortcuts.showModal();
      }
    }
  });
}

function initDbRefresh() {
  if (!btnRefreshDb) return;
  btnRefreshDb.onclick = async () => {
    if (refreshIcon) refreshIcon.innerHTML = '<span class="loading loading-spinner loading-xs"></span>';
    if (refreshText) refreshText.textContent = 'Re-indexing...';
    btnRefreshDb.classList.add('opacity-60', 'pointer-events-none');
    try {
      await fetch(`${API_BASE}/refresh`, { method: 'POST' });
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const hRes = await fetch(`${API_BASE}/health`);
          const hData = await hRes.json();
          if (!hData.indexing || attempts > 30) {
            clearInterval(poll);
            if (refreshIcon) refreshIcon.innerHTML = refreshSvg;
            if (refreshText) refreshText.textContent = 'Re-index Database';
            btnRefreshDb.classList.remove('opacity-60', 'pointer-events-none');
            state.statsData = null;
            if (state.isStatsOpen) loadStatsData(true);
            if (!state.isSearchMode) loadContacts();
          }
        } catch (err) {
          clearInterval(poll);
          if (refreshIcon) refreshIcon.innerHTML = refreshSvg;
          if (refreshText) refreshText.textContent = 'Re-index Database';
          btnRefreshDb.classList.remove('opacity-60', 'pointer-events-none');
        }
      }, 1000);
    } catch (e) {
      if (refreshIcon) refreshIcon.innerHTML = refreshSvg;
      if (refreshText) refreshText.textContent = 'Re-index Database';
      btnRefreshDb.classList.remove('opacity-60', 'pointer-events-none');
    }
  };
}

async function loadUserProfile() {
  try {
    const res = await fetch(`${API_BASE}/auth/me`);
    if (res.ok) {
      const user = await res.json();
      const name = user.display_name || user.username || 'User';
      const initial = getInitials(name);
      const initialElem = document.getElementById('user-avatar-initial');
      const nameElem = document.getElementById('user-display-name');
      const emailElem = document.getElementById('user-email');
      if (initialElem) initialElem.textContent = initial;
      if (nameElem) nameElem.textContent = name;
      if (emailElem && user.email) {
        emailElem.textContent = user.email;
        emailElem.classList.remove('hidden');
      }
    }
  } catch (err) {
    console.error('Failed to load user profile:', err);
  }
}

// Initialize Subsystems
initGallery();
initStats();
initChat();
initContacts();
initSearch();
initUpload();
initKeybindings();
initDbRefresh();

// Bootstrap
loadUserProfile();
loadContacts();
