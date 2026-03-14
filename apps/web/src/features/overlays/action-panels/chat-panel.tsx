import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  appendUniqueMessages,
  getOrCreateDmConversation,
  getOrCreateXmtpClient,
  listDmMessages,
  sendDmMessage,
  streamDmMessages,
  type XmtpChatMessage,
} from "@/features/chat/xmtp-chat";
import { usePrivyWallet } from "@/features/wallet/use-privy-wallet";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import {
  ActionButton,
  InlineError,
  Input,
  PanelFrame,
  shortAddress,
  withXmtpTimeout,
} from "./shared";

export function ChatPanel() {
  const { wallet } = usePrivyWallet();
  const nearbyTarget = useAppStore((state) => state.overlays.nearbyTarget);
  const remotePresence = useAppStore((state) => state.presence.remote);
  const [messages, setMessages] = useState<XmtpChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "ready">("idle");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const clientRef = useRef<Awaited<ReturnType<typeof getOrCreateXmtpClient>> | null>(
    null,
  );
  const conversationRef = useRef<Parameters<typeof sendDmMessage>[0] | null>(null);
  const stopStreamRef = useRef<(() => void) | undefined>(undefined);

  const targetSnapshot = useMemo(() => {
    if (!nearbyTarget) {
      return undefined;
    }
    const normalizedTarget = nearbyTarget.toLowerCase();
    return Object.values(remotePresence).find(
      (snapshot) => snapshot.address.toLowerCase() === normalizedTarget,
    );
  }, [nearbyTarget, remotePresence]);

  const targetLabel = targetSnapshot?.displayName ?? shortAddress(nearbyTarget);
  const targetNotEnabled = (error ?? "").toLowerCase().includes(
    "not xmtp-enabled",
  );

  useEffect(() => {
    const stopPreviousStream = stopStreamRef.current;
    if (stopPreviousStream) {
      stopPreviousStream();
      stopStreamRef.current = undefined;
    }

    conversationRef.current = null;
    if (!wallet || !nearbyTarget) {
      setStatus("idle");
      setMessages([]);
      setError(undefined);
      return;
    }

    let cancelled = false;
    setStatus("connecting");
    setError(undefined);
    setMessages([]);

    void (async () => {
      try {
        const client = await getOrCreateXmtpClient(wallet);
        if (cancelled) {
          return;
        }
        clientRef.current = client;

        const conversation = await withXmtpTimeout(
          getOrCreateDmConversation(client, nearbyTarget),
          "Opening XMTP DM timed out. Retry in a moment.",
        );
        if (cancelled) {
          return;
        }
        conversationRef.current = conversation;

        const initialMessages = await withXmtpTimeout(
          listDmMessages(client, conversation),
          "Loading XMTP messages timed out. Retry in a moment.",
        );
        if (cancelled) {
          return;
        }
        setMessages(initialMessages);
        setStatus("ready");

        const stopStream = await withXmtpTimeout(
          streamDmMessages(client, conversation, (message) => {
            if (cancelled) {
              return;
            }
            setMessages((current) => appendUniqueMessages(current, [message]));
          }),
          "Starting XMTP stream timed out. Retry in a moment.",
        );
        if (cancelled) {
          stopStream();
          return;
        }
        const reconcileInterval = window.setInterval(() => {
          void (async () => {
            if (cancelled) {
              return;
            }
            try {
              const refreshed = await listDmMessages(client, conversation);
              if (cancelled) {
                return;
              }
              setMessages((current) => appendUniqueMessages(current, refreshed));
            } catch {
              // Keep chat usable even if a periodic sync fails.
            }
          })();
        }, 4_000);

        stopStreamRef.current = () => {
          window.clearInterval(reconcileInterval);
          stopStream();
        };
      } catch (streamError) {
        if (cancelled) {
          return;
        }
        setStatus("idle");
        setMessages([]);
        setError(
          streamError instanceof Error
            ? streamError.message
            : "Unable to open XMTP chat for this player.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopStreamRef.current?.();
      stopStreamRef.current = undefined;
    };
  }, [nearbyTarget, wallet]);

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !wallet || !nearbyTarget) {
      return;
    }

    setSending(true);
    setError(undefined);
    try {
      const client =
        clientRef.current ??
        (await getOrCreateXmtpClient(wallet));
      clientRef.current = client;
      const conversation =
        conversationRef.current ??
        (await withXmtpTimeout(
          getOrCreateDmConversation(client, nearbyTarget),
          "Opening XMTP DM timed out. Retry in a moment.",
        ));
      conversationRef.current = conversation;

      setDraft("");
      await withXmtpTimeout(
        sendDmMessage(conversation, content),
        "Sending XMTP message timed out. Retry.",
      );
      const latestMessages = await withXmtpTimeout(
        listDmMessages(client, conversation),
        "Refreshing XMTP messages timed out. Retry in a moment.",
      );
      setMessages(latestMessages);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Failed to send XMTP message.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <PanelFrame
      subtitle={
        nearbyTarget
          ? "Direct XMTP DM with the selected player."
          : "Move near another player and tap Interact to open chat."
      }
      title="Nearby Chat"
    >
      {!nearbyTarget ? (
        <p className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2 text-sm text-cyan-100/70 text-pretty">
          No nearby player detected.
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-cyan-100/20 bg-cyan-50/8 px-3 py-2">
            <p className="text-xs text-cyan-100/70">Talking to</p>
            <p className="text-sm font-semibold text-cyan-50">{targetLabel}</p>
            <p className="mt-0.5 text-xs text-cyan-100/70">
              {shortAddress(nearbyTarget)}
            </p>
          </div>
          <div className="max-h-72 min-h-52 space-y-2 overflow-y-auto rounded-xl border border-cyan-100/20 bg-[#091923] p-3">
            {status === "connecting" ? (
              <p className="text-sm text-cyan-100/75">Connecting to XMTP...</p>
            ) : targetNotEnabled ? (
              <div className="space-y-2 rounded-xl border border-amber-200/35 bg-amber-200/10 px-3 py-2 text-sm text-amber-100">
                <p className="font-semibold">This player has not enabled XMTP yet.</p>
                <p className="text-amber-100/90">
                  Ask them to open an XMTP app (for example xmtp.chat) and sign
                  once with wallet {shortAddress(nearbyTarget)}.
                </p>
                <a
                  className="inline-flex rounded-lg border border-amber-200/45 bg-amber-200/15 px-2.5 py-1 text-xs font-medium text-amber-50 hover:bg-amber-200/25"
                  href="https://xmtp.chat"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open xmtp.chat
                </a>
              </div>
            ) : messages.length === 0 ? (
              <p className="text-sm text-cyan-100/75">
                Start the conversation. Messages sync through XMTP.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[90%] rounded-xl border px-3 py-2 text-sm",
                    message.isFromMe
                      ? "ml-auto border-emerald-200/40 bg-emerald-300/15 text-emerald-50"
                      : "border-cyan-100/25 bg-cyan-50/10 text-cyan-50",
                  )}
                >
                  <p className="text-pretty">{message.content}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-cyan-100/65">
                    {new Date(message.sentAtMs).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              ))
            )}
          </div>
          <form className="space-y-2" onSubmit={(event) => void handleSendMessage(event)}>
            <Input
              disabled={sending || status !== "ready" || targetNotEnabled}
              onChange={setDraft}
              placeholder={
                targetNotEnabled
                  ? "Waiting for other player to enable XMTP..."
                  : "Type a message..."
              }
              value={draft}
            />
            <ActionButton
              buttonType="submit"
              className="text-center"
              disabled={
                sending ||
                status !== "ready" ||
                targetNotEnabled ||
                draft.trim().length === 0
              }
            >
              {sending ? "Sending..." : "Send message"}
            </ActionButton>
          </form>
        </>
      )}
      <InlineError message={error} />
    </PanelFrame>
  );
}
