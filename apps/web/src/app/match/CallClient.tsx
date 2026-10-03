"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

type CallPhase = "idle" | "calling" | "ringing" | "active";

// Free public STUN only — no TURN server, by design (see Phase 6 report).
// This means calls between two peers who are both behind a restrictive/
// symmetric NAT or firewall may fail to establish a direct connection.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type OfferPayload = { sdp: RTCSessionDescriptionInit; from: string };
type AnswerPayload = { sdp: RTCSessionDescriptionInit; from: string };
type IceCandidatePayload = { candidate: RTCIceCandidateInit; from: string };

export function CallClient({ socket, matchId }: { socket: Socket; matchId: string }) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  function cleanupCall() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setConnectionState(null);
    setPhase("idle");
  }

  function endCall(notifyPeer: boolean) {
    if (notifyPeer && phase !== "idle") {
      socket.emit("call:end", { matchId });
    }
    cleanupCall();
  }

  async function getLocalMedia(): Promise<MediaStream> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setMicEnabled(true);
      setCameraEnabled(true);
      return stream;
    } catch {
      setError("Camera/microphone permission was denied or unavailable.");
      throw new Error("getUserMedia failed");
    }
  }

  function createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("call:ice-candidate", { matchId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "failed") {
        setError("Call connection failed (this can happen without a TURN server across strict networks).");
        endCall(true);
      }
    };

    pcRef.current = pc;
    return pc;
  }

  async function flushPendingCandidates() {
    const pc = pcRef.current;
    if (!pc) return;
    for (const candidate of pendingCandidatesRef.current) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // Ignore a candidate that fails to add (e.g. arrived after close).
      }
    }
    pendingCandidatesRef.current = [];
  }

  async function startCall() {
    setError(null);
    setStarting(true);
    try {
      const stream = await getLocalMedia();
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("call:offer", { matchId, sdp: offer });
      setPhase("calling");
    } catch {
      cleanupCall();
    } finally {
      setStarting(false);
    }
  }

  async function acceptIncomingCall() {
    const offer = pendingOfferRef.current;
    if (!offer) return;
    setError(null);
    try {
      const stream = await getLocalMedia();
      const pc = createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription(offer);
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("call:answer", { matchId, sdp: answer });
      pendingOfferRef.current = null;
      setPhase("active");
    } catch {
      cleanupCall();
    }
  }

  function declineIncomingCall() {
    socket.emit("call:end", { matchId });
    cleanupCall();
  }

  function toggleMic() {
    const next = !micEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicEnabled(next);
  }

  function toggleCamera() {
    const next = !cameraEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraEnabled(next);
  }

  useEffect(() => {
    async function handleOffer(payload: OfferPayload) {
      if (phase !== "idle") return; // already in/starting a call — no call-waiting support (MVP)
      pendingOfferRef.current = payload.sdp;
      setError(null);
      setPhase("ringing");
    }

    async function handleAnswer(payload: AnswerPayload) {
      const pc = pcRef.current;
      if (!pc || phase !== "calling") return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingCandidates();
        setPhase("active");
      } catch {
        setError("Failed to establish the call.");
        cleanupCall();
      }
    }

    async function handleIceCandidate(payload: IceCandidatePayload) {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(payload.candidate);
      } catch {
        // Ignore malformed/late candidates.
      }
    }

    function handleCallEnded() {
      if (phase === "idle") return;
      setError(null);
      cleanupCall();
    }

    function handleUserDisconnected() {
      if (phase === "idle") return;
      setError("The other participant disconnected.");
      cleanupCall();
    }

    socket.on("call:offer", handleOffer);
    socket.on("call:answer", handleAnswer);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:ended", handleCallEnded);
    socket.on("chat:user_disconnected", handleUserDisconnected);

    return () => {
      socket.off("call:offer", handleOffer);
      socket.off("call:answer", handleAnswer);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:ended", handleCallEnded);
      socket.off("chat:user_disconnected", handleUserDisconnected);
    };
  }, [socket, matchId, phase]);

  // Covers both "call ended" and "match ended" (the parent unmounts this
  // component when the match ends, which runs this same cleanup).
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">
          {phase === "idle" && "No active call"}
          {phase === "calling" && "Calling…"}
          {phase === "ringing" && "Incoming call…"}
          {phase === "active" && `Call ${connectionState ?? "connecting"}`}
        </span>
      </div>

      {error && (
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full rounded-md bg-zinc-900 object-cover"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="aspect-video w-full rounded-md bg-zinc-900 object-cover"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {phase === "idle" && (
          <button
            type="button"
            onClick={startCall}
            disabled={starting}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
          >
            {starting ? "Starting…" : "Start Call"}
          </button>
        )}

        {phase === "ringing" && (
          <>
            <button
              type="button"
              onClick={acceptIncomingCall}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={declineIncomingCall}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:text-red-400"
            >
              Decline
            </button>
          </>
        )}

        {(phase === "calling" || phase === "active") && (
          <>
            <button
              type="button"
              onClick={toggleMic}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-white"
            >
              {micEnabled ? "Mute" : "Unmute"}
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-700 dark:text-white"
            >
              {cameraEnabled ? "Camera Off" : "Camera On"}
            </button>
            <button
              type="button"
              onClick={() => endCall(true)}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-900 dark:text-red-400"
            >
              End Call
            </button>
          </>
        )}
      </div>
    </div>
  );
}
