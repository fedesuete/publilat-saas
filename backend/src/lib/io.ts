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
