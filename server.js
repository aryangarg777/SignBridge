const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// Replace url_for in relative links if needed, but since we serve static directly:
// We need to handle the templates slightly or just move them.
// For simplicity, we'll serve index.html from /templates but fix paths.

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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Node.js Signaling Server running on http://localhost:${PORT}`);
    console.log(`Proxying AI requests to Python server on port 5001`);
});
