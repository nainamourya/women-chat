// Minimal Engine.IO v4 + Socket.IO v5 wire protocol, WebSocket transport only,
// default namespace only, no binary attachments. Enough for the real
// `socket.io-client` (which the web app already uses) to talk to the Worker
// unchanged — every event name and payload the app uses is plain JSON.
//
// Engine.IO packet = one type character + payload. Type "4" wraps a Socket.IO
// packet. Socket.IO packet = type digit, optional "/namespace,", optional
// numeric ack id, optional JSON payload.

export const ENGINE_OPEN = "0";
export const ENGINE_CLOSE = "1";
export const ENGINE_PING = "2";
export const ENGINE_PONG = "3";
export const ENGINE_MESSAGE = "4";

export type SocketIoPacket =
  | { type: "CONNECT"; nsp: string; data?: unknown }
  | { type: "DISCONNECT"; nsp: string }
  | { type: "EVENT"; nsp: string; data: unknown[]; id?: number }
  | { type: "ACK"; nsp: string; data: unknown[]; id: number }
  | { type: "CONNECT_ERROR"; nsp: string; data: unknown }
  | { type: "UNSUPPORTED"; nsp: string };

const TYPE_CODES = { CONNECT: "0", DISCONNECT: "1", EVENT: "2", ACK: "3", CONNECT_ERROR: "4" } as const;

export function encodePacket(packet: Exclude<SocketIoPacket, { type: "UNSUPPORTED" }>): string {
  let out = ENGINE_MESSAGE + TYPE_CODES[packet.type];
  if (packet.nsp !== "/") out += `${packet.nsp},`;
  if ("id" in packet && packet.id !== undefined) out += String(packet.id);
  if ("data" in packet && packet.data !== undefined) out += JSON.stringify(packet.data);
  return out;
}

export function encodeEvent(event: string, payload: unknown): string {
  return encodePacket({ type: "EVENT", nsp: "/", data: [event, payload] });
}

/** Decodes the part after the Engine.IO "4". Returns null for malformed input. */
export function decodePacket(raw: string): SocketIoPacket | null {
  if (raw.length === 0) return null;
  const typeChar = raw[0];
  // 5 and 6 are binary packets, which this app never uses.
  if (typeChar === "5" || typeChar === "6") return { type: "UNSUPPORTED", nsp: "/" };
  let i = 1;

  let nsp = "/";
  if (raw[i] === "/") {
    const comma = raw.indexOf(",", i);
    if (comma === -1) {
      nsp = raw.slice(i);
      i = raw.length;
    } else {
      nsp = raw.slice(i, comma);
      i = comma + 1;
    }
  }

  let id: number | undefined;
  const idStart = i;
  while (i < raw.length && raw[i] >= "0" && raw[i] <= "9") i++;
  if (i > idStart) id = Number(raw.slice(idStart, i));

  const rest = raw.slice(i);
  let data: unknown;
  if (rest.length > 0) {
    try {
      data = JSON.parse(rest);
    } catch {
      return null;
    }
  }

  switch (typeChar) {
    case "0":
      return { type: "CONNECT", nsp, data };
    case "1":
      return { type: "DISCONNECT", nsp };
    case "2":
      if (!Array.isArray(data) || typeof data[0] !== "string") return null;
      return { type: "EVENT", nsp, data, id };
    case "3":
      if (!Array.isArray(data) || id === undefined) return null;
      return { type: "ACK", nsp, data, id };
    case "4":
      return { type: "CONNECT_ERROR", nsp, data };
    default:
      return null;
  }
}
