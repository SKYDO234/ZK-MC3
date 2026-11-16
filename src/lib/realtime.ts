import { io, Socket } from "socket.io-client";
import { getToken } from "./api";

let socket: Socket | null = null;

export const getSocket = (): Socket => {
  if (!socket) {
    socket = io("/", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      auth: { token: getToken() },
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1500,
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
