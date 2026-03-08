from flask import Flask, render_template, request, jsonify, Response
import numpy as np
import joblib
import os
import requests

app = Flask(__name__)
# Enable SocketIO for real-time signaling if needed, but not for WebRTC anymore
# socketio = SocketIO(app, cors_allowed_origins="*") # Not used for signaling anymore

# Load trained files
try:
    model = joblib.load("gesture_model.pkl")
    le = joblib.load("label_encoder.pkl")
    scaler = joblib.load("scaler.pkl")
except Exception as e:
    print(f"Error loading models. Run train.py first: {e}")
    model, le, scaler = None, None, None


# ==============================
# Feature Engineering (must match train.py exactly)
# ==============================
def normalize_landmarks(raw_row):
    """Wrist-relative + scale-normalized features."""
    row = np.array(raw_row, dtype=np.float64)
    result = np.zeros_like(row)
    for hand_idx in range(2):
        start = hand_idx * 63
        end = start + 63
        hand = row[start:end].copy()
        if np.all(hand == 0):
            result[start:end] = 0
            continue
        wrist_x, wrist_y, wrist_z = hand[0], hand[1], hand[2]
        for i in range(21):
            idx = i * 3
            hand[idx]     -= wrist_x
            hand[idx + 1] -= wrist_y
            hand[idx + 2] -= wrist_z
        max_dist = 0
        for i in range(21):
            idx = i * 3
            dist = np.sqrt(hand[idx]**2 + hand[idx+1]**2 + hand[idx+2]**2)
            if dist > max_dist:
                max_dist = dist
        if max_dist > 0:
            hand = hand / max_dist
        result[start:end] = hand
    return result


@app.route('/')
def home():
    return render_template("index.html")


@app.route('/collect')
def collect():
    return render_template("collect.html")


@app.route('/download_csv')
def download_csv():
    from flask import send_file
    return send_file("gesture_data.csv", as_attachment=True, download_name="gesture_data.csv")


@app.route('/save_sample', methods=['POST'])
def save_sample():
    """Save a single landmark sample (126 floats + label) to gesture_data.csv"""
    import csv
    data = request.json
    landmarks = data.get("landmarks", [])
    label = data.get("label", "").strip().upper()
    
    if not label or len(landmarks) != 126:
        return jsonify({"error": "Invalid data"}), 400
    
    row = landmarks + [label]
    with open("gesture_data.csv", "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(row)
    
    return jsonify({"status": "saved", "label": label})


@app.route('/predict', methods=['POST'])
def predict():
    if model is None:
        return jsonify({"prediction": "Model Error", "confidence": 0.0})

    data = request.json["landmarks"]
    
    # Apply the same normalization used during training
    normalized = normalize_landmarks(data)
    input_data = np.array(normalized).reshape(1, -1)

    # Scale input
    input_data = scaler.transform(input_data)

    # Get probabilities
    probabilities = model.predict_proba(input_data)[0]

    confidence = np.max(probabilities)
    predicted_index = np.argmax(probabilities)
    predicted_label = le.inverse_transform([predicted_index])[0]

    # Confidence threshold
    if confidence < 0.40:
        return jsonify({
            "prediction": "Uncertain",
            "confidence": float(confidence)
        })

    return jsonify({
        "prediction": predicted_label,
        "confidence": float(confidence)
    })

@app.route('/speak', methods=['POST'])
def speak():
    data = request.json
    text = data.get("text", "")
    voice_id = data.get("voice_id", "21m00Tcm4TlvDq8ikWAM") # Default voice: Rachel
    
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        return jsonify({"error": "Missing ELEVENLABS_API_KEY environment variable"}), 400
        
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75
        }
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, stream=True)
        if response.status_code != 200:
            return jsonify({"error": "ElevenLabs API Error", "details": response.text}), response.status_code
            
        def generate():
            for chunk in response.iter_content(chunk_size=1024):
                if chunk:
                    yield chunk
                    
        return Response(generate(), mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_PORT", 5001))
    app.run(host="0.0.0.0", port=port)

