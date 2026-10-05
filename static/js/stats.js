import { API_BASE } from './api.js';
import { state } from './state.js';
import { formatCompactNumber, formatYmLabel, getInitials, escapeHtml } from './utils.js';
import { closeGalleryView } from './gallery.js';
import { openChatView, openListView, updateVisibleDatePill } from './chat.js';
import { selectContact } from './contacts.js';

// DOM Elements
const btnStatsToggle = document.getElementById('btn-stats-toggle');
const btnStatsMenu = document.getElementById('btn-stats-menu');
const statsDashboardView = document.getElementById('stats-dashboard-view');
const btnCloseStats = document.getElementById('btn-close-stats');
const btnRefreshStats = document.getElementById('btn-refresh-stats');
const statsLoading = document.getElementById('stats-loading');
const statsCardsContainer = document.getElementById('stats-cards-container');
const statsSpanBadge = document.getElementById('stats-span-badge');

const statTotalMessages = document.getElementById('stat-total-messages');
const statSmsMmsSub = document.getElementById('stat-sms-mms-sub');
const statSentRecv = document.getElementById('stat-sent-recv');
const statSentBar = document.getElementById('stat-sent-bar');
const statRecvBar = document.getElementById('stat-recv-bar');
const statSentPct = document.getElementById('stat-sent-pct');
const statRecvPct = document.getElementById('stat-recv-pct');
const statTotalMedia = document.getElementById('stat-total-media');
const statSpanYears = document.getElementById('stat-span-years');
const statSpanDates = document.getElementById('stat-span-dates');
const chartTimelineRange = document.getElementById('chart-timeline-range');
const topContactsTbody = document.getElementById('top-contacts-tbody');

const chatTitle = document.getElementById('chat-title');
const chatSub = document.getElementById('chat-sub');
const btnGalleryToggle = document.getElementById('btn-gallery-toggle');
const btnBack = document.getElementById('btn-back');
const viewport = document.getElementById('messages-viewport');
const bottomBar = document.getElementById('chat-bottom-bar');
const chatDatePill = document.getElementById('chat-date-pill');

export function toggleStatsView() {
  if (state.isStatsOpen) {
    closeStatsView();
  } else {
    openStatsView();
  }
}

export function openStatsView() {
  if (state.isGalleryOpen) closeGalleryView();
  state.isStatsOpen = true;

  if (btnStatsToggle) {
    btnStatsToggle.classList.add('btn-active', 'text-primary');
  }

  // Update Top Chat Header to Archive Telemetry
  if (chatTitle) chatTitle.textContent = 'Archive Telemetry';
  if (state.statsData && state.statsData.summary) {
    const s = state.statsData.summary;
    if (chatSub) chatSub.textContent = `${(s.total_messages || 0).toLocaleString()} messages · ${s.span_years || 0} years across all contacts`;
    if (statsSpanBadge && s.first_date && s.last_date) {
      const d1 = new Date(s.first_date * 1000);
      const d2 = new Date(s.last_date * 1000);
      statsSpanBadge.textContent = `${d1.getFullYear()} – ${d2.getFullYear()}`;
      statsSpanBadge.classList.remove('hidden');
    }
  } else {
    if (chatSub) chatSub.textContent = 'Lifetime statistics across all contacts';
    if (statsSpanBadge) statsSpanBadge.classList.add('hidden');
  }

  // Switch header action controls
  if (btnGalleryToggle) btnGalleryToggle.classList.add('hidden');
  if (btnBack) btnBack.title = 'Back to Chat';
  const statsHeaderActions = document.getElementById('stats-header-actions');
  if (statsHeaderActions) statsHeaderActions.classList.remove('hidden');

  if (viewport) viewport.classList.add('hidden');
  if (bottomBar) bottomBar.classList.add('hidden');
  if (chatDatePill) chatDatePill.classList.add('hidden');

  if (statsDashboardView) {
    statsDashboardView.classList.remove('hidden');
    statsDashboardView.classList.add('flex');
  }

  openChatView();

  if (!state.statsData) {
    loadStatsData();
  } else {
    renderStatsData(state.statsData);
  }
}

export function closeStatsView() {
  state.isStatsOpen = false;

  if (btnStatsToggle) {
    btnStatsToggle.classList.remove('btn-active', 'text-primary');
  }
  if (btnBack) btnBack.title = 'Back to Contacts';

  const statsHeaderActions = document.getElementById('stats-header-actions');
  if (statsHeaderActions) statsHeaderActions.classList.add('hidden');
  if (statsSpanBadge) statsSpanBadge.classList.add('hidden');

  if (statsDashboardView) {
    statsDashboardView.classList.add('hidden');
    statsDashboardView.classList.remove('flex');
  }

  if (state.currentContact) {
    if (chatTitle) chatTitle.textContent = state.currentContact.name;
    if (chatSub) chatSub.textContent = `${state.currentContact.address} · ${Number(state.currentContact.count || 0).toLocaleString()} texts`;
    if (btnGalleryToggle && state.conversationMediaTotal > 0) btnGalleryToggle.classList.remove('hidden');
    if (viewport) viewport.classList.remove('hidden');
    if (bottomBar) bottomBar.classList.remove('hidden');
    updateVisibleDatePill();
  } else {
    if (chatTitle) chatTitle.textContent = 'Select a Conversation';
    if (chatSub) chatSub.textContent = 'SMS Archive';
    if (btnGalleryToggle) btnGalleryToggle.classList.add('hidden');
    if (window.innerWidth < 768) {
      openListView();
    } else {
      if (viewport) viewport.classList.remove('hidden');
    }
  }
}

export async function loadStatsData(forceRefresh = false) {
  if (!statsDashboardView) return;

  if (statsLoading) {
    statsLoading.innerHTML = `
      <div class="w-full max-w-5xl mx-auto space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <div class="skeleton h-24 rounded-box"></div>
          <div class="skeleton h-24 rounded-box"></div>
          <div class="skeleton h-24 rounded-box"></div>
          <div class="skeleton h-24 rounded-box"></div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
          <div class="skeleton h-56 sm:h-64 rounded-box"></div>
          <div class="skeleton h-56 sm:h-64 rounded-box"></div>
        </div>
        <div class="skeleton h-60 rounded-box"></div>
        <div class="flex justify-center items-center gap-2 pt-2 opacity-60">
          <span class="loading loading-spinner loading-sm text-primary"></span>
          <span class="text-xs font-medium">Aggregating lifetime telemetry...</span>
        </div>
      </div>
    `;
    statsLoading.classList.remove('hidden');
  }
  if (statsCardsContainer) statsCardsContainer.classList.add('hidden');

  const refreshIcon = btnRefreshStats?.querySelector('svg');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');

  try {
    const url = forceRefresh ? `${API_BASE}/analytics?refresh=1` : `${API_BASE}/analytics`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.statsData = data;
    renderStatsData(data);
    if (statsLoading) statsLoading.classList.add('hidden');
    if (statsCardsContainer) statsCardsContainer.classList.remove('hidden');
  } catch (err) {
    console.error('Failed to load analytics:', err);
    if (statsLoading) {
      statsLoading.innerHTML = `
        <div class="hero-content text-center text-error">
          <div>
            <svg class="w-12 h-12 mx-auto mb-2 fill-current opacity-60" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
            <p class="font-bold">Failed to load archive telemetry</p>
            <p class="text-xs opacity-70 mt-1">${escapeHtml(err.message)}</p>
            <button type="button" class="btn btn-xs btn-outline btn-error mt-3" id="btn-stats-retry">Retry</button>
          </div>
        </div>
      `;
      statsLoading.classList.remove('hidden');
      const retryBtn = document.getElementById('btn-stats-retry');
      if (retryBtn) retryBtn.onclick = () => loadStatsData(true);
    }
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
  }
}

export function renderTimelineChart(timeline) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('chart-timeline');
  if (!canvas) return;

  if (state.timelineChartInstance) {
    state.timelineChartInstance.destroy();
    state.timelineChartInstance = null;
  }

  const labels = timeline.map(t => formatYmLabel(t.date));
  const sentData = timeline.map(t => t.sent || 0);
  const recvData = timeline.map(t => t.received || 0);

  const ctx = canvas.getContext('2d');
  state.timelineChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Sent',
          data: sentData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.35)',
          fill: true,
          tension: 0.3,
          pointRadius: timeline.length > 50 ? 0 : 2,
          pointHoverRadius: 5,
          borderWidth: 2
        },
        {
          label: 'Received',
          data: recvData,
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168, 85, 247, 0.35)',
          fill: true,
          tension: 0.3,
          pointRadius: timeline.length > 50 ? 0 : 2,
          pointHoverRadius: 5,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: '#a6adba',
            font: { size: 11, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: '#191e24',
          titleColor: '#e5e6e6',
          bodyColor: '#a6adba',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            footer: (items) => {
              let total = 0;
              items.forEach(i => { total += i.parsed.y; });
              return `Total: ${total.toLocaleString()}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#a6adba',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: window.innerWidth < 640 ? 6 : 12,
            font: { size: 10 }
          }
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#a6adba',
            font: { size: 10 },
            callback: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
          }
        }
      }
    }
  });
}

export function renderHourlyChart(hourly) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('chart-hourly');
  if (!canvas) return;

  if (state.hourlyChartInstance) {
    state.hourlyChartInstance.destroy();
    state.hourlyChartInstance = null;
  }

  const labels = [
    '12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a',
    '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'
  ];

  const ctx = canvas.getContext('2d');
  state.hourlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Messages',
          data: hourly,
          backgroundColor: 'rgba(59, 130, 246, 0.75)',
          hoverBackgroundColor: '#3b82f6',
          borderRadius: 4,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#191e24',
          titleColor: '#e5e6e6',
          bodyColor: '#a6adba',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            title: (items) => {
              const h = items[0].dataIndex;
              const hStr = h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
              const nextH = (h + 1) % 24;
              const nextStr = nextH === 0 ? '12:00 AM' : nextH < 12 ? `${nextH}:00 AM` : nextH === 12 ? '12:00 PM' : `${nextH - 12}:00 PM`;
              return `${hStr} – ${nextStr}`;
            },
            label: (item) => `${item.parsed.y.toLocaleString()} messages`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: '#a6adba',
            font: { size: window.innerWidth < 640 ? 9 : 10 },
            autoSkip: true,
            maxTicksLimit: window.innerWidth < 640 ? 12 : 24
          }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#a6adba',
            font: { size: 10 },
            callback: (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v
          }
        }
      }
    }
  });
}

export function renderTopContacts(topContacts) {
  if (!topContactsTbody) return;
  topContactsTbody.innerHTML = '';
  if (!topContacts || topContacts.length === 0) {
    topContactsTbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 opacity-50">No contact activity recorded</td></tr>';
    return;
  }

  topContacts.forEach((c, idx) => {
    const rank = idx + 1;
    const total = c.total || 0;
    const sent = c.sent || 0;
    const recv = c.received || 0;
    const sPct = total > 0 ? Math.round((sent / total) * 100) : 50;
    const rPct = 100 - sPct;

    let badgeClass = 'text-xs font-mono opacity-60';
    if (rank === 1) badgeClass = 'badge badge-sm badge-warning font-bold';
    else if (rank === 2) badgeClass = 'badge badge-sm badge-neutral font-bold';
    else if (rank === 3) badgeClass = 'badge badge-sm badge-accent font-bold';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-base-300/60 cursor-pointer transition-colors select-none';
    tr.title = `Click to open chat with ${escapeHtml(c.name)}`;
    tr.innerHTML = `
      <td class="text-center font-bold">
        <span class="${badgeClass}">${rank}</span>
      </td>
      <td>
        <div class="flex items-center gap-2 sm:gap-2.5">
          <div class="avatar placeholder flex-shrink-0">
            <div class="bg-neutral text-neutral-content rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center font-bold text-xs">
              <span>${getInitials(c.name)}</span>
            </div>
          </div>
          <div class="min-w-0">
            <div class="font-bold text-xs sm:text-sm truncate max-w-[130px] sm:max-w-xs">${escapeHtml(c.name)}</div>
            <div class="text-[10px] sm:text-[11px] opacity-60 truncate max-w-[130px] sm:max-w-xs">${escapeHtml(c.address)}</div>
            <div class="sm:hidden flex items-center gap-1 mt-0.5 text-[9px] opacity-70 font-mono">
              <span class="text-primary font-medium">${sPct}%S</span>
              <span>/</span>
              <span class="text-secondary font-medium">${rPct}%R</span>
            </div>
          </div>
        </div>
      </td>
      <td class="text-right font-mono font-bold text-xs sm:text-sm whitespace-nowrap">
        ${total.toLocaleString()}
      </td>
      <td class="hidden sm:table-cell">
        <div class="flex flex-col gap-1 items-center justify-center">
          <div class="w-full bg-base-300 h-2 rounded-full overflow-hidden flex">
            <div class="bg-primary h-full" style="width: ${sPct}%" title="${sPct}% Sent (${sent.toLocaleString()})"></div>
            <div class="bg-secondary h-full" style="width: ${rPct}%" title="${rPct}% Received (${recv.toLocaleString()})"></div>
          </div>
          <div class="flex justify-between w-full text-[10px] opacity-70 px-0.5">
            <span class="text-primary font-medium">${sPct}% S</span>
            <span class="text-secondary font-medium">${rPct}% R</span>
          </div>
        </div>
      </td>
    `;
    tr.onclick = () => {
      closeStatsView();
      selectContact({ address: c.address, name: c.name, count: total });
    };
    topContactsTbody.appendChild(tr);
  });
}

export function renderStatsData(data) {
  if (!data || !data.summary) return;

  const s = data.summary;
  if (state.isStatsOpen) {
    if (chatTitle) chatTitle.textContent = 'Archive Telemetry';
    if (chatSub) chatSub.textContent = `${(s.total_messages || 0).toLocaleString()} messages · ${s.span_years || 0} years across all contacts`;
  }

  if (statTotalMessages) statTotalMessages.textContent = (s.total_messages || 0).toLocaleString();
  if (statSmsMmsSub) statSmsMmsSub.textContent = `${(s.sms_count || 0).toLocaleString()} SMS · ${(s.mms_count || 0).toLocaleString()} MMS`;

  const totalSentRecv = (s.sent || 0) + (s.received || 0);
  const sentPct = totalSentRecv > 0 ? Math.round(((s.sent || 0) / totalSentRecv) * 100) : 50;
  const recvPct = 100 - sentPct;

  if (statSentRecv) {
    statSentRecv.innerHTML = `<span>${formatCompactNumber(s.sent || 0)}</span> <span class="opacity-40 font-normal">/</span> <span>${formatCompactNumber(s.received || 0)}</span>`;
    statSentRecv.title = `${(s.sent || 0).toLocaleString()} Sent / ${(s.received || 0).toLocaleString()} Received`;
  }
  if (statSentBar) statSentBar.style.width = `${sentPct}%`;
  if (statRecvBar) statRecvBar.style.width = `${recvPct}%`;
  if (statSentPct) statSentPct.textContent = `${sentPct}% Sent`;
  if (statRecvPct) statRecvPct.textContent = `${recvPct}% Received`;

  if (statTotalMedia) statTotalMedia.textContent = (s.media_count || 0).toLocaleString();
  if (statSpanYears) statSpanYears.textContent = `${s.span_years || 0} Years`;

  if (s.first_date && s.last_date) {
    const d1 = new Date(s.first_date * 1000);
    const d2 = new Date(s.last_date * 1000);
    const f1 = d1.toLocaleDateString([], { month: 'short', year: 'numeric' });
    const f2 = d2.toLocaleDateString([], { month: 'short', year: 'numeric' });
    if (statSpanDates) statSpanDates.textContent = `${f1} – ${f2}`;
    if (statsSpanBadge) {
      statsSpanBadge.textContent = `${d1.getFullYear()} – ${d2.getFullYear()}`;
      if (state.isStatsOpen) statsSpanBadge.classList.remove('hidden');
    }
    if (chartTimelineRange) {
      chartTimelineRange.textContent = `${d1.getFullYear()} – ${d2.getFullYear()}`;
    }
  }

  if (data.timeline) {
    renderTimelineChart(data.timeline);
  }
  if (data.hourly) {
    renderHourlyChart(data.hourly);
  }
  if (data.top_contacts) {
    renderTopContacts(data.top_contacts);
  }
}

export function initStats() {
  if (btnStatsToggle) {
    btnStatsToggle.onclick = () => toggleStatsView();
  }
  if (btnStatsMenu) {
    btnStatsMenu.onclick = () => {
      if (document.activeElement) document.activeElement.blur();
      openStatsView();
    };
  }
  if (btnCloseStats) {
    btnCloseStats.onclick = () => closeStatsView();
  }
  if (btnRefreshStats) {
    btnRefreshStats.onclick = () => loadStatsData(true);
  }
}
