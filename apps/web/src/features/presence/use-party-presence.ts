import { useEffect, useRef, useState } from "react";
import usePartySocket from "partysocket/react";
import { serverMessageSchema, type PresenceSnapshot } from "@chainatlas/shared";
import { env } from "@/lib/config/env";
import { useAppStore } from "@/lib/store/app-store";

export function usePartyPresence() {
  const session = useAppStore((state) => state.session);
  const local = useAppStore((state) => state.presence.local);
  const setStatus = useAppStore((state) => state.setPresenceStatus);
  const hydrateRemote = useAppStore((state) => state.hydrateRemotePresence);
  const clearRemote = useAppStore((state) => state.clearRemotePresence);
  const upsertRemote = useAppStore((state) => state.upsertRemotePresence);
  const removeRemote = useAppStore((state) => state.removeRemotePresence);
  const hasSentInitRef = useRef(false);
  const [socketOpenVersion, setSocketOpenVersion] = useState(0);

  const socket = usePartySocket({
    host: env.partyHost,
    room: session.currentRoomId,
    party: "main",
    onOpen() {
      setStatus("connected");
      setSocketOpenVersion((value) => value + 1);
    },
    onClose() {
      setStatus("disconnected");
      clearRemote();
      hasSentInitRef.current = false;
    },
    onError() {
      setStatus("disconnected");
      clearRemote();
      hasSentInitRef.current = false;
    },
    onMessage(event) {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }

      const parsed = serverMessageSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }

      const message = parsed.data;
      if (message.type === "room:snapshot") {
        const nextRemote = message.payload.connections.reduce<Record<string, PresenceSnapshot>>(
          (accumulator, connection) => {
            accumulator[connection.connectionId] = connection.snapshot;
            return accumulator;
          },
          {},
        );
        hydrateRemote(nextRemote);
      }
      if (message.type === "presence:joined" || message.type === "presence:updated") {
        upsertRemote(message.payload.connectionId, message.payload.snapshot);
      }
      if (message.type === "presence:left") {
        removeRemote(message.payload.connectionId);
      }
    },
  });

  useEffect(() => {
    setStatus("connecting");
    clearRemote();
    hasSentInitRef.current = false;
  }, [clearRemote, session.currentRoomId, setStatus]);

  useEffect(() => {
    if (!socket || !local || socket.readyState !== 1) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: hasSentInitRef.current ? "presence:update" : "presence:init",
        payload: local,
      }),
    );
    hasSentInitRef.current = true;
  }, [local, socket, socketOpenVersion]);

  return socket;
}
