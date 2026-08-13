/**
 * Shared Socket.io singleton.
 * Both Scoreboard and AdminPanel import this same instance
 * so only ONE connection is ever made, and events are never missed.
 *
 * URL is read from the VITE_WS_URL environment variable so it works
 * in both development (localhost:5000) and production (your server).
 */
import { io } from "socket.io-client";

const WS_URL = import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_URL || window.location.origin;

export const socket = io(WS_URL, {
  reconnectionDelay      : 1000,
  reconnectionAttempts   : Infinity,
  transports             : ["websocket", "polling"],
});
