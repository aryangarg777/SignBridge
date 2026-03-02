// ===============================
// GLOBAL VARIABLES
// ===============================

let dataset = [];
let collecting = false;
let currentLabel = "";

let sentence = "";
let lastWord = "";

let localStream;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");

canvasElement.width = 640;
canvasElement.height = 480;


// ===============================
// START CAMERA + MEDIAPIPE
// ===============================

async function startVideo() {

    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    localVideo.srcObject = localStream;

    const hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });

    hands.onResults(onResults);

    const camera = new Camera(localVideo, {
        onFrame: async () => {
            await hands.send({ image: localVideo });
        },
        width: 640,
        height: 480
    });

    camera.start();
}

startVideo();


// ===============================
// COLLECTION CONTROLS
// ===============================

function startCollect() {

    const labelInput = document.getElementById("labelInput");

    if (!labelInput.value) {
        alert("Enter a label first!");
        return;
    }

    currentLabel = labelInput.value;
    collecting = true;

    document.getElementById("status").innerText =
        "Collecting for: " + currentLabel;
}

function stopCollect() {
    collecting = false;
    document.getElementById("status").innerText = "Stopped";
}


// ===============================
// MEDIAPIPE RESULTS
// ===============================

function onResults(results) {

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(results.image, 0, 0, 640, 480);

    let frameData = [];

    if (results.multiHandLandmarks &&
        results.multiHandLandmarks.length > 0) {

        const sortedHands = results.multiHandLandmarks.sort(
            (a, b) => a[0].x - b[0].x
        );

        for (const landmarks of sortedHands) {

            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS);
            drawLandmarks(canvasCtx, landmarks);

            for (let i = 0; i < landmarks.length; i++) {
                frameData.push(landmarks[i].x);
                frameData.push(landmarks[i].y);
                frameData.push(landmarks[i].z);
            }
        }
    }

    // Force 126 features (2 hands max)
    while (frameData.length < 126) {
        frameData.push(0);
    }

    // ===============================
    // DATA COLLECTION
    // ===============================

    if (collecting && frameData.length === 126) {
        dataset.push([...frameData, currentLabel]);
    }

    // ===============================
    // PREDICTION
    // ===============================

    if (!collecting && frameData.length === 126) {

        fetch("/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ landmarks: frameData })
        })
        .then(res => res.json())
        .then(data => {

            const predictionBox =
                document.getElementById("predictionText");

            if (data.prediction === "Uncertain") {
                predictionBox.innerText = "Prediction: Uncertain";
                document.getElementById("subtitleOverlay").innerText =
                    "Waiting...";
                return;
            }

            const currentWord = data.prediction;

            predictionBox.innerText =
                `Prediction: ${currentWord} (${(data.confidence * 100).toFixed(1)}%)`;

            document.getElementById("subtitleOverlay").innerText =
                currentWord;

            // Add word only if changed
            if (currentWord !== lastWord) {
                sentence += currentWord + " ";
                lastWord = currentWord;
                document.getElementById("sentenceBox").innerText =
                    sentence;
            }

            document.getElementById("confidenceBar").style.width =
    (data.confidence * 100) + "%";

const historyBox = document.getElementById("historyBox");
const chip = document.createElement("span");
chip.innerText = currentWord;
historyBox.prepend(chip);

if (historyBox.children.length > 10) {
    historyBox.removeChild(historyBox.lastChild);
}

        })
        .catch(err => console.error("Prediction error:", err));
    }

    canvasCtx.restore();
}


// ===============================
// CLEAR + SPEAK
// ===============================

function clearSentence() {
    sentence = "";
    lastWord = "";
    document.getElementById("sentenceBox").innerText = "";
}

function speakSentence() {
    if (!sentence) return;

    const utterance =
        new SpeechSynthesisUtterance(sentence);

    utterance.rate = 0.9;
    speechSynthesis.speak(utterance);
}


// ===============================
// DOWNLOAD DATASET
// ===============================

function downloadCSV() {

    if (dataset.length === 0) {
        alert("No data collected!");
        return;
    }

    let csvContent =
        dataset.map(row => row.join(",")).join("\n");

    const blob =
        new Blob([csvContent], { type: "text/csv" });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "gesture_data.csv";
    a.click();

    URL.revokeObjectURL(url);
}


// ===============================
// SPEECH RECOGNITION
// ===============================

function startSpeech() {

    const recognition =
        new (window.SpeechRecognition ||
             window.webkitSpeechRecognition)();

    recognition.lang = "en-US";
    recognition.start();

    recognition.onresult = function(event) {
        const transcript =
            event.results[0][0].transcript;

        document.getElementById("speechText").innerText =
            "Speech: " + transcript;
    };
}

// ===============================
// SIMPLE LOCAL WEBRTC (2 TAB DEMO)
// ===============================

let peerConnection;
let socket;

const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function joinRoom() {

    const room = document.getElementById("roomInput").value;

    if (!room) {
        alert("Enter Room ID");
        return;
    }

    socket = new WebSocket("ws://localhost:3000");

    socket.onopen = () => {
        socket.send(JSON.stringify({ type: "join", room }));
    };

    socket.onmessage = async (event) => {

        const message = JSON.parse(event.data);

        if (message.type === "role") {

            await createPeer();

            if (message.initiator) {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);

                socket.send(JSON.stringify({
                    type: "offer",
                    offer
                }));
            }
        }

        if (message.type === "offer") {

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.offer)
            );

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            socket.send(JSON.stringify({
                type: "answer",
                answer
            }));
        }

        if (message.type === "answer") {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(message.answer)
            );
        }

        if (message.type === "candidate") {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(message.candidate)
            );
        }
    };
}

async function createPeer() {

    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: "candidate",
                candidate: event.candidate
            }));
        }
    };
}