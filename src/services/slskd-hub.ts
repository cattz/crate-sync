import {
  HubConnectionBuilder,
  HubConnection,
  LogLevel,
  HttpTransportType,
  HubConnectionState,
} from "@microsoft/signalr";
import { createLogger } from "../utils/logger.js";

const log = createLogger("slskd-hub");

// ---------------------------------------------------------------------------
// Types matching slskd's Transfer DTO (Transfers/API/DTO/Transfer.cs)
// ---------------------------------------------------------------------------

export interface SlskdHubTransfer {
  id: string;
  username: string;
  filename: string;
  size: number;
  state: string; // TransferStates flags as string
  bytesTransferred: number;
  bytesRemaining: number;
  averageSpeed: number;
  percentComplete: number;
  elapsedTime: number | null;  // milliseconds
  remainingTime: number | null; // milliseconds
  startTime: string | null;
  endTime: string | null;
  exception: string | null;
  direction: number; // 0 = Download, 1 = Upload
  token: number;
  placeInQueue: number | null;
}

export type TransferEventType =
  | "LIST"
  | "ENQUEUED"
  | "UPDATE"
  | "PROGRESS"
  | "COMPLETED"
  | "FAILED";

export interface TransferEvent {
  type: TransferEventType;
  /** Single transfer for most events; array for LIST. */
  transfer?: SlskdHubTransfer;
  transfers?: SlskdHubTransfer[];
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

export function connectTransferHub(
  baseUrl: string,
  apiKey: string,
  onEvent: (event: TransferEvent) => void,
): HubConnection {
  const hubUrl = `${baseUrl.replace(/\/+$/, "")}/hub/transfers`;

  const connection = new HubConnectionBuilder()
    .withUrl(hubUrl, {
      // slskd accepts API key as access_token query param for SignalR
      accessTokenFactory: () => apiKey,
      // Use WebSockets with long-polling fallback (Node.js compatible)
      transport: HttpTransportType.WebSockets | HttpTransportType.LongPolling,
    })
    .withAutomaticReconnect({
      nextRetryDelayInMilliseconds: (ctx) => {
        // Exponential backoff: 1s, 2s, 5s, 10s, 30s (max)
        const delays = [1000, 2000, 5000, 10_000, 30_000];
        return delays[Math.min(ctx.previousRetryCount, delays.length - 1)];
      },
    })
    .configureLogging(LogLevel.Warning)
    .build();

  // Register handlers for each event type from TransferHubMethods
  const singleEvents: TransferEventType[] = [
    "ENQUEUED",
    "UPDATE",
    "PROGRESS",
    "COMPLETED",
    "FAILED",
  ];
  for (const type of singleEvents) {
    connection.on(type, (data: SlskdHubTransfer) => {
      onEvent({ type, transfer: data });
    });
  }

  // LIST sends the full list of current downloads on connect
  connection.on("LIST", (data: SlskdHubTransfer[]) => {
    onEvent({ type: "LIST", transfers: data });
  });

  connection.onreconnecting((err) => {
    log.warn("SignalR reconnecting", { error: err?.message });
  });

  connection.onreconnected(() => {
    log.info("SignalR reconnected");
  });

  connection.onclose((err) => {
    if (err) {
      log.warn("SignalR connection closed with error", { error: err.message });
    } else {
      log.info("SignalR connection closed");
    }
  });

  // Start the connection
  connection
    .start()
    .then(() => {
      log.info("SignalR connected to slskd transfer hub", { url: hubUrl });
    })
    .catch((err) => {
      log.error("SignalR connection failed", {
        error: err instanceof Error ? err.message : String(err),
        url: hubUrl,
      });
    });

  return connection;
}

/** Check if a connection is active and usable. */
export function isHubConnected(connection: HubConnection | null): boolean {
  return connection?.state === HubConnectionState.Connected;
}

/** Gracefully stop a hub connection. */
export async function disconnectTransferHub(
  connection: HubConnection | null,
): Promise<void> {
  if (!connection) return;
  try {
    await connection.stop();
    log.info("SignalR disconnected");
  } catch (err) {
    log.warn("Error stopping SignalR connection", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
