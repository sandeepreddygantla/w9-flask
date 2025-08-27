// W9 Extractor JavaScript
class W9Extractor {
    constructor() {
        this.uploadedFiles = [];
        this.extractedResults = [];
        this.selectedFiles = [];
        
        this.initializeElements();
        this.bindEvents();
        this.initializePdfJs();
    }

    initializeElements() {
        // Upload elements
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.browseBtn = document.getElementById('browseBtn');
        
        // File management elements
        this.uploadedFilesSection = document.getElementById('uploadedFiles');
        this.filesTableBody = document.getElementById('filesTableBody');
        this.selectAllBtn = document.getElementById('selectAllBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.filesSummary = document.getElementById('filesSummary');
        this.selectedCount = document.getElementById('selectedCount');
        this.totalSize = document.getElementById('totalSize');
        this.extractBtn = document.getElementById('extractBtn');
        
        // Preview elements
        this.fileSelector = document.getElementById('fileSelector');
        this.fileSelect = document.getElementById('fileSelect');
        this.previewSection = document.getElementById('previewSection');
        this.pdfCanvas = document.getElementById('pdfCanvas');
        this.pdfLoading = document.getElementById('pdfLoading');
        this.pdfError = document.getElementById('pdfError');
        this.jsonContent = document.getElementById('jsonContent');
        
        // Download elements
        this.downloadSection = document.getElementById('downloadSection');
        this.downloadBtn = document.getElementById('downloadBtn');
        
        // Loading overlay
        this.loadingOverlay = document.getElementById('loadingOverlay');
        
        // Toast container
        this.toastContainer = document.getElementById('toastContainer');
    }

    bindEvents() {
        // File upload events
        this.browseBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        
        // Drag and drop events
        this.uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        
        // File management events
        this.selectAllBtn.addEventListener('click', () => this.toggleSelectAll());
        this.clearAllBtn.addEventListener('click', () => this.clearAllFiles());
        this.extractBtn.addEventListener('click', () => this.extractData());
        
        // Preview events
        this.fileSelect.addEventListener('change', (e) => this.handleFilePreview(e.target.value));
        
        // Download events
        this.downloadBtn.addEventListener('click', () => this.downloadResults());
    }

    initializePdfJs() {
        // PDF.js is already initialized in HTML template
        console.log('PDF.js initialized:', typeof pdfjsLib !== 'undefined');
    }

    // File Upload Handlers
    handleDragOver(e) {
        e.preventDefault();
        this.uploadArea.classList.add('drag-over');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        this.uploadFiles(files);
    }

    handleFileSelect(e) {
        if (e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            this.uploadFiles(files);
        }
        // Always reset input to allow re-selecting same files
        e.target.value = '';
    }

    async uploadFiles(files) {
        const pdfFiles = files.filter(file => file.type === 'application/pdf');
        
        if (pdfFiles.length === 0) {
            this.showToast('No PDF files selected', 'Please select PDF files only.', 'warning');
            return;
        }

        if (pdfFiles.length !== files.length) {
            this.showToast('Some files skipped', 'Only PDF files are supported.', 'warning');
        }

        const formData = new FormData();
        pdfFiles.forEach(file => {
            formData.append('files', file);
        });

        try {
            this.showLoading(true);
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const result = await response.json();
            // Clear previous files (like Streamlit behavior)
            this.uploadedFiles = result.files;
            this.selectedFiles = [];
            this.extractedResults = [];
            
            this.updateFilesDisplay();
            this.hidePreview();
            this.showToast('Files uploaded', `Successfully uploaded ${result.files.length} files.`, 'success');

        } catch (error) {
            this.showToast('Upload failed', error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // File Management
    updateFilesDisplay() {
        if (this.uploadedFiles.length === 0) {
            this.uploadedFilesSection.style.display = 'none';
            return;
        }

        this.uploadedFilesSection.style.display = 'block';
        this.filesTableBody.innerHTML = '';

        this.uploadedFiles.forEach((file, index) => {
            const row = this.createFileRow(file, index);
            this.filesTableBody.appendChild(row);
        });

        this.updateSummary();
    }

    createFileRow(file, index) {
        const row = document.createElement('div');
        row.className = 'table-row';
        row.innerHTML = `
            <input type="checkbox" class="file-checkbox" data-index="${index}" ${this.selectedFiles.includes(file.id) ? 'checked' : ''}>
            <div class="file-name">
                <span class="file-icon">📄</span>
                <span>${file.name}</span>
            </div>
            <div class="file-size">${this.formatFileSize(file.size)}</div>
            <div class="file-status">
                <span class="status-badge status-ready">READY</span>
            </div>
            <div class="file-actions">
                <button class="action-btn" onclick="w9Extractor.previewUploadedFile('${file.id}')" title="Preview">👁️</button>
                <button class="action-btn" onclick="w9Extractor.deleteFile('${file.id}')" title="Delete">🗑️</button>
            </div>
        `;

        const checkbox = row.querySelector('.file-checkbox');
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                this.selectedFiles.push(file.id);
                row.classList.add('selected');
            } else {
                this.selectedFiles = this.selectedFiles.filter(id => id !== file.id);
                row.classList.remove('selected');
            }
            this.updateSummary();
        });

        // Auto-select new files
        this.selectedFiles.push(file.id);
        checkbox.checked = true;
        row.classList.add('selected');
        
        // Preview first file automatically
        if (index === 0) {
            setTimeout(() => {
                this.previewUploadedFile(file.id);
            }, 300);
        }

        return row;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    updateSummary() {
        const selectedFilesData = this.uploadedFiles.filter(file => this.selectedFiles.includes(file.id));
        const totalSize = selectedFilesData.reduce((sum, file) => sum + file.size, 0);
        
        this.selectedCount.textContent = selectedFilesData.length;
        this.totalSize.textContent = this.formatFileSize(totalSize);
        
        this.extractBtn.disabled = selectedFilesData.length === 0;
        this.updateSelectAllButton();
    }

    updateSelectAllButton() {
        const allSelected = this.uploadedFiles.length > 0 && 
                          this.uploadedFiles.every(file => this.selectedFiles.includes(file.id));
        this.selectAllBtn.textContent = allSelected ? 'All Selected' : 'Select All';
    }

    toggleSelectAll() {
        const allSelected = this.uploadedFiles.length > 0 && 
                          this.uploadedFiles.every(file => this.selectedFiles.includes(file.id));
        
        if (allSelected) {
            this.selectedFiles = [];
        } else {
            this.selectedFiles = this.uploadedFiles.map(file => file.id);
        }

        this.updateFilesDisplay();
    }

    async clearAllFiles() {
        if (this.uploadedFiles.length === 0) return;
        
        try {
            // Clear session on server
            const response = await fetch('/clear-session', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.uploadedFiles = [];
                this.selectedFiles = [];
                this.extractedResults = [];
                this.updateFilesDisplay();
                this.hidePreview();
                this.showToast('Files cleared', 'All files have been removed.', 'success');
            } else {
                throw new Error('Failed to clear session');
            }
        } catch (error) {
            this.showToast('Clear failed', error.message, 'error');
        }
    }

    async deleteFile(fileId) {
        try {
            await this.deleteFileFromServer(fileId);
            this.uploadedFiles = this.uploadedFiles.filter(file => file.id !== fileId);
            this.selectedFiles = this.selectedFiles.filter(id => id !== fileId);
            this.extractedResults = this.extractedResults.filter(result => result.fileId !== fileId);
            this.updateFilesDisplay();
            this.updatePreviewOptions();
            this.showToast('File deleted', 'File has been removed successfully.', 'success');
        } catch (error) {
            this.showToast('Delete failed', error.message, 'error');
        }
    }

    async deleteFileFromServer(fileId) {
        const response = await fetch(`/delete/${fileId}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            throw new Error('Failed to delete file from server');
        }
    }

    // Data Extraction
    async extractData() {
        if (this.selectedFiles.length === 0) {
            this.showToast('No files selected', 'Please select files to extract data from.', 'warning');
            return;
        }

        try {
            this.showLoading(true);
            const response = await fetch('/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    file_ids: this.selectedFiles
                })
            });

            if (!response.ok) {
                throw new Error('Extraction failed');
            }

            const result = await response.json();
            this.extractedResults = result.results;
            
            this.updatePreviewOptions();
            this.showPreview();
            this.showToast('Extraction complete', `Successfully extracted data from ${result.results.length} files.`, 'success');

        } catch (error) {
            this.showToast('Extraction failed', error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    // Preview Management
    updatePreviewOptions() {
        if (this.extractedResults.length === 0) {
            this.hidePreview();
            return;
        }

        this.fileSelect.innerHTML = '';
        this.extractedResults.forEach((result, index) => {
            const option = document.createElement('option');
            option.value = index;
            // Use original filename for display
            const displayName = result.filename || `File ${index + 1}`;
            option.textContent = displayName.replace(/^[a-f0-9]{32}_/, ''); // Remove any remaining UUID prefix
            this.fileSelect.appendChild(option);
        });

        this.showPreview();
        
        if (this.extractedResults.length > 0) {
            setTimeout(() => {
                this.handleFilePreview(0);
            }, 200);
        }
    }

    showPreview() {
        this.fileSelector.style.display = 'block';
        this.previewSection.style.display = 'block';
        this.downloadSection.style.display = 'block';
    }

    hidePreview() {
        this.fileSelector.style.display = 'none';
        this.previewSection.style.display = 'none';
        this.downloadSection.style.display = 'none';
    }

    async handleFilePreview(index) {
        const result = this.extractedResults[index];
        if (!result) return;

        // Update JSON display
        this.displayJson(result.response);

        // Load PDF preview - use the fileId from the result
        await this.loadPdfPreview(result.fileId);
    }

    displayJson(data) {
        const jsonPlaceholder = this.jsonContent.parentElement.querySelector('.json-placeholder');
        if (jsonPlaceholder) {
            jsonPlaceholder.style.display = 'none';
        }
        this.jsonContent.textContent = JSON.stringify(data, null, 2);
    }

    async loadPdfPreview(fileId) {
        // Always use the fileId directly for the preview URL
        const pdfUrl = `/preview/${fileId}`;

        this.pdfLoading.style.display = 'block';
        this.pdfError.style.display = 'none';
        this.pdfCanvas.style.display = 'none';

        try {
            // Check if PDF.js is loaded
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF.js library not loaded');
            }

            const loadingTask = pdfjsLib.getDocument(pdfUrl);
            const pdf = await loadingTask.promise;
            
            // Get first page
            const page = await pdf.getPage(1);
            
            // Set up canvas
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = this.pdfCanvas;
            const context = canvas.getContext('2d');
            
            // Calculate scale to fit container
            const container = canvas.parentElement;
            const containerWidth = container.clientWidth - 32; // Account for padding
            const scale = Math.min(containerWidth / viewport.width, 1.0); // Don't scale up
            
            const scaledViewport = page.getViewport({ scale });
            canvas.height = scaledViewport.height;
            canvas.width = scaledViewport.width;
            
            // Clear canvas first
            context.clearRect(0, 0, canvas.width, canvas.height);
            
            // Render page
            await page.render({
                canvasContext: context,
                viewport: scaledViewport
            }).promise;
            
            this.pdfCanvas.style.display = 'block';
            
        } catch (error) {
            console.error('Error loading PDF:', error);
            this.pdfError.style.display = 'block';
            this.pdfError.textContent = `Error loading PDF: ${error.message}`;
        } finally {
            this.pdfLoading.style.display = 'none';
        }
    }

    // Preview uploaded file before extraction
    async previewUploadedFile(fileId) {
        // Show preview section if hidden
        this.fileSelector.style.display = 'none'; // Hide file selector for single file preview
        this.previewSection.style.display = 'block';
        this.downloadSection.style.display = 'none'; // Hide download until extraction is done
        
        // Clear JSON viewer
        const jsonPlaceholder = this.jsonContent.parentElement.querySelector('.json-placeholder');
        if (jsonPlaceholder) {
            jsonPlaceholder.style.display = 'block';
        }
        this.jsonContent.textContent = '';
        
        // Load PDF preview
        await this.loadPdfPreview(fileId);
    }

    // Download Results
    downloadResults() {
        if (this.extractedResults.length === 0) {
            this.showToast('No data to download', 'Please extract data first.', 'warning');
            return;
        }

        const combinedResults = {};
        this.extractedResults.forEach(result => {
            combinedResults[result.filename || 'Unknown'] = result.response;
        });

        const dataStr = JSON.stringify(combinedResults, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = 'w9_extracted_results.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showToast('Download started', 'Your results file is being downloaded.', 'success');
    }

    // Utility Methods
    showLoading(show) {
        this.loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    showToast(title, message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        `;

        this.toastContainer.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 5000);

        // Remove on click
        toast.addEventListener('click', () => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        });
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.w9Extractor = new W9Extractor();
});

// Handle window resize for PDF canvas
window.addEventListener('resize', () => {
    if (window.w9Extractor && window.w9Extractor.extractedResults.length > 0) {
        const currentIndex = window.w9Extractor.fileSelect.value;
        if (currentIndex !== '') {
            setTimeout(() => {
                window.w9Extractor.handleFilePreview(parseInt(currentIndex));
            }, 100);
        }
    }
});