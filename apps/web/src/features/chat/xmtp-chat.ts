import {
  Client,
  ConsentState,
  IdentifierKind,
  type Identifier,
  type Signer,
} from "@xmtp/browser-sdk";
import type { ConnectedPrivyWallet } from "@/features/wallet/use-privy-wallet";
import { runtimeProfile } from "@/lib/config/runtime";
import { createWalletClient, custom, getAddress, hexToBytes } from "viem";

const XMTP_APP_VERSION = "chainatlas-web/0.1.0";
const NS_TO_MS = 1_000_000n;
const XMTP_CLIENT_CREATE_TIMEOUT_MS = 20_000;
const XMTP_CLIENT_REGISTER_TIMEOUT_MS = 8_000;

type XmtpClientLike = Awaited<ReturnType<typeof Client.create>>;

type XmtpConversationLike = {
  id?: string;
  peerInboxId?: string | (() => Promise<string>);
  sendText?(content: string): Promise<unknown>;
  send?(content: string): Promise<unknown>;
  messages?(options?: { limit?: number }): Promise<unknown[] | AsyncIterable<unknown>>;
  stream?(options?: Record<string, unknown>): Promise<unknown>;
};

type XmtpMessageRecord = {
  id: string;
  content: string;
  sentAtMs: number;
  senderInboxId?: string;
  isFromMe: boolean;
};

export type XmtpChatMessage = XmtpMessageRecord;

let cachedClientAddress: string | undefined;
let cachedClientPromise: Promise<XmtpClientLike> | undefined;

function getXmtpEnvironment() {
  return runtimeProfile === "mainnet" ? "production" : "dev";
}

function toIdentifier(address: string): Identifier {
  const normalizedAddress = getAddress(address).toLowerCase();
  return {
    identifier: normalizedAddress,
    identifierKind: IdentifierKind.Ethereum,
  };
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toChainId(value: unknown): bigint | undefined {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (value.startsWith("0x")) {
      try {
        return BigInt(value);
      } catch {
        return undefined;
      }
    }
    const numeric = Number(value);
    if (Number.isInteger(numeric)) {
      return BigInt(numeric);
    }
  }
  return undefined;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function toMessageText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  const record = asObject(value);
  if (!record) {
    return undefined;
  }

  return asString(record.text) ?? asString(record.content);
}

function toTimestampMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "bigint") {
    return Number(value / NS_TO_MS);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000_000) {
      return Math.floor(value / 1_000_000);
    }
    if (value > 10_000_000_000_000) {
      return Math.floor(value / 1_000);
    }
    if (value > 1_000_000_000_000) {
      return Math.floor(value);
    }
    if (value > 1_000_000_000) {
      return Math.floor(value * 1_000);
    }
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toTimestampMs(numeric);
    }
  }

  return Date.now();
}

function normalizeChatMessage(
  value: unknown,
  ownInboxId: string | undefined,
): XmtpChatMessage | undefined {
  const record = asObject(value);
  if (!record) {
    return undefined;
  }

  const content = toMessageText(record.content);
  if (!content) {
    return undefined;
  }

  const senderInboxId = asString(record.senderInboxId);
  const sentAtMs = toTimestampMs(
    record.sentAtNs ?? record.sentAtMs ?? record.sentAt ?? record.createdAt,
  );
  const id =
    asString(record.id) ??
    asString(record.messageId) ??
    `${senderInboxId ?? "sender"}:${sentAtMs}:${content.slice(0, 16)}`;

  return {
    id,
    content,
    sentAtMs,
    senderInboxId,
    isFromMe: Boolean(ownInboxId && senderInboxId === ownInboxId),
  };
}

function sortMessages(messages: XmtpChatMessage[]) {
  return [...messages].sort((a, b) => {
    if (a.sentAtMs === b.sentAtMs) {
      return a.id.localeCompare(b.id);
    }
    return a.sentAtMs - b.sentAtMs;
  });
}

function dedupeMessages(messages: XmtpChatMessage[]) {
  const byId = new Map<string, XmtpChatMessage>();
  for (const message of messages) {
    byId.set(message.id, message);
  }
  return sortMessages([...byId.values()]);
}

async function createSigner(
  wallet: ConnectedPrivyWallet,
  signerType: "EOA" | "SCW",
): Promise<Signer> {
  const provider = await wallet.getEthereumProvider();
  const address = getAddress(wallet.address).toLowerCase() as `0x${string}`;
  const walletClient = createWalletClient({
    transport: custom(provider),
  });
  const signMessage = async (message: string) => {
    const signature = await walletClient.signMessage({
      account: address,
      message,
    });
    return hexToBytes(signature);
  };

  if (signerType === "EOA") {
    return {
      type: "EOA",
      getIdentifier: async () => ({
        identifier: address,
        identifierKind: IdentifierKind.Ethereum,
      }),
      signMessage,
    };
  }

  const chainId = toChainId(
    await provider.request({
      method: "eth_chainId",
    }),
  );
  if (!chainId) {
    throw new Error("Unable to resolve wallet chain ID for XMTP SCW signer.");
  }

  return {
    type: "SCW",
    getIdentifier: async () => ({
      identifier: address,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage,
    getChainId: () => chainId,
  };
}

async function callMethod<T>(
  target: Record<string, unknown>,
  methodName: string,
  ...args: unknown[]
): Promise<T | undefined> {
  const method = target[methodName];
  if (typeof method !== "function") {
    return undefined;
  }
  return (await (method as (...params: unknown[]) => Promise<T>).call(
    target,
    ...args,
  )) as T;
}

function matchesConversation(
  message: unknown,
  expectedConversationId: string | undefined,
  peerInboxId: string | undefined,
) {
  const record = asObject(message);
  if (!record) {
    return false;
  }

  const messageConversationId = asString(record.conversationId) ??
    asString(asObject(record.conversation)?.id);
  if (expectedConversationId && messageConversationId) {
    if (messageConversationId === expectedConversationId) {
      return true;
    }
  }

  if (!peerInboxId) {
    return false;
  }

  const senderInboxId = asString(record.senderInboxId);
  const recipientInboxId = asString(record.recipientInboxId);
  return senderInboxId === peerInboxId || recipientInboxId === peerInboxId;
}

async function resolvePeerInboxId(
  conversation: XmtpConversationLike,
): Promise<string | undefined> {
  if (typeof conversation.peerInboxId === "string") {
    return conversation.peerInboxId;
  }
  const peerInboxMethod = conversation.peerInboxId;
  if (typeof peerInboxMethod !== "function") {
    return undefined;
  }
  try {
    const value = await peerInboxMethod.call(conversation);
    return asString(value);
  } catch {
    return undefined;
  }
}

async function syncConversations(client: XmtpClientLike) {
  const conversations = client.conversations as unknown as Record<string, unknown>;
  if (typeof conversations.syncAll === "function") {
    await (conversations.syncAll as (consentStates?: ConsentState[]) => Promise<void>)(
      [ConsentState.Allowed, ConsentState.Unknown],
    );
    return;
  }
  if (typeof conversations.sync === "function") {
    await (conversations.sync as () => Promise<void>)();
  }
}

async function toMessageArray(
  source: unknown[] | AsyncIterable<unknown> | undefined,
) {
  if (!source) {
    return [] as unknown[];
  }
  if (Array.isArray(source)) {
    return source;
  }
  const messages: unknown[] = [];
  for await (const message of source) {
    messages.push(message);
  }
  return messages;
}

export async function getOrCreateXmtpClient(wallet: ConnectedPrivyWallet) {
  const normalizedAddress = wallet.address.toLowerCase();
  if (!cachedClientPromise || cachedClientAddress !== normalizedAddress) {
    cachedClientAddress = normalizedAddress;
    cachedClientPromise = (async () => {
      const options = {
        env: getXmtpEnvironment(),
        appVersion: XMTP_APP_VERSION,
      } as Parameters<typeof Client.create>[1];

      const eoaSigner = await createSigner(wallet, "EOA");
      try {
        const client = await withTimeout(
          Client.create(eoaSigner, options),
          XMTP_CLIENT_CREATE_TIMEOUT_MS,
          "XMTP client initialization timed out. Open wallet and retry.",
        );
        const registered = await withTimeout(
          client.isRegistered(),
          XMTP_CLIENT_REGISTER_TIMEOUT_MS,
          "XMTP registration check timed out.",
        );
        if (!registered) {
          throw new Error("Wallet is connected but not XMTP-registered yet.");
        }
        return client;
      } catch (eoaError) {
        const scwSigner = await createSigner(wallet, "SCW");
        try {
          const client = await withTimeout(
            Client.create(scwSigner, options),
            XMTP_CLIENT_CREATE_TIMEOUT_MS,
            "XMTP SCW initialization timed out. Open wallet and retry.",
          );
          const registered = await withTimeout(
            client.isRegistered(),
            XMTP_CLIENT_REGISTER_TIMEOUT_MS,
            "XMTP SCW registration check timed out.",
          );
          if (!registered) {
            throw new Error("SCW is connected but not XMTP-registered yet.");
          }
          return client;
        } catch (scwError) {
          const eoaMessage =
            eoaError instanceof Error ? eoaError.message : String(eoaError);
          const scwMessage =
            scwError instanceof Error ? scwError.message : String(scwError);
          throw new Error(
            `XMTP initialization failed (EOA: ${eoaMessage}; SCW: ${scwMessage})`,
          );
        }
      }
    })().catch((error) => {
      cachedClientAddress = undefined;
      cachedClientPromise = undefined;
      throw error;
    });
  }
  return await cachedClientPromise;
}

export async function getOrCreateDmConversation(
  client: XmtpClientLike,
  targetAddress: string,
) {
  const identifier = toIdentifier(targetAddress);
  const conversations = client.conversations;
  let targetInboxId = await client.fetchInboxIdByIdentifier(identifier);
  if (!targetInboxId) {
    const canMessageResponse = await client.canMessage([identifier]);
    if (![...canMessageResponse.values()].some(Boolean)) {
      throw new Error("Target wallet is not XMTP-enabled yet.");
    }
    targetInboxId = await client.fetchInboxIdByIdentifier(identifier);
  }
  if (!targetInboxId) {
    throw new Error("Target wallet is not XMTP-enabled yet.");
  }

  const knownDm = await callMethod<XmtpConversationLike>(
    conversations as unknown as Record<string, unknown>,
    "getDmByInboxId",
    targetInboxId,
  );
  if (knownDm) {
    return knownDm;
  }

  try {
    const existing = await conversations.fetchDmByIdentifier(identifier);
    if (existing) {
      return existing as unknown as XmtpConversationLike;
    }
  } catch {
    // Storage miss should not block DM creation path.
  }

  try {
    const created = await conversations.createDm(targetInboxId);
    return created as unknown as XmtpConversationLike;
  } catch (error) {
    try {
      const created = await conversations.createDmWithIdentifier(identifier);
      return created as unknown as XmtpConversationLike;
    } catch (fallbackError) {
      const message =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      throw new Error(`Unable to open XMTP DM for this user: ${message}`);
    }
  }
}

export async function listDmMessages(
  client: XmtpClientLike,
  conversation: XmtpConversationLike,
  limit = 60,
) {
  try {
    await syncConversations(client);
  } catch {
    // Continue with local DB snapshot if network sync is temporarily unavailable.
  }
  const source = await conversation.messages?.({ limit });
  const ownInboxId = asString((client as unknown as { inboxId?: string }).inboxId);
  const normalized = (await toMessageArray(source))
    .map((message) => normalizeChatMessage(message, ownInboxId))
    .filter((message): message is XmtpChatMessage => Boolean(message));
  return dedupeMessages(normalized);
}

export async function sendDmMessage(
  conversation: XmtpConversationLike,
  content: string,
) {
  if (typeof conversation.sendText === "function") {
    await conversation.sendText(content);
    return;
  }
  if (typeof conversation.send === "function") {
    await conversation.send(content);
    return;
  }
  throw new Error("XMTP conversation does not support sending text.");
}

export async function streamDmMessages(
  client: XmtpClientLike,
  conversation: XmtpConversationLike,
  onMessage: (message: XmtpChatMessage) => void,
) {
  const ownInboxId = asString((client as unknown as { inboxId?: string }).inboxId);
  const expectedConversationId = conversation.id;
  const peerInboxId = await resolvePeerInboxId(conversation);

  if (typeof conversation.stream === "function") {
    try {
      const stream = await conversation.stream({
        onValue: (message: unknown) => {
          const normalized = normalizeChatMessage(message, ownInboxId);
          if (!normalized) {
            return;
          }
          onMessage(normalized);
        },
      });

      return () => {
        const streamRecord = asObject(stream);
        const returnMethod = streamRecord?.return;
        if (typeof returnMethod === "function") {
          void (returnMethod as (...args: unknown[]) => unknown).call(stream);
        }
      };
    } catch {
      // Fall through to a global DM stream when conversation-specific stream fails.
    }
  }

  const conversations = client.conversations as unknown as Record<string, unknown>;
  const streamAllDmMessages = conversations.streamAllDmMessages;
  if (typeof streamAllDmMessages === "function") {
    const stream = await (
      streamAllDmMessages as (options: Record<string, unknown>) => Promise<unknown>
    ).call(conversations, {
      consentStates: [ConsentState.Allowed, ConsentState.Unknown],
      onValue: (message: unknown) => {
        if (!matchesConversation(message, expectedConversationId, peerInboxId)) {
          return;
        }
        const normalized = normalizeChatMessage(message, ownInboxId);
        if (!normalized) {
          return;
        }
        onMessage(normalized);
      },
    });

    return () => {
      const streamRecord = asObject(stream);
      const returnMethod = streamRecord?.return;
      if (typeof returnMethod === "function") {
        void (returnMethod as (...args: unknown[]) => unknown).call(stream);
      }
    };
  }

  const streamAllMessages = conversations.streamAllMessages;
  if (typeof streamAllMessages !== "function") {
    return () => {};
  }

  const stream = await (
    streamAllMessages as (options: Record<string, unknown>) => Promise<unknown>
  ).call(conversations, {
    consentStates: [ConsentState.Allowed, ConsentState.Unknown],
    onValue: (message: unknown) => {
      if (!matchesConversation(message, expectedConversationId, peerInboxId)) {
        return;
      }
      const normalized = normalizeChatMessage(message, ownInboxId);
      if (!normalized) {
        return;
      }
      onMessage(normalized);
    },
  });

  return () => {
    const streamRecord = asObject(stream);
    const returnMethod = streamRecord?.return;
    if (typeof returnMethod === "function") {
      void (returnMethod as (...args: unknown[]) => unknown).call(stream);
    }
  };
}

export function appendUniqueMessages(
  current: XmtpChatMessage[],
  next: XmtpChatMessage[],
) {
  return dedupeMessages([...current, ...next]);
}
