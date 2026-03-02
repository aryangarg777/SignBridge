from flask import Flask, render_template, request, jsonify
import numpy as np
import joblib

app = Flask(__name__)

# Load trained files
model = joblib.load("gesture_model.pkl")
le = joblib.load("label_encoder.pkl")
scaler = joblib.load("scaler.pkl")


@app.route('/')
def home():
    return render_template("index.html")


@app.route('/predict', methods=['POST'])
def predict():

    data = request.json["landmarks"]

    input_data = np.array(data).reshape(1, -1)

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


if __name__ == "__main__":
    app.run(debug=True)