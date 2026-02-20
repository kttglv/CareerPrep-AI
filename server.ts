import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("careerprep.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    role TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id TEXT,
    receiver_id TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/users", (req, res) => {
    const users = db.prepare("SELECT * FROM users WHERE last_seen > datetime('now', '-5 minutes')").all();
    res.json(users);
  });

  app.post("/api/users", (req, res) => {
    const { id, name, role } = req.body;
    db.prepare("INSERT OR REPLACE INTO users (id, name, role, last_seen) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run(id, name, role);
    res.json({ status: "ok" });
  });

  app.get("/api/messages/:userId/:otherId", (req, res) => {
    const { userId, otherId } = req.params;
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE (sender_id = ? AND receiver_id = ?) 
      OR (sender_id = ? AND receiver_id = ?)
      ORDER BY timestamp ASC
    `).all(userId, otherId, otherId, userId);
    res.json(messages);
  });

  // WebSocket Handling
  const clients = new Map<string, WebSocket>();

  const broadcastPresence = () => {
    const onlineUsers = db.prepare("SELECT * FROM users WHERE last_seen > datetime('now', '-1 minute')").all();
    const presenceMsg = JSON.stringify({
      type: 'presence',
      users: onlineUsers
    });
    
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(presenceMsg);
      }
    });
  };

  wss.on("connection", (ws) => {
    let userId: string | null = null;

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === "auth") {
        userId = message.userId;
        if (userId) {
          clients.set(userId, ws);
          // Update last seen immediately on auth
          db.prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
          broadcastPresence();
        }
      } else if (message.type === "chat") {
        const { senderId, receiverId, content } = message;
        
        // Save to DB
        db.prepare("INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)").run(senderId, receiverId, content);

        // Send to receiver if online
        const receiverWs = clients.get(receiverId);
        if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
          receiverWs.send(JSON.stringify({
            type: "chat",
            senderId,
            content,
            timestamp: new Date().toISOString()
          }));
        }
      }
    });

    ws.on("close", () => {
      if (userId) {
        clients.delete(userId);
        broadcastPresence();
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
