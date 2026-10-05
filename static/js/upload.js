import { formatBytes } from './utils.js';
import { state } from './state.js';
import { loadContacts } from './contacts.js';
import { loadStatsData } from './stats.js';

let selectedUploadFile = null;
let isUploading = false;
let progressPollTimer = null;

// DOM Elements
const btnOpenUpload = document.getElementById('btn-open-upload');
const modalUpload = document.getElementById('modal-upload');
const btnCloseUpload = document.getElementById('btn-close-upload');
const btnCancelUpload = document.getElementById('btn-cancel-upload');
const btnStartUpload = document.getElementById('btn-start-upload');
const uploadDropzone = document.getElementById('upload-dropzone');
const fileUploadInput = document.getElementById('file-upload-input');
const uploadStatusCard = document.getElementById('upload-status-card');
const uploadFilename = document.getElementById('upload-filename');
const uploadFilesize = document.getElementById('upload-filesize');
const uploadProgressBar = document.getElementById('upload-progress-bar');
const uploadStatusText = document.getElementById('upload-status-text');
const uploadPercentText = document.getElementById('upload-percent-text');
const uploadAlert = document.getElementById('upload-alert');
const uploadAlertText = document.getElementById('upload-alert-text');

export function resetUploadState() {
  selectedUploadFile = null;
  isUploading = false;
  if (progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
  if (fileUploadInput) fileUploadInput.value = '';
  if (uploadDropzone) uploadDropzone.classList.remove('hidden');
  if (uploadStatusCard) uploadStatusCard.classList.add('hidden');
  if (btnStartUpload) {
    btnStartUpload.classList.add('hidden');
    btnStartUpload.disabled = true;
    btnStartUpload.textContent = 'Start Import';
  }
  if (btnCancelUpload) {
    btnCancelUpload.disabled = false;
    btnCancelUpload.textContent = 'Cancel';
  }
  if (uploadAlert) uploadAlert.classList.add('hidden');
  if (uploadProgressBar) {
    uploadProgressBar.value = 0;
    uploadProgressBar.classList.remove('progress-success', 'progress-error');
    uploadProgressBar.classList.add('progress-primary');
  }
}

export function closeUploadModal() {
  if (isUploading) {
    if (!confirm('Upload/Ingestion is currently running. Are you sure you want to dismiss?')) return;
  }
  resetUploadState();
  if (modalUpload) modalUpload.close();
}

export function showUploadAlert(msg, type = 'alert-info') {
  if (!uploadAlert || !uploadAlertText) return;
  uploadAlert.className = `mt-4 alert text-xs ${type}`;
  uploadAlertText.textContent = msg;
  uploadAlert.classList.remove('hidden');
}

export function handleFileSelection(file) {
  if (!file.name.toLowerCase().endsWith('.xml')) {
    showUploadAlert('Please select a valid SMS Backup & Restore .xml file', 'alert-warning');
    return;
  }
  selectedUploadFile = file;
  if (uploadFilename) uploadFilename.textContent = file.name;
  if (uploadFilesize) uploadFilesize.textContent = formatBytes(file.size);
  if (uploadDropzone) uploadDropzone.classList.add('hidden');
  if (uploadStatusCard) uploadStatusCard.classList.remove('hidden');
  if (btnStartUpload) {
    btnStartUpload.classList.remove('hidden');
    btnStartUpload.disabled = false;
    btnStartUpload.textContent = 'Start Import';
  }
  if (uploadStatusText) uploadStatusText.textContent = 'File ready to import';
  if (uploadPercentText) uploadPercentText.textContent = '';
  if (uploadAlert) uploadAlert.classList.add('hidden');
}

export function initUpload() {
  if (btnOpenUpload && modalUpload) {
    btnOpenUpload.onclick = () => {
      if (document.activeElement) document.activeElement.blur();
      resetUploadState();
      modalUpload.showModal();
    };
  }

  if (btnCloseUpload) btnCloseUpload.onclick = closeUploadModal;
  if (btnCancelUpload) btnCancelUpload.onclick = closeUploadModal;

  if (uploadDropzone && fileUploadInput) {
    uploadDropzone.onclick = () => fileUploadInput.click();

    ['dragenter', 'dragover'].forEach(name => {
      uploadDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadDropzone.classList.add('border-primary', 'bg-primary/5');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      uploadDropzone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadDropzone.classList.remove('border-primary', 'bg-primary/5');
      });
    });

    uploadDropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) handleFileSelection(files[0]);
    });

    fileUploadInput.onchange = (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileSelection(e.target.files[0]);
      }
    };
  }

  if (btnStartUpload) {
    btnStartUpload.onclick = async () => {
      if (!selectedUploadFile || isUploading) return;
      isUploading = true;
      btnStartUpload.disabled = true;
      btnStartUpload.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Ingesting...';
      btnCancelUpload.disabled = true;

      if (uploadStatusText) uploadStatusText.textContent = 'Streaming file to ingestion engine...';
      if (uploadProgressBar) uploadProgressBar.value = 0;

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Filename', selectedUploadFile.name);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          if (uploadProgressBar) uploadProgressBar.value = pct;
          if (uploadPercentText) uploadPercentText.textContent = `${pct}%`;
          if (uploadStatusText) uploadStatusText.textContent = `Streaming file... (${formatBytes(e.loaded)} / ${formatBytes(e.total)})`;
        }
      };

      // Poll progress endpoint
      progressPollTimer = setInterval(async () => {
        try {
          const res = await fetch('/api/progress');
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'parsing' || data.status === 'importing') {
              const total = data.total_messages || 0;
              const proc = data.processed_messages || 0;
              if (uploadStatusText) {
                uploadStatusText.textContent = `Ingesting messages... (${proc.toLocaleString()} ${total ? 'of ' + total.toLocaleString() : 'processed'})`;
              }
              if (total > 0 && uploadProgressBar) {
                const parsePct = Math.round((proc / total) * 100);
                uploadProgressBar.value = parsePct;
                if (uploadPercentText) uploadPercentText.textContent = `${parsePct}%`;
              }
            } else if (data.status === 'completed') {
              clearInterval(progressPollTimer);
              progressPollTimer = null;
              if (uploadProgressBar) {
                uploadProgressBar.value = 100;
                uploadProgressBar.classList.remove('progress-primary');
                uploadProgressBar.classList.add('progress-success');
              }
              if (uploadPercentText) uploadPercentText.textContent = '100%';
              if (uploadStatusText) uploadStatusText.textContent = `Ingestion complete! ${data.processed_messages.toLocaleString()} messages processed.`;
              showUploadAlert(`Successfully imported ${selectedUploadFile.name}. Duplicate messages were safely skipped.`, 'alert-success');
              btnStartUpload.classList.add('hidden');
              btnCancelUpload.disabled = false;
              btnCancelUpload.textContent = 'Close';
              isUploading = false;
              state.statsData = null;
              if (state.isStatsOpen) loadStatsData(true);
              // Auto reload contacts
              loadContacts();
            } else if (data.status === 'error') {
              clearInterval(progressPollTimer);
              progressPollTimer = null;
              if (uploadProgressBar) {
                uploadProgressBar.classList.remove('progress-primary');
                uploadProgressBar.classList.add('progress-error');
              }
              showUploadAlert(`Ingestion failed: ${data.error_message || 'Unknown error'}`, 'alert-error');
              btnStartUpload.disabled = false;
              btnStartUpload.textContent = 'Retry';
              btnCancelUpload.disabled = false;
              isUploading = false;
            }
          }
        } catch (e) {
          // Transient polling error
        }
      }, 1000);

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (uploadStatusText) uploadStatusText.textContent = 'File transferred. Ingesting & deduplicating records...';
        } else {
          clearInterval(progressPollTimer);
          progressPollTimer = null;
          showUploadAlert(`Upload error: HTTP ${xhr.status}`, 'alert-error');
          btnStartUpload.disabled = false;
          btnStartUpload.textContent = 'Retry';
          btnCancelUpload.disabled = false;
          isUploading = false;
        }
      };

      xhr.onerror = () => {
        clearInterval(progressPollTimer);
        progressPollTimer = null;
        showUploadAlert('Network error during file upload', 'alert-error');
        btnStartUpload.disabled = false;
        btnStartUpload.textContent = 'Retry';
        btnCancelUpload.disabled = false;
        isUploading = false;
      };

      xhr.send(selectedUploadFile);
    };
  }
}
