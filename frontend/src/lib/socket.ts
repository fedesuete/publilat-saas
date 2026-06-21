import { io, Socket } from "socket.io-client";
import { API_BASE, TOKEN_KEY } from "./config";
import type { Msg, Stage } from "./types";

export interface WaQrPayload {
  lineId: string;
  qr: string;
}

export interface WaStatusPayload {
  lineId: string;
  state: string;
  connected: boolean;
}

export interface InboxMessagePayload {
  contactId: string;
  message: Msg;
  stage?: Stage;
}

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem(TOKEN_KEY);
    socket = io(API_BASE, {
      auth: { token },
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
