"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";

type CallPhase = "idle" | "calling" | "ringing" | "active";

// Free public STUN only — no TURN server, by design (see Phase 6 report).
// This means calls between two peers who are both behind a restrictive/
// symmetric NAT or firewall may fail to establish a direct connection.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type OfferPayload = { sdp: RTCSessionDescriptionInit; from: string };
type AnswerPayload = { sdp: RTCSessionDescriptionInit; from: string };
type IceCandidatePayload = { candidate: RTCIceCandidateInit; from: string };

function MicIcon({ muted }: { muted: boolean }) {
  return muted ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9v3a3 3 0 0 0 4.6 2.54M15 9.4V5a3 3 0 0 0-5.7-1.3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-10.6 6M5 10v2M12 19v3M3 3l18 18" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  );
}

function CameraIcon({ off }: { off: boolean }) {
  return off ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 10l4.5-2.5a1 1 0 0 1 1.5.87v7.26a1 1 0 0 1-1.5.87L16 14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 10l4.5-2.5a1 1 0 0 1 1.5.87v7.26a1 1 0 0 1-1.5.87L16 14" />
      <rect x="3" y="6" width="13" height="12" rx="2" />
    </svg>
  );
}

function PhoneEndIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M12 9c-3.1 0-5.9.9-8.3 2.5a1.5 1.5 0 0 0-.3 2.2l1.8 2.2a1.5 1.5 0 0 0 2 .3c.7-.5 1.5-.9 2.3-1.1a1 1 0 0 0 .7-1v-1.8a1 1 0 0 1 .8-1c.3 0 .6-.1 1-.1s.7 0 1 .1a1 1 0 0 1 .8 1v1.8a1 1 0 0 0 .7 1c.8.2 1.6.6 2.3 1.1a1.5 1.5 0 0 0 2-.3l1.8-2.2a1.5 1.5 0 0 0-.3-2.2C17.9 9.9 15.1 9 12 9z" />
    </svg>
  );
}

function VideoCallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 10l4.5-2.5a1 1 0 0 1 1.5.87v7.26a1 1 0 0 1-1.5.87L16 14" />
      <rect x="3" y="6" width="13" height="12" rx="2" />
    </svg>
  );
}

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
      />
    </svg>
  );
}

function PhoneAcceptIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M20.1 15.7c-1.3-.1-2.6-.4-3.8-.9a1.5 1.5 0 0 0-1.6.3l-1 1a13 13 0 0 1-5.8-5.8l1-1a1.5 1.5 0 0 0 .3-1.6c-.5-1.2-.8-2.5-.9-3.8A1.5 1.5 0 0 0 6.8 2.5H4.3A1.5 1.5 0 0 0 2.8 4c.1 9.4 7.7 17 17.1 17.1a1.5 1.5 0 0 0 1.5-1.5v-2.4a1.5 1.5 0 0 0-1.3-1.5z" />
    </svg>
  );
}

export function CallClient({
  socket,
  matchId,
  onPhaseChange,
  chatOpen,
  onToggleChat,
}: {
  socket: Socket;
  matchId: string;
  onPhaseChange?: (phase: CallPhase) => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
}) {
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
  // Always mounted (unlike the overlay below, which unmounts when idle) so
  // the draggable bubble's dragConstraints ref is never null when it mounts.
  const constraintsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  // Covers both "call ended" and "match ended" (the parent unmounts this
  // component when the match ends, which runs this same cleanup).
  useEffect(() => {
    return () => {
      pcRef.current?.close();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const connectionBadge =
    phase === "active"
      ? connectionState === "connected"
        ? { variant: "success" as const, label: "Connected" }
        : connectionState === "failed"
          ? { variant: "danger" as const, label: "Connection failed" }
          : { variant: "warning" as const, label: "Connecting…" }
      : null;

  return (
    <>
      {phase === "idle" && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
          <button
            type="button"
            onClick={startCall}
            disabled={starting}
            aria-label="Start video call"
            title="Start video call"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            <VideoCallIcon />
          </button>
          <span className="text-sm text-muted">{starting ? "Starting call…" : "Start a video call"}</span>
        </div>
      )}

      {error && phase === "idle" && <Alert variant="danger">{error}</Alert>}

      <div ref={constraintsRef} aria-hidden className="pointer-events-none fixed inset-0 z-50" />

      {/* Stays mounted across every phase (just hidden via CSS when idle/ringing)
          so the <video> ref is already attached by the time getUserMedia
          resolves — re-mounting it only once a call starts would lose the
          stream, since nothing re-attaches srcObject on remount. */}
      <motion.div
        drag={phase === "active"}
        dragConstraints={constraintsRef}
        dragMomentum={false}
        dragElastic={0.12}
        className={
          phase === "idle" || phase === "ringing"
            ? "hidden"
            : phase === "calling"
              ? "fixed inset-0 z-40 overflow-hidden bg-[#120d1a] transition-none"
              : "fixed bottom-28 right-4 z-[60] h-28 w-28 cursor-grab touch-none overflow-hidden rounded-full border-2 border-white/40 bg-[#120d1a] shadow-lg transition-none active:cursor-grabbing"
        }
      >
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className={`h-full w-full object-cover ${cameraEnabled ? "" : "invisible"}`}
        />
        {!cameraEnabled && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#120d1a]">
            <Avatar size={phase === "active" ? "sm" : "lg"} />
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {phase !== "idle" && (
          <motion.div
            key="call-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className={`fixed inset-0 z-50 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-none ${
              phase === "calling" ? "bg-transparent" : "bg-[#120d1a]"
            }`}
          >
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`absolute inset-0 h-full w-full object-cover ${phase === "active" ? "" : "invisible"}`}
            />

            {phase === "ringing" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                <span className="relative flex items-center justify-center">
                  <span className="absolute inline-flex h-20 w-20 animate-ping rounded-full bg-brand/40" />
                  <Avatar size="lg" />
                </span>
                <p className="text-base font-medium text-white">Incoming call…</p>
              </div>
            )}

            {phase === "calling" && (
              <div className="absolute inset-x-0 bottom-36 z-10 flex flex-col items-center gap-2 text-center">
                <p className="text-base font-medium text-white drop-shadow">Calling…</p>
              </div>
            )}

            {connectionBadge && (
              <span className="absolute left-4 top-4 z-10">
                <Badge variant={connectionBadge.variant}>{connectionBadge.label}</Badge>
              </span>
            )}

            {error && (
              <div className="absolute inset-x-4 top-4 z-10">
                <Alert variant="danger">{error}</Alert>
              </div>
            )}

            <div className="relative z-10 mt-auto flex items-center justify-center gap-4 p-6 pb-10">
              {phase === "ringing" && (
                <>
                  <button
                    type="button"
                    onClick={declineIncomingCall}
                    aria-label="Decline call"
                    title="Decline"
                    className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg hover:opacity-90"
                  >
                    <PhoneEndIcon />
                  </button>
                  <button
                    type="button"
                    onClick={acceptIncomingCall}
                    aria-label="Accept call"
                    title="Accept"
                    className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-success text-brand-foreground shadow-lg hover:opacity-90"
                  >
                    <PhoneAcceptIcon />
                  </button>
                </>
              )}

              {(phase === "calling" || phase === "active") && (
                <div className="flex items-center gap-4 rounded-full bg-black/30 px-4 py-3 backdrop-blur-sm">
                  <button
                    type="button"
                    onClick={toggleMic}
                    aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
                    title={micEnabled ? "Mute" : "Unmute"}
                    className={`inline-flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                      micEnabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-danger"
                    }`}
                  >
                    <MicIcon muted={!micEnabled} />
                  </button>
                  <button
                    type="button"
                    onClick={toggleCamera}
                    aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                    title={cameraEnabled ? "Camera off" : "Camera on"}
                    className={`inline-flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                      cameraEnabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-danger"
                    }`}
                  >
                    <CameraIcon off={!cameraEnabled} />
                  </button>
                  {onToggleChat && (
                    <button
                      type="button"
                      onClick={onToggleChat}
                      aria-label={chatOpen ? "Hide chat" : "Show chat"}
                      title={chatOpen ? "Hide chat" : "Show chat"}
                      className={`inline-flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                        chatOpen ? "bg-brand text-brand-foreground" : "bg-white/15 text-white hover:bg-white/25"
                      }`}
                    >
                      <ChatBubbleIcon />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => endCall(true)}
                    aria-label="End call"
                    title="End call"
                    className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white hover:opacity-90"
                  >
                    <PhoneEndIcon />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
