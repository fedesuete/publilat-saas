// Holder del servidor Socket.IO para poder emitir desde cualquier ruta/servicio.
// Cada usuario se une a la sala `user:<id>`; emitimos QR, estado de línea e Inbox ahí.
import type { Server as SocketServer } from "socket.io";

let io: SocketServer | null = null;

export function setIo(server: SocketServer) {
  io = server;
}

export function getIo(): SocketServer | null {
  return io;
}

// Emite un evento a todas las conexiones de un usuario.
export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

// Emite en el namespace AISLADO del Chat App ("/chat"). `room` es una de:
//   chat:{userId} · chat:{userId}:op:{operatorId} · chat:{userId}:player:{playerId} · chat:conv:{id}
export function emitChat(room: string, event: string, payload: unknown) {
  io?.of("/chat").to(room).emit(event, payload);
}

// ¿El jugador tiene alguna conexión viva en el namespace /chat? Si no, el mensaje del
// operador debe ir por Web Push (Fase 5) en vez de solo por socket.
export async function playerHasLiveSocket(userId: string, playerId: string): Promise<boolean> {
  const ns = io?.of("/chat");
  if (!ns) return false;
  try {
    const sockets = await ns.in(`chat:${userId}:player:${playerId}`).fetchSockets();
    return sockets.length > 0;
  } catch {
    return false;
  }
}
