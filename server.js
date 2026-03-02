const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

console.log("WebSocket running on ws://localhost:3000");

let rooms = {};

wss.on('connection', (ws) => {

    ws.on('message', (message) => {

        const data = JSON.parse(message);

        if (data.type === "join") {

            rooms[data.room] = rooms[data.room] || [];
            rooms[data.room].push(ws);

            ws.room = data.room;

            console.log("User joined:", data.room);

            // Tell user if they are initiator
            ws.send(JSON.stringify({
                type: "role",
                initiator: rooms[data.room].length === 1
            }));

            return;
        }

        // Forward other messages
        rooms[ws.room]?.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });

});