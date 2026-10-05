import { API_BASE } from './api.js';
import { state, GALLERY_LIMIT } from './state.js';
import { formatDate, formatTime, escapeHtml } from './utils.js';
import { jumpToGlobalMessage, updateVisibleDatePill } from './chat.js';

// DOM Elements
const btnGalleryToggle = document.getElementById('btn-gallery-toggle');
const galleryCountBadge = document.getElementById('gallery-count-badge');
const conversationGalleryView = document.getElementById('conversation-gallery-view');
const galleryGridContainer = document.getElementById('gallery-grid-container');
const galleryStatsLabel = document.getElementById('gallery-stats-label');
const btnCloseGallery = document.getElementById('btn-close-gallery');

const modalLightbox = document.getElementById('modal-lightbox');
const lightboxCounter = document.getElementById('lightbox-counter');
const lightboxDate = document.getElementById('lightbox-date');
const lightboxMediaContainer = document.getElementById('lightbox-media-container');
const lightboxCaption = document.getElementById('lightbox-caption');
const btnLightboxPrev = document.getElementById('btn-lightbox-prev');
const btnLightboxNext = document.getElementById('btn-lightbox-next');
const btnLightboxJump = document.getElementById('btn-lightbox-jump');
const btnLightboxDownload = document.getElementById('btn-lightbox-download');
const btnCloseLightbox = document.getElementById('btn-close-lightbox');

const viewport = document.getElementById('messages-viewport');
const bottomBar = document.getElementById('chat-bottom-bar');
const chatDatePill = document.getElementById('chat-date-pill');

export async function fetchConversationMedia(address, append = false) {
  if (state.isFetchingMedia) return;
  if (!append) {
    state.galleryOffset = 0;
    state.galleryHasMore = false;
    state.conversationMedia = [];
    state.conversationMediaTotal = 0;
  } else {
    if (!state.galleryHasMore) return;
  }
  state.isFetchingMedia = true;

  if (append && state.isGalleryOpen) {
    renderGalleryLoadingIndicator(true);
  }

  try {
    const res = await fetch(`${API_BASE}/conversation-media?address=${encodeURIComponent(address)}&limit=${GALLERY_LIMIT}&offset=${state.galleryOffset}`);
    const data = await res.json();
    const incoming = data.media || [];
    state.conversationMediaTotal = data.total !== undefined ? data.total : incoming.length;
    state.galleryHasMore = !!data.has_more;
    state.galleryOffset += incoming.length;

    if (galleryCountBadge) {
      galleryCountBadge.textContent = Number(state.conversationMediaTotal).toLocaleString();
    }
    if (btnGalleryToggle) {
      btnGalleryToggle.classList.remove('hidden');
      if (state.conversationMediaTotal === 0) {
        btnGalleryToggle.classList.add('opacity-40');
        btnGalleryToggle.title = 'No media in this conversation';
      } else {
        btnGalleryToggle.classList.remove('opacity-40');
        btnGalleryToggle.title = `View Media Gallery (${state.conversationMediaTotal.toLocaleString()} items)`;
      }
    }

    if (!append) {
      state.conversationMedia = incoming;
      if (state.isGalleryOpen) {
        renderGalleryGrid(false);
      }
    } else {
      const startIndex = state.conversationMedia.length;
      state.conversationMedia = state.conversationMedia.concat(incoming);
      if (state.isGalleryOpen) {
        renderGalleryGrid(true, incoming, startIndex);
      }
    }
  } catch (err) {
    console.error('Error fetching conversation media:', err);
  } finally {
    state.isFetchingMedia = false;
    if (state.isGalleryOpen) {
      renderGalleryLoadingIndicator(false);
    }
  }
}

export function renderGalleryLoadingIndicator(show) {
  let loader = document.getElementById('gallery-loading-more');
  if (show) {
    if (!loader && galleryGridContainer) {
      loader = document.createElement('div');
      loader.id = 'gallery-loading-more';
      loader.className = 'py-6 flex justify-center items-center gap-2 text-xs opacity-60';
      loader.innerHTML = '<span class="loading loading-spinner loading-sm"></span> Loading more media...';
      galleryGridContainer.appendChild(loader);
    }
  } else {
    if (loader && loader.parentNode) {
      loader.parentNode.removeChild(loader);
    }
  }
}

export function toggleGalleryView() {
  if (state.isGalleryOpen) {
    closeGalleryView();
  } else {
    openGalleryView();
  }
}

export function openGalleryView() {
  if (!state.currentContact) return;
  state.isGalleryOpen = true;
  if (viewport) viewport.classList.add('hidden');
  if (bottomBar) bottomBar.classList.add('hidden');
  if (conversationGalleryView) {
    conversationGalleryView.classList.remove('hidden');
    conversationGalleryView.classList.add('flex');
  }
  if (chatDatePill) chatDatePill.classList.add('hidden');
  renderGalleryGrid(false);
}

export function closeGalleryView() {
  state.isGalleryOpen = false;
  if (conversationGalleryView) {
    conversationGalleryView.classList.add('hidden');
    conversationGalleryView.classList.remove('flex');
  }
  if (viewport) viewport.classList.remove('hidden');
  if (bottomBar) bottomBar.classList.remove('hidden');
  updateVisibleDatePill();
}

export function createMediaCard(m, idx) {
  const isVideo = m.media_type && m.media_type.startsWith('video/');
  const ext = (m.media_type || '').split('/')[1] || 'media';
  const card = document.createElement('div');
  card.className = 'group relative aspect-square bg-base-300 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all duration-150 select-none';
  card.onclick = () => openLightbox(idx);
  card.innerHTML = `
    ${isVideo ? `
      <div class="w-full h-full flex flex-col items-center justify-center bg-neutral/80 text-neutral-content p-2 select-none group-hover:bg-neutral transition-colors">
        <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary mb-1 shadow">
          <svg class="w-5 h-5 fill-current ml-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
        <span class="text-[11px] font-mono opacity-80 uppercase">${escapeHtml(ext)}</span>
      </div>
    ` : `
      <img src="${API_BASE}/media?id=${m.id}&thumb=1&v=2" loading="lazy" class="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" alt="Media thumbnail">
    `}
    <div class="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-[10px] text-white flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
      <span>${formatDate(m.date)}</span>
      <span class="badge badge-xs badge-neutral text-[9px] uppercase tracking-wide">${escapeHtml(ext)}</span>
    </div>
  `;
  return card;
}

export function renderGalleryGrid(append = false, newItems = [], startIndex = 0) {
  if (!galleryGridContainer) return;

  if (galleryStatsLabel) {
    if (state.conversationMedia.length < state.conversationMediaTotal) {
      galleryStatsLabel.textContent = `Showing ${state.conversationMedia.length.toLocaleString()} of ${state.conversationMediaTotal.toLocaleString()}`;
    } else {
      galleryStatsLabel.textContent = `${state.conversationMediaTotal.toLocaleString()} items`;
    }
  }

  if (!append) {
    if (state.conversationMedia.length === 0) {
      galleryGridContainer.innerHTML = `
        <div class="hero h-64">
          <div class="hero-content text-center opacity-50">
            <div>
              <svg class="w-12 h-12 mx-auto mb-2 fill-current opacity-40" viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              <p>No photos or media found in this conversation.</p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    galleryGridContainer.innerHTML = '<div id="gallery-cards-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5"></div>';
    const gridEl = document.getElementById('gallery-cards-grid');
    state.conversationMedia.forEach((m, idx) => {
      gridEl.appendChild(createMediaCard(m, idx));
    });
  } else {
    const gridEl = document.getElementById('gallery-cards-grid');
    if (gridEl) {
      newItems.forEach((m, offsetIdx) => {
        gridEl.appendChild(createMediaCard(m, startIndex + offsetIdx));
      });
    }
  }
}

export function openLightbox(index) {
  if (!state.conversationMedia || state.conversationMedia.length === 0) return;
  if (index < 0) index = state.conversationMedia.length - 1;
  if (index >= state.conversationMedia.length) {
    if (state.galleryHasMore && !state.isFetchingMedia && state.currentContact) {
      fetchConversationMedia(state.currentContact.address, true).then(() => {
        if (index < state.conversationMedia.length) openLightbox(index);
      });
      return;
    }
    index = 0;
  }
  state.currentLightboxIndex = index;

  if (state.currentLightboxIndex >= state.conversationMedia.length - 6 && state.galleryHasMore && !state.isFetchingMedia && state.currentContact) {
    fetchConversationMedia(state.currentContact.address, true);
  }

  const item = state.conversationMedia[index];
  if (!item) return;

  if (lightboxCounter) {
    lightboxCounter.textContent = `${index + 1} / ${state.conversationMediaTotal || state.conversationMedia.length}`;
  }
  if (lightboxDate) {
    lightboxDate.textContent = `${formatDate(item.date)} ${formatTime(item.date)}`;
  }
  if (btnLightboxDownload) {
    btnLightboxDownload.href = `${API_BASE}/media?id=${item.id}`;
  }

  if (lightboxCaption) {
    if (item.body && item.body.trim()) {
      lightboxCaption.textContent = item.body.trim();
      lightboxCaption.classList.remove('hidden');
    } else {
      lightboxCaption.textContent = '';
      lightboxCaption.classList.add('hidden');
    }
  }

  const isVideo = item.media_type && item.media_type.startsWith('video/');
  if (isVideo) {
    lightboxMediaContainer.innerHTML = `
      <video src="${API_BASE}/media?id=${item.id}" controls autoplay class="max-h-full max-w-full object-contain rounded shadow-2xl"></video>
    `;
  } else {
    lightboxMediaContainer.innerHTML = `
      <img src="${API_BASE}/media?id=${item.id}" class="max-h-full max-w-full object-contain rounded shadow-2xl transition-all" alt="Full size media">
    `;
  }

  if (modalLightbox && !modalLightbox.open) {
    modalLightbox.showModal();
  }
}

export function lightboxPrev() {
  if (state.conversationMedia.length <= 1) return;
  openLightbox(state.currentLightboxIndex - 1);
}

export function lightboxNext() {
  if (state.conversationMedia.length <= 1) return;
  openLightbox(state.currentLightboxIndex + 1);
}

export function openLightboxForMessageId(msgId) {
  const idx = state.conversationMedia.findIndex(m => m.id === msgId);
  if (idx !== -1) {
    openLightbox(idx);
  } else {
    state.conversationMedia = [{ id: msgId, date: 0, media_type: 'image/jpeg' }];
    openLightbox(0);
  }
}

export function initGallery() {
  if (btnGalleryToggle) {
    btnGalleryToggle.onclick = () => toggleGalleryView();
  }
  if (btnCloseGallery) {
    btnCloseGallery.onclick = () => closeGalleryView();
  }
  if (btnCloseLightbox && modalLightbox) {
    btnCloseLightbox.onclick = () => modalLightbox.close();
  }
  if (btnLightboxPrev) {
    btnLightboxPrev.onclick = (e) => { e.stopPropagation(); lightboxPrev(); };
  }
  if (btnLightboxNext) {
    btnLightboxNext.onclick = (e) => { e.stopPropagation(); lightboxNext(); };
  }
  if (btnLightboxJump) {
    btnLightboxJump.onclick = () => {
      const item = state.conversationMedia[state.currentLightboxIndex];
      if (!item || !state.currentContact) return;
      if (modalLightbox && modalLightbox.open) modalLightbox.close();
      if (state.isGalleryOpen) closeGalleryView();
      jumpToGlobalMessage(item.id, state.currentContact.address, state.currentContact.name);
    };
  }

  if (galleryGridContainer) {
    galleryGridContainer.addEventListener('scroll', () => {
      if (!state.isGalleryOpen || !state.galleryHasMore || state.isFetchingMedia || !state.currentContact) return;
      const nearBottom = galleryGridContainer.scrollTop + galleryGridContainer.clientHeight >= galleryGridContainer.scrollHeight - 200;
      if (nearBottom) {
        fetchConversationMedia(state.currentContact.address, true);
      }
    });
  }
}
