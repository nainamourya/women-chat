import { describe, expect, it } from "vitest";
import { decodePacket, encodeEvent, encodePacket } from "../src/realtime/protocol";

// The wire format the real socket.io-client speaks. Strings below are what
// socket.io-client / socket.io (protocol v5) actually put on the wire.
describe("Socket.IO packet encoding", () => {
  it("encodes an event as a type-2 packet inside an Engine.IO message", () => {
    expect(encodeEvent("chat:message", { id: 1 })).toBe('42["chat:message",{"id":1}]');
  });

  it("encodes an acknowledgement with its id", () => {
    expect(encodePacket({ type: "ACK", nsp: "/", id: 12, data: [{ ok: true }] })).toBe('4312[{"ok":true}]');
  });

  it("encodes connect success and connect error", () => {
    expect(encodePacket({ type: "CONNECT", nsp: "/", data: { sid: "abc" } })).toBe('40{"sid":"abc"}');
    expect(encodePacket({ type: "CONNECT_ERROR", nsp: "/", data: { message: "Unauthorized" } })).toBe('44{"message":"Unauthorized"}');
  });
});

describe("Socket.IO packet decoding", () => {
  it("decodes CONNECT with an auth payload (as the web client sends it)", () => {
    expect(decodePacket('0{"ticket":"t"}')).toEqual({ type: "CONNECT", nsp: "/", data: { ticket: "t" } });
  });

  it("decodes CONNECT without auth", () => {
    expect(decodePacket("0")).toEqual({ type: "CONNECT", nsp: "/", data: undefined });
  });

  it("decodes an event without and with an ack id", () => {
    expect(decodePacket('2["chat:join",{"matchId":"m"}]')).toEqual({ type: "EVENT", nsp: "/", data: ["chat:join", { matchId: "m" }], id: undefined });
    expect(decodePacket('217["chat:join",{"matchId":"m"}]')).toEqual({ type: "EVENT", nsp: "/", data: ["chat:join", { matchId: "m" }], id: 17 });
  });

  it("decodes a non-default namespace so it can be refused", () => {
    expect(decodePacket('0/admin,{"x":1}')).toEqual({ type: "CONNECT", nsp: "/admin", data: { x: 1 } });
    expect(decodePacket("0/admin")).toEqual({ type: "CONNECT", nsp: "/admin", data: undefined });
  });

  it("decodes a disconnect", () => {
    expect(decodePacket("1")).toEqual({ type: "DISCONNECT", nsp: "/" });
  });

  it("rejects malformed input instead of throwing", () => {
    expect(decodePacket("")).toBeNull();
    expect(decodePacket("2{not json")).toBeNull();
    expect(decodePacket('2{"not":"an array"}')).toBeNull();
    expect(decodePacket("2[5]")).toBeNull(); // the event name must be a string
    expect(decodePacket('3["no id"]')).toBeNull();
    expect(decodePacket("9[]")).toBeNull();
  });

  it("flags binary packets as unsupported (the app never sends binary)", () => {
    expect(decodePacket('51-["x",{"_placeholder":true,"num":0}]')).toEqual({ type: "UNSUPPORTED", nsp: "/" });
  });
});
