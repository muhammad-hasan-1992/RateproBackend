// utils/socket.js
/**
 * Socket.IO Setup Module
 * 
 * Provides real-time notification delivery.
 * 
 * SETUP REQUIRED:
 * 1. npm install socket.io
 * 2. Import and call initializeSocket(server) in server.js
 */

let io = null;

/**
 * Initialize Socket.IO with HTTP server
 * @param {Object} server - HTTP server instance
 */
function initializeSocket(server) {
    const { Server } = require("socket.io");

    io = new Server(server, {
        cors: {
            origin: [
                process.env.PUBLIC_URL_LOCAL || "http://localhost:5173",
                process.env.ADMIN_URL_LOCAL || "http://localhost:5174",
                process.env.PUBLIC_URL_PROD,
                process.env.ADMIN_URL_PROD
            ].filter(Boolean),
            credentials: true
        }
    });

    io.on("connection", (socket) => {
        console.log(`🔌 Socket connected: ${socket.id}`);

        // Join user to their own room for targeted notifications
        socket.on("join", (userId) => {
            if (userId) {
                socket.join(`user:${userId}`);
                console.log(`👤 User ${userId} joined their room`);
            }
        });

        // Join tenant room for broadcast notifications
        socket.on("joinTenant", (tenantId) => {
            if (tenantId) {
                socket.join(`tenant:${tenantId}`);
            }
        });

        socket.on("disconnect", () => {
            console.log(`🔌 Socket disconnected: ${socket.id}`);
        });
    });

    console.log("✅ Socket.IO initialized");
    return io;
}

/**
 * Get Socket.IO instance
 * @returns {Object|null}
 */
function getIO() {
    return io;
}

/**
 * Emit notification to specific user
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 */
function emitToUser(userId, event, data) {
    if (io) {
        io.to(`user:${userId}`).emit(event, data);
    }
}

/**
 * Emit to all users in a tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} event - Event name
 * @param {Object} data - Event data
 */
function emitToTenant(tenantId, event, data) {
    if (io) {
        io.to(`tenant:${tenantId}`).emit(event, data);
    }
}

module.exports = {
    initializeSocket,
    getIO,
    emitToUser,
    emitToTenant
};
