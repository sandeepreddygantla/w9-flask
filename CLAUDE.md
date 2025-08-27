# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Application Overview

This is a Flask-based W9 tax form data extraction service that uses Azure Document Intelligence and Azure OpenAI GPT-4 to extract structured data from PDF W9 forms. The application provides a modern web interface for uploading PDF files, processing them through AI services, and downloading the extracted data as JSON.

## Key Architecture Components

### Backend (Flask)
- **Main application**: `app.py` - Flask server with CORS support
- **AI Integration**: Uses Azure Document Intelligence for OCR and AzureChatOpenAI (GPT-4) for data extraction
- **Data validation**: Pydantic models with fuzzy key matching for W9 form fields
- **File handling**: Secure file upload with UUID prefixes, 16MB limit, PDF-only validation

### Frontend (SPA-style)
- **Template**: `templates/index.html` - Single page application
- **JavaScript**: `static/js/script.js` - Class-based W9Extractor with PDF.js integration
- **Styling**: `static/css/styles.css` - Modern CSS with custom properties

### Key Data Flow
1. PDF upload → secure storage in `uploads/` directory
2. Azure Document Intelligence → text + checkbox extraction
3. GPT-4 prompt engineering → structured JSON extraction  
4. Pydantic validation with fuzzy key matching → normalized W9Data model
5. Frontend preview with PDF.js rendering and JSON display

## Environment Setup

Create `.env` file with required Azure credentials:
```
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_PROJECT_ID=
tenant_id=
client_id=
client_secret=
endpoint=
```

## Common Development Commands

### Installation
```bash
pip install -r requirements.txt
```

### Running the Application
```bash
python app.py
```
The application runs on `http://0.0.0.0:5000` with debug mode enabled.

### Virtual Environment
The codebase includes a `venv/` directory. Activate with:
```bash
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
```

## Important Implementation Details

### W9Data Model
The `W9Data` Pydantic model includes fuzzy key matching (`normalize_keys`) that uses `difflib.get_close_matches` with 70% similarity threshold to handle variations in field names from AI extraction.

### Security Considerations
- Files are stored with UUID prefixes to prevent conflicts
- `secure_filename()` used for all uploads
- File type validation limited to PDF only
- 16MB file size limit enforced

### AI Prompt Engineering
The extraction prompt in `extract_data_from_w9_documents()` is specifically tuned for W9 forms and requires exact JSON key matching. The system processes both OCR text and checkbox states from Azure Document Intelligence.

### TikToken Cache
The application uses a local tiktoken cache directory (`tiktoken_cache/`) for tokenization optimization with Azure OpenAI.