// ========== SERVER.JS - Backend Serverside Complet ==========
// Pour Railway.app, Render.com, ou VPS personnel

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ========== CONFIGURATION ==========
const SECRET_KEY = process.env.SECRET_KEY || "ChangeThisSecretKey123";
const PORT = process.env.PORT || 3000;

// ========== BASE DE DONNÉES EN MÉMOIRE ==========
let commandQueue = [];
let executionLogs = [];
let gameServers = new Map(); // Supporte plusieurs serveurs de jeu

// Structure: gameServers.set(serverId, { status, lastPing, players, jobId })

// ========== UTILITAIRES ==========

function addLog(message, type = 'info') {
    const log = {
        timestamp: new Date().toISOString(),
        type: type,
        message: message
    };
    executionLogs.push(log);
    
    // Garde seulement les 100 derniers logs
    if (executionLogs.length > 100) {
        executionLogs.shift();
    }
    
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function cleanOldCommands() {
    const now = Date.now();
    const oldLength = commandQueue.length;
    
    commandQueue = commandQueue.filter(cmd => {
        return (now - cmd.timestamp) < 120000; // 2 minutes max
    });
    
    if (commandQueue.length !== oldLength) {
        addLog(`Nettoyé ${oldLength - commandQueue.length} commandes expirées`, 'system');
    }
}

// ========== ENDPOINTS POUR ROBLOX ==========

// Roblox récupère les commandes
app.get('/api/roblox/poll', (req, res) => {
    const key = req.query.key;
    const serverId = req.query.serverId || 'default';
    const jobId = req.query.jobId;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Met à jour le statut du serveur
    gameServers.set(serverId, {
        status: 'online',
        lastPing: Date.now(),
        jobId: jobId,
        players: []
    });
    
    // Récupère la prochaine commande pour ce serveur
    const commandIndex = commandQueue.findIndex(cmd => 
        !cmd.serverId || cmd.serverId === serverId
    );
    
    if (commandIndex !== -1) {
        const command = commandQueue.splice(commandIndex, 1)[0];
        addLog(`Commande "${command.command}" envoyée au serveur ${serverId}`, 'command');
        
        return res.json({
            hasCommand: true,
            command: command.command,
            args: command.args || [],
            commandId: command.id
        });
    }
    
    res.json({ hasCommand: false });
});

// Roblox envoie les résultats
app.post('/api/roblox/result', (req, res) => {
    const { key, serverId, commandId, result, success, players } = req.body;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const server = gameServers.get(serverId || 'default');
    if (server) {
        server.players = players || [];
    }
    
    addLog(`Résultat (${commandId}): ${result}`, success ? 'success' : 'error');
    
    res.json({ success: true });
});

// Heartbeat du serveur Roblox
app.post('/api/roblox/heartbeat', (req, res) => {
    const { key, serverId, jobId, players, uptime } = req.body;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    gameServers.set(serverId || 'default', {
        status: 'online',
        lastPing: Date.now(),
        jobId: jobId,
        players: players || [],
        uptime: uptime
    });
    
    res.json({ success: true });
});

// ========== ENDPOINTS POUR LE PANEL WEB ==========

// Authentification
app.post('/api/auth', (req, res) => {
    const { key } = req.body;
    
    if (key === SECRET_KEY) {
        res.json({ 
            authenticated: true,
            message: 'Authentification réussie' 
        });
    } else {
        res.status(401).json({ 
            authenticated: false,
            message: 'Clé invalide' 
        });
    }
});

// Envoyer une commande
app.post('/api/command/send', (req, res) => {
    const { key, command, args, serverId } = req.body;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (!command) {
        return res.status(400).json({ error: 'Command required' });
    }
    
    const commandId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    const cmd = {
        id: commandId,
        command: command,
        args: args || [],
        serverId: serverId || null,
        timestamp: Date.now()
    };
    
    commandQueue.push(cmd);
    addLog(`Nouvelle commande ajoutée: ${command} ${(args || []).join(' ')}`, 'command');
    
    res.json({ 
        success: true,
        commandId: commandId,
        message: `Commande "${command}" en attente`,
        queuePosition: commandQueue.length
    });
});

// Récupérer le statut
app.get('/api/status', (req, res) => {
    const key = req.query.key;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const now = Date.now();
    const servers = [];
    
    gameServers.forEach((server, serverId) => {
        const isOnline = (now - server.lastPing) < 10000;
        servers.push({
            id: serverId,
            online: isOnline,
            lastPing: server.lastPing,
            jobId: server.jobId,
            players: server.players,
            uptime: server.uptime
        });
    });
    
    res.json({
        servers: servers,
        queueLength: commandQueue.length,
        totalLogs: executionLogs.length,
        uptime: process.uptime()
    });
});

// Récupérer les logs
app.get('/api/logs', (req, res) => {
    const key = req.query.key;
    const limit = parseInt(req.query.limit) || 50;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json({
        logs: executionLogs.slice(-limit)
    });
});

// Vider la queue
app.post('/api/queue/clear', (req, res) => {
    const { key } = req.body;
    
    if (key !== SECRET_KEY) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const cleared = commandQueue.length;
    commandQueue = [];
    addLog(`Queue vidée (${cleared} commandes supprimées)`, 'system');
    
    res.json({ 
        success: true,
        cleared: cleared
    });
});

// ========== PAGE D'ACCUEIL ==========
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🔥 Serverside Backend</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Courier New', monospace;
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            color: #00ff00;
            min-height: 100vh;
            padding: 40px 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.7);
            padding: 30px;
            border-radius: 10px;
            border: 2px solid #00ff00;
            box-shadow: 0 0 30px rgba(0, 255, 0, 0.3);
        }
        h1 { 
            text-align: center;
            font-size: 36px;
            margin-bottom: 10px;
            text-shadow: 0 0 10px #00ff00;
        }
        .subtitle {
            text-align: center;
            color: #ffff00;
            margin-bottom: 30px;
        }
        .section {
            margin: 20px 0;
            padding: 15px;
            background: rgba(0, 255, 0, 0.05);
            border-left: 3px solid #00ff00;
        }
        .section h2 {
            color: #ffff00;
            margin-bottom: 10px;
        }
        .endpoint {
            margin: 10px 0;
            padding: 8px;
            background: rgba(0, 0, 0, 0.5);
            border-radius: 5px;
        }
        .method {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-weight: bold;
            margin-right: 10px;
        }
        .get { background: #61affe; color: #fff; }
        .post { background: #49cc90; color: #fff; }
        .warning {
            background: rgba(255, 255, 0, 0.1);
            border: 2px solid #ffff00;
            padding: 15px;
            margin: 20px 0;
            border-radius: 5px;
        }
        .status {
            display: inline-block;
            padding: 5px 15px;
            background: #00ff00;
            color: #000;
            border-radius: 20px;
            font-weight: bold;
        }
        code {
            background: rgba(255, 255, 255, 0.1);
            padding: 2px 6px;
            border-radius: 3px;
            color: #ff6b6b;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔥 SERVERSIDE BACKEND</h1>
        <p class="subtitle">Système de contrôle à distance pour Roblox</p>
        
        <div class="section">
            <h2>📊 Statut</h2>
            <p><span class="status">✅ OPÉRATIONNEL</span></p>
            <p>Uptime: <span id="uptime">${Math.floor(process.uptime())}s</span></p>
            <p>Secret Key: <code>${SECRET_KEY.substring(0, 4)}***</code></p>
        </div>

        <div class="warning">
            <strong>⚠️ SÉCURITÉ:</strong> Change la variable d'environnement <code>SECRET_KEY</code> avant de mettre en production !
        </div>

        <div class="section">
            <h2>🎮 Endpoints Roblox</h2>
            <div class="endpoint">
                <span class="method get">GET</span>
                <code>/api/roblox/poll?key=YOUR_KEY&serverId=xxx&jobId=xxx</code>
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/roblox/result</code>
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/roblox/heartbeat</code>
            </div>
        </div>

        <div class="section">
            <h2>🌐 Endpoints Panel Web</h2>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/auth</code>
            </div>
            <div class="endpoint">
                <span class="method post">POST</span>
                <code>/api/command/send</code>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <code>/api/status?key=YOUR_KEY</code>
            </div>
            <div class="endpoint">
                <span class="method get">GET</span>
                <code>/api/logs?key=YOUR_KEY</code>
            </div>
        </div>

        <div class="section">
            <h2>📝 Notes</h2>
            <ul style="margin-left: 20px; line-height: 1.8;">
                <li>Supporte plusieurs serveurs Roblox simultanément</li>
                <li>Queue de commandes avec expiration automatique (2 min)</li>
                <li>Logs en temps réel (100 dernières entrées)</li>
                <li>Heartbeat pour vérifier la connexion des serveurs</li>
            </ul>
        </div>
    </div>
</body>
</html>
    `);
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// ========== TÂCHES AUTOMATIQUES ==========

// Nettoyage toutes les minutes
setInterval(() => {
    cleanOldCommands();
    
    // Nettoie les serveurs offline depuis plus de 30 secondes
    const now = Date.now();
    gameServers.forEach((server, serverId) => {
        if (now - server.lastPing > 30000) {
            gameServers.delete(serverId);
            addLog(`Serveur ${serverId} déconnecté (timeout)`, 'system');
        }
    });
}, 60000);

// ========== DÉMARRAGE DU SERVEUR ==========
app.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║   🔥 SERVERSIDE BACKEND STARTED 🔥   ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🔑 Secret Key: ${SECRET_KEY}`);
    console.log(`📡 Endpoints actifs`);
    console.log(`⏰ Auto-cleanup activé`);
    console.log('');
    addLog('Backend démarré avec succès', 'system');
});
