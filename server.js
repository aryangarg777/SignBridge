const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const path = require('path');
const { auth, requiresAuth } = require('express-openid-connect');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const configAuth = {
    authRequired: false,
    auth0Logout: true,
    secret: process.env.AUTH0_SECRET || 'a_long_random_string_at_least_32_characters_long',
    baseURL: process.env.AUTH0_BASE_URL || 'http://localhost:3000',
    clientID: process.env.AUTH0_CLIENT_ID,
    issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL
};

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(configAuth));

// Native fetch proxy for Python Predictions
app.use(express.json());
app.post('/predict', async (req, res) => {
    try {
        const response = await fetch('http://127.0.0.1:5001/predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error('AI API Error:', err);
        res.status(502).json({ prediction: "Server Error", confidence: 0.0 });
    }
});

// Static Files
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
    // Nuclear option: clear all caches/service workers via HTTP header
    res.set('Clear-Site-Data', '"cache", "storage"');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/app', requiresAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

app.get('/collect', requiresAuth(), (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'collect.html'));
});

// User Endpoint
app.get('/user', (req, res) => {
    res.json(req.oidc.isAuthenticated() ? req.oidc.user : null);
});

// Proxy /save_sample to Flask
app.post('/save_sample', async (req, res) => {
    try {
        const response = await fetch('http://127.0.0.1:5001/save_sample', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        console.error('Save sample error:', err);
        res.status(502).json({ error: "Server Error" });
    }
});

// Proxy /download_csv to Flask
app.get('/download_csv', async (req, res) => {
    try {
        const response = await fetch('http://127.0.0.1:5001/download_csv');
        res.set('Content-Type', response.headers.get('content-type'));
        res.set('Content-Disposition', 'attachment; filename="gesture_data.csv"');
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('Download CSV error:', err);
        res.status(502).send('Could not download CSV. Make sure training data exists.');
    }
});

// Proxy /speak to Flask for ElevenLabs
app.post('/speak', async (req, res) => {
    try {
        const response = await fetch('http://127.0.0.1:5001/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            return res.status(response.status).json(data);
        }

        res.set('Content-Type', 'audio/mpeg');
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error('Speak proxy error:', err);
        res.status(502).json({ error: "Server Error" });
    }
});

// Signaling
const rooms = {};

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        const room = data.room;
        socket.join(room);

        if (!rooms[room]) rooms[room] = [];
        rooms[room].push(socket.id);

        socket.emit('role', { initiator: rooms[room].length === 1 });

        if (rooms[room].length === 2) {
            io.to(rooms[room][0]).emit('peer_joined');
        }
    });

    socket.on('signal', (data) => {
        if (data.room) {
            socket.to(data.room).emit('signal', data);
        }
    });

    socket.on('disconnect', () => {
        for (const room in rooms) {
            rooms[room] = rooms[room].filter(id => id !== socket.id);
            if (rooms[room].length === 0) delete rooms[room];
        }
    });
});

// React Router Catch-All (must be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Node.js Signaling Server running on http://localhost:${PORT}`);
    console.log(`Proxying AI requests to Python server on port 5001`);
});
