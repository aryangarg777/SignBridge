from flask import Flask, render_template, request, jsonify
import numpy as np
import joblib
from flask_socketio import SocketIO, join_room, leave_room, send, emit
import os

app = Flask(__name__)
# Enable SocketIO for real-time signaling
socketio = SocketIO(app, cors_allowed_origins="*")

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

# ===============================
# WebRTC Signaling via SocketIO
# ===============================

rooms = {}

@socketio.on('join_room')
def on_join(data):
    room = data['room']
    join_room(room)
    
    if room not in rooms:
        rooms[room] = []
    
    sid = request.sid
    rooms[room].append(sid)
    
    print(f"User {sid} joined room {room}")

    # Give role to connecting user
    emit('role', {'initiator': len(rooms[room]) == 1}, to=sid)

    # If a second person joins, tell the first person to start offering
    if len(rooms[room]) == 2:
        first_user = rooms[room][0]
        emit('peer_joined', {}, to=first_user)

@socketio.on('signal')
def on_signal(data):
    # Broadcast signaling data (offer, answer, candidate) to others in the room
    room = data.get('room')
    if room:
        emit('signal', data, room=room, include_self=False)

@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    for room, users in rooms.items():
        if sid in users:
            users.remove(sid)
            print(f"User {sid} left room {room}")
            if len(users) == 0:
                del rooms[room]
            break

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    # Note: For production use gunicorn + eventlet (Waitress for windows)
    socketio.run(app, host="0.0.0.0", port=port, debug=False)

