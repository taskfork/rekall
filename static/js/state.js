export const state = {
  currentContact: null,
  messages: [],
  isFetchingOlder: false,
  isFetchingNewer: false,
  hasMoreOlder: true,
  hasMoreNewer: false,
  searchDebounceTimer: null,
  isJumpingToContext: false,

  // Contacts
  currentContactTab: 'known',
  contactsOffset: 0,
  contactsHasMore: true,
  isFetchingContacts: false,
  allContactsCache: [],

  // Message search pagination
  isSearchMode: false,
  currentSearchQuery: '',
  searchMessagesOffset: 0,
  searchMessagesHasMore: false,
  isFetchingMoreSearch: false,

  // Gallery & Lightbox
  conversationMedia: [],
  conversationMediaTotal: 0,
  galleryOffset: 0,
  galleryHasMore: false,
  isFetchingMedia: false,
  isGalleryOpen: false,
  currentLightboxIndex: 0,

  // Stats
  isStatsOpen: false,
  statsData: null,
  timelineChartInstance: null,
  hourlyChartInstance: null,

  // Responsive / Dual-pane
  isMobileChatOpen: false,
};

export const CONTACTS_LIMIT = 50;
export const SEARCH_MESSAGES_LIMIT = 50;
export const GALLERY_LIMIT = 48;
