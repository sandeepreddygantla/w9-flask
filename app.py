import os
import httpx
import json
import difflib
import shutil
import threading
import time
from typing import Optional, Dict, Any
from flask import Flask, request, jsonify, render_template, send_from_directory, session, Blueprint, redirect
from flask_cors import CORS
from werkzeug.utils import secure_filename
import uuid

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, model_validator, field_validator

from langchain_openai import AzureChatOpenAI
from azure.identity import ClientSecretCredential
from azure.ai.documentintelligence import DocumentIntelligenceClient

load_dotenv()

app = Flask(__name__)
CORS(app)

# Create a blueprint with URL prefix
w9_bp = Blueprint('w9', __name__, url_prefix='/w9')

# Configuration
TEMP_UPLOAD_FOLDER = 'temp_uploads'
ALLOWED_EXTENSIONS = {'pdf'}
MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
SESSION_TIMEOUT_HOURS = 1

app.config['TEMP_UPLOAD_FOLDER'] = TEMP_UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['SECRET_KEY'] = os.urandom(24)

# Ensure temp upload directory exists
os.makedirs(TEMP_UPLOAD_FOLDER, exist_ok=True)

# TikToken cache
tiktoken_cache_dir = os.path.abspath("tiktoken_cache")
os.environ["TIKTOKEN_CACHE_DIR"] = tiktoken_cache_dir

if os.path.exists(os.path.join(tiktoken_cache_dir, "9b5ad71b2ce5302211f9c61530b329a4922fc6a4")):
    print("Tokenizer cache found")

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def get_session_folder():
    """Get or create session-specific folder"""
    session_id = session.get('session_id')
    if not session_id:
        session_id = str(uuid.uuid4())
        session['session_id'] = session_id
    
    session_folder = os.path.join(app.config['TEMP_UPLOAD_FOLDER'], f'session_{session_id}')
    os.makedirs(session_folder, exist_ok=True)
    return session_folder

def get_unique_filename(folder, filename):
    """Get unique filename handling duplicates like Streamlit"""
    filepath = os.path.join(folder, filename)
    if not os.path.exists(filepath):
        return filename
    
    name, ext = os.path.splitext(filename)
    counter = 1
    while True:
        new_filename = f"{name}_{counter}{ext}"
        new_filepath = os.path.join(folder, new_filename)
        if not os.path.exists(new_filepath):
            return new_filename
        counter += 1

def cleanup_old_sessions():
    """Clean up sessions older than SESSION_TIMEOUT_HOURS"""
    if not os.path.exists(app.config['TEMP_UPLOAD_FOLDER']):
        return
        
    current_time = time.time()
    timeout_seconds = SESSION_TIMEOUT_HOURS * 3600
    
    try:
        for folder_name in os.listdir(app.config['TEMP_UPLOAD_FOLDER']):
            if folder_name.startswith('session_'):
                folder_path = os.path.join(app.config['TEMP_UPLOAD_FOLDER'], folder_name)
                if os.path.isdir(folder_path):
                    folder_age = current_time - os.path.getctime(folder_path)
                    if folder_age > timeout_seconds:
                        shutil.rmtree(folder_path)
                        print(f"Cleaned up old session: {folder_name}")
    except Exception as e:
        print(f"Error during cleanup: {e}")

def clear_current_session():
    """Clear current session's files"""
    session_id = session.get('session_id')
    if session_id:
        session_folder = os.path.join(app.config['TEMP_UPLOAD_FOLDER'], f'session_{session_id}')
        if os.path.exists(session_folder):
            shutil.rmtree(session_folder)
        # Reset session
        session.pop('session_id', None)

def get_access_token():
    auth = "https://api.uhg.com/oauth2/token"
    scope = "https://api.uhg.com/.default"
    grant_type = "client_credentials"

    client_id_llm = os.getenv("AZURE_CLIENT_ID")
    client_secret_llm = os.getenv("AZURE_CLIENT_SECRET")

    with httpx.Client() as client:
        body = {
            "grant_type": grant_type,
            "scope": scope,
            "client_id": client_id_llm,
            "client_secret": client_secret_llm,
        }
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        response = client.post(auth, headers=headers, data=body, timeout=60)
        response.raise_for_status()
        return response.json()["access_token"]

def get_llm(access_token: str):
    return AzureChatOpenAI(
        azure_deployment="gpt-4.1-2025-04-14",
        model="gpt-4.1",
        api_version="2025-01-01-preview",
        azure_endpoint="https://api.uhg.com/api/cloud/api-management/ai-gateway/1.0",
        openai_api_type="azure_ad",
        validate_base_url=False,
        azure_ad_token=access_token,
        default_headers={
            "projectId": os.getenv("AZURE_PROJECT_ID"),
        },
    )

class W9Data(BaseModel):
    model_config = ConfigDict(extra="allow")

    entity_type: Optional[str] = None
    name: Optional[str] = None
    business_name: Optional[str] = None
    ein: Optional[str] = None
    ssn: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    user_signed: Optional[str] = None
    signed_date: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_keys(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        expected_keys = {
            "entity_type", "name", "business_name", "ein", "ssn",
            "address", "city", "state", "zip_code", "user_signed", "signed_date"
        }
        normalized: Dict[str, Any] = {}
        for key, value in data.items():
            cleaned_key = key.strip().lower().replace("_", " ").replace("-", " ")
            best_match = difflib.get_close_matches(cleaned_key, expected_keys, n=1, cutoff=0.7)
            if best_match:
                normalized[best_match[0]] = value
        return normalized

    @field_validator("user_signed", mode="before")
    @classmethod
    def normalize_user_signed(cls, v):
        if v and str(v).strip().lower() in ("yes", "y", "signed", "true"):
            return "Y"
        return ""

def extract_data_from_w9_documents(file_paths, llm):
    results = []

    tenant_id = os.getenv("tenant_id")
    client_id = os.getenv("client_id")
    client_secret = os.getenv("client_secret")
    endpoint = os.getenv("endpoint")

    credential = ClientSecretCredential(tenant_id, client_id, client_secret)
    client = DocumentIntelligenceClient(endpoint=endpoint, credential=credential)

    for file_path in file_paths:
        try:
            with open(file_path, "rb") as f:
                document = f.read()

            poller = client.begin_analyze_document(
                model_id="prebuilt-layout",
                body=document,
                features=["keyValuePairs"]
            )
            result = poller.result()

            if not result.pages:
                print(f"⚠️ No pages found in: {file_path}")
                continue

            page = result.pages[0]
            extracted_text = "\n".join(line.content for line in page.lines)

            checkbox_info = []
            marks = getattr(page, "selection_marks", []) or []
            lines = getattr(page, "lines", []) or []

            for mark in marks:
                if not getattr(mark, "polygon", None):
                    continue

                x_coords = mark.polygon[::2]
                y_coords = mark.polygon[1::2]
                checkbox_center = (
                    sum(x_coords) / len(x_coords),
                    sum(y_coords) / len(y_coords)
                )

                nearest_text = ""
                min_dist = float("inf")
                for line in lines:
                    if not getattr(line, "polygon", None):
                        continue
                    lx, ly = line.polygon[0], line.polygon[1]
                    dist = ((lx - checkbox_center[0]) ** 2 + (ly - checkbox_center[1]) ** 2) ** 0.5
                    if dist < min_dist:
                        min_dist = dist
                        nearest_text = line.content

                checkbox_info.append({"label": nearest_text, "state": mark.state})

            checkbox_text = "\n".join(
                [f"Checkbox labeled '{box['label']}' is {box['state']}" for box in checkbox_info]
            )

            prompt = f"""
You are an expert assistant that extracts structured data from W9 tax forms.
Return only the result in valid JSON format. Do NOT add any explanation or surrounding text.
Use the exact key names below (spelling and casing matters):

{{
  "entity_type": "",
  "name": "",
  "business_name": "",
  "ein": "",
  "ssn": "",
  "address": "",
  "city": "",
  "state": "",
  "zip_code": "",
  "user_signed": "Y" if signed, "" otherwise,
  "signed_date": ""
}}

Below is the content of the form:
{extracted_text}

Below are the checkbox states:
{checkbox_text}

Only return JSON do not add explanations
"""

            response = llm.invoke([
                {"role": "system", "content": "You are a helpful assistant that extracts W9 tax form data."},
                {"role": "user", "content": prompt}
            ])

            json_start = response.content.find('{')
            json_end = response.content.rfind('}') + 1
            raw_json = json.loads(response.content[json_start:json_end])

            try:
                normalized = W9Data.normalize_keys(raw_json)
                validated_data = W9Data(**normalized)
                json_data = validated_data.model_dump()
            except Exception as e:
                print(f"⚠️ Pydantic validation error: {e}")
                continue

            results.append({
                "file": file_path,
                "fileId": os.path.basename(file_path),
                "response": json_data,
                "filename": os.path.basename(file_path)
            })

        except Exception as e:
            results.append({
                "file": file_path,
                "fileId": os.path.basename(file_path),
                "response": {"error": str(e)},
                "filename": os.path.basename(file_path)
            })

    return results

# Routes with /w9 prefix
@w9_bp.route('/')
def index():
    return render_template('index.html')

@w9_bp.route('/upload', methods=['POST'])
def upload_files():
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400
    
    files = request.files.getlist('files')
    
    # Clear previous session files (like Streamlit behavior)
    clear_current_session()
    
    # Get session folder
    session_folder = get_session_folder()
    uploaded_files = []
    
    for file in files:
        if file.filename == '':
            continue
            
        if file and allowed_file(file.filename):
            original_filename = secure_filename(file.filename)
            # Get unique filename (handle duplicates)
            unique_filename = get_unique_filename(session_folder, original_filename)
            filepath = os.path.join(session_folder, unique_filename)
            file.save(filepath)
            
            # Get file size
            file_size = os.path.getsize(filepath)
            
            uploaded_files.append({
                'id': unique_filename,  # Just the filename, no UUID prefix
                'name': original_filename,  # Original name for display
                'size': file_size,
                'path': filepath,
                'status': 'uploaded'
            })
    
    return jsonify({'files': uploaded_files})

@w9_bp.route('/extract', methods=['POST'])
def extract_data():
    try:
        data = request.json
        file_ids = data.get('file_ids', [])
        
        if not file_ids:
            return jsonify({'error': 'No files selected for extraction'}), 400
        
        # Get session folder
        session_folder = get_session_folder()
        
        file_paths = []
        for file_id in file_ids:
            filepath = os.path.join(session_folder, file_id)
            if os.path.exists(filepath):
                file_paths.append(filepath)
        
        if not file_paths:
            return jsonify({'error': 'No valid files found'}), 400
        
        # Get access token and initialize LLM
        access_token = get_access_token()
        llm = get_llm(access_token)
        
        # Extract data
        results = extract_data_from_w9_documents(file_paths, llm)
        
        return jsonify({'results': results})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@w9_bp.route('/download/<filename>')
def download_file(filename):
    try:
        session_folder = get_session_folder()
        return send_from_directory(session_folder, filename, as_attachment=True)
    except FileNotFoundError:
        return jsonify({'error': 'File not found'}), 404

@w9_bp.route('/preview/<filename>')
def preview_file(filename):
    try:
        session_folder = get_session_folder()
        return send_from_directory(session_folder, filename)
    except FileNotFoundError:
        return jsonify({'error': 'File not found'}), 404

@w9_bp.route('/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    try:
        session_folder = get_session_folder()
        filepath = os.path.join(session_folder, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            return jsonify({'message': 'File deleted successfully'})
        else:
            return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@w9_bp.route('/clear-session', methods=['POST'])
def clear_session_files():
    """Clear all files in current session"""
    try:
        clear_current_session()
        return jsonify({'message': 'Session cleared successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@w9_bp.route('/static/<path:filename>')
def static_files(filename):
    """Serve static files with proper MIME types"""
    response = send_from_directory('static', filename)

    # Set proper MIME types
    if filename.endswith('.css'):
        response.headers['Content-Type'] = 'text/css'
    elif filename.endswith('.js'):
        response.headers['Content-Type'] = 'application/javascript'
    elif filename.endswith('.map'):
        response.headers['Content-Type'] = 'application/json'

    return response

# Register the blueprint
app.register_blueprint(w9_bp)

@app.route('/')
def root():
    """Root redirect to w9 path."""
    return redirect('/w9/')


if __name__ == '__main__':
    # Clean up old sessions on startup
    cleanup_old_sessions()
    
    # Start cleanup thread
    def periodic_cleanup():
        while True:
            time.sleep(3600)  # Run cleanup every hour
            cleanup_old_sessions()
    
    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()
    
    print("W9 Extractor running at: http://localhost:5002/w9")
    app.run(debug=True, host='0.0.0.0', port=5002)