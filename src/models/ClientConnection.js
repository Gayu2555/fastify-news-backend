const ClientConnection = {
  // In-memory store for client connections (can be moved to Redis for production)
  connections: new Map(),

  // Add a new client connection
  addConnection(clientId, connection, fastify) {
    this.connections.set(clientId, connection);
    if (fastify) {
      fastify.log.info(`Client ${clientId} connected via WebSocket`);
    }
    return clientId;
  },

  // Remove a client connection
  removeConnection(clientId, fastify) {
    const removed = this.connections.delete(clientId);
    if (fastify) {
      fastify.log.info(`Client ${clientId} disconnected from WebSocket`);
    }
    return removed;
  },

  // Get a specific client connection
  getConnection(clientId) {
    return this.connections.get(clientId);
  },

  // Get all client connections
  getAllConnections() {
    return Array.from(this.connections.keys());
  },

  // Broadcast a message to all connected clients
  broadcastMessage(message, fastify) {
    let count = 0;
    for (const [clientId, connection] of this.connections.entries()) {
      try {
        connection.socket.send(JSON.stringify(message));
        count++;
      } catch (err) {
        if (fastify) {
          fastify.log.error(
            `Error sending message to client ${clientId}: ${err.message}`
          );
        }
        this.removeConnection(clientId, fastify); // Remove broken connections
      }
    }
    if (fastify) {
      fastify.log.info(`Broadcasted message to ${count} clients`);
    }
    return count;
  },
};

export { ClientConnection };
