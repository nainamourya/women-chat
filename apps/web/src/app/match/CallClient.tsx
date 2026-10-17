"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";

type CallPhase = "idle" | "calling" | "ringing" | "active";

// Used until /api/call/ice-servers resolves (or if it fails) — STUN alone
// still works for peers on permissive networks, it just can't relay media
// across strict NATs/firewalls the way a TURN server can.
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Testing-only: forces every candidate pair through the TURN relay so you
// can confirm the TURN server itself works, isolated from any direct/STUN
// path. Never set this in normal production traffic — it adds relay latency
// and load for every call. Safe to expose: it's a mode name, not a secret.
const ICE_TRANSPORT_POLICY: RTCIceTransportPolicy | undefined =
  process.env.NEXT_PUBLIC_ICE_TRANSPORT_POLICY === "relay" ? "relay" : undefined;

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
  onNext,
  autoConnect = false,
  isCaller = false,
}: {
  socket: Socket;
  matchId: string;
  onPhaseChange?: (phase: CallPhase) => void;
  chatOpen?: boolean;
  onToggleChat?: () => void;
  // Ends this match and queues for someone else — the call overlay covers the
  // match card's own "Not for me — next" button, so it is offered here too.
  onNext?: () => void;
  // When set, the call starts on its own as soon as both matched users are in
  // the room: the designated caller sends the offer and the other side
  // answers without a ring/accept step.
  autoConnect?: boolean;
  isCaller?: boolean;
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
  const autoHandledRef = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  // The remote <video> only exists once the call overlay is mounted, which can
  // happen after ontrack fires (the auto-answering side goes idle -> active
  // with no "ringing" phase in between), so the stream is kept here and
  // attached by an effect once the element is there.
  const remoteStreamRef = useRef<MediaStream | null>(null);
  // Always mounted (unlike the overlay below, which unmounts when idle) so
  // the draggable bubble's dragConstraints ref is never null when it mounts.
  const constraintsRef = useRef<HTMLDivElement>(null);

  // Populated by /api/call/ice-servers on mount; createPeerConnection() reads
  // the ref directly so a call started before the fetch resolves still works
  // (just without a TURN relay) rather than waiting on it.
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE_SERVERS);
  const turnConfiguredRef = useRef(false);
  // Guards against retrying restartIce() in a loop for the same failure.
  const iceRestartAttemptedRef = useRef(false);
  const failTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFailTimeout = useCallback(() => {
    if (failTimeoutRef.current) {
      clearTimeout(failTimeoutRef.current);
      failTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/call/ice-servers", { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.iceServers) || data.iceServers.length === 0) return;
        iceServersRef.current = data.iceServers;
        turnConfiguredRef.current = Boolean(data.turnConfigured);
        if (!data.turnConfigured) {
          console.warn("[call] No TURN server configured — calls across strict NATs/firewalls may fail.");
        }
      })
      .catch(() => {
        console.warn("[call] Failed to fetch ICE server configuration — falling back to STUN-only.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Diagnostics only: logs which candidate type (host/srflx/relay) the
  // active connection ended up using — no IPs, ports, or SDP content.
  async function logSelectedCandidatePair(pc: RTCPeerConnection) {
    try {
      const stats = await pc.getStats();
      const reports = Array.from(stats.values()) as Array<Record<string, unknown>>;
      const pair = reports.find((report) => report.type === "candidate-pair" && report.state === "succeeded");
      if (!pair) return;
      const local = stats.get(pair.localCandidateId as string) as Record<string, unknown> | undefined;
      const remote = stats.get(pair.remoteCandidateId as string) as Record<string, unknown> | undefined;
      console.log("[call] ICE connected", {
        localCandidateType: local?.candidateType,
        remoteCandidateType: remote?.candidateType,
      });
    } catch {
      // getStats is best-effort diagnostics only.
    }
  }

  const cleanupCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    iceRestartAttemptedRef.current = false;
    clearFailTimeout();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    remoteStreamRef.current = null;
    setConnectionState(null);
    setPhase("idle");
  }, [clearFailTimeout]);

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
    } catch (err) {
      // iOS Safari throws these same DOMException names as Chrome/Android,
      // but hits NotAllowedError far more often in practice (its permission
      // prompt is per-origin and easy to have previously dismissed/denied).
      const name = err instanceof DOMException ? err.name : undefined;
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Camera/microphone access was denied. Check your browser's site permissions and try again.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("No camera or microphone was found on this device.");
      } else if (name === "NotReadableError") {
        setError("Your camera or microphone is already in use by another app.");
      } else {
        setError("Camera/microphone permission was denied or unavailable.");
      }
      throw new Error("getUserMedia failed");
    }
  }

  function createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      ...(ICE_TRANSPORT_POLICY ? { iceTransportPolicy: ICE_TRANSPORT_POLICY } : {}),
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("call:ice-candidate", { matchId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Renegotiation entry point — fires when restartIce() (below) needs a
    // fresh offer sent. Reuses the existing call:offer/call:answer events;
    // handleOffer/handleAnswer apply it to the existing connection instead
    // of treating it as a new incoming call when one is already active.
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("call:offer", { matchId, sdp: offer });
      } catch (err) {
        console.error("[call] renegotiation offer failed:", err);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[call] ICE connection state -> ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        iceRestartAttemptedRef.current = false;
        clearFailTimeout();
        logSelectedCandidatePair(pc);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[call] connection state -> ${pc.connectionState}`);
      setConnectionState(pc.connectionState);

      if (pc.connectionState === "connected") {
        clearFailTimeout();
      }

      // "disconnected" is often a transient blip (switching Wi-Fi/cellular,
      // a brief network drop) — the ICE agent frequently recovers on its own
      // within a few seconds, so give it a grace period before treating it
      // as fatal rather than ending the call immediately.
      if (pc.connectionState === "disconnected") {
        clearFailTimeout();
        failTimeoutRef.current = setTimeout(() => {
          const current = pcRef.current;
          if (current && (current.connectionState === "disconnected" || current.connectionState === "failed")) {
            setError("Call connection failed (this can happen without a TURN server across strict networks).");
            endCall(true);
          }
        }, 6000);
      }

      if (pc.connectionState === "failed") {
        if (!iceRestartAttemptedRef.current) {
          // One best-effort recovery attempt before giving up — common on
          // mobile networks where the original path briefly drops.
          iceRestartAttemptedRef.current = true;
          console.warn("[call] connection failed — attempting one ICE restart");
          try {
            pc.restartIce();
          } catch (err) {
            console.error("[call] restartIce() failed:", err);
          }
          clearFailTimeout();
          failTimeoutRef.current = setTimeout(() => {
            if (pcRef.current?.connectionState === "failed") {
              setError("Call connection failed (this can happen without a TURN server across strict networks).");
              endCall(true);
            }
          }, 6000);
        } else {
          clearFailTimeout();
          setError("Call connection failed (this can happen without a TURN server across strict networks).");
          endCall(true);
        }
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
      const pc = pcRef.current;
      // A renegotiation offer (e.g. from restartIce() on an ICE restart)
      // arrives while a call is already active on an existing connection —
      // apply it in place rather than treating it as a new incoming call.
      if (phase === "active" && pc) {
        try {
          await pc.setRemoteDescription(payload.sdp);
          await flushPendingCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("call:answer", { matchId, sdp: answer });
        } catch (err) {
          console.error("[call] failed to apply renegotiation offer:", err);
        }
        return;
      }

      if (phase !== "idle") return; // already in/starting a call — no call-waiting support (MVP)
      pendingOfferRef.current = payload.sdp;
      setError(null);
      if (autoConnect) {
        if (autoHandledRef.current) return;
        autoHandledRef.current = true;
        void acceptIncomingCall().finally(() => {
          autoHandledRef.current = false;
        });
        return;
      }
      setPhase("ringing");
    }

    async function handleAnswer(payload: AnswerPayload) {
      const pc = pcRef.current;
      // Checking signalingState (rather than just `phase`) lets this apply
      // both the initial answer and a later renegotiation answer, since the
      // latter arrives while phase is already "active".
      if (!pc || pc.signalingState !== "have-local-offer") return;
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flushPendingCandidates();
        if (phase !== "active") setPhase("active");
      } catch (err) {
        if (phase === "active") {
          // Renegotiation failed mid-call — the connection-state handlers
          // above will surface it if the call actually breaks.
          console.error("[call] failed to apply renegotiation answer:", err);
        } else {
          setError("Failed to establish the call.");
          cleanupCall();
        }
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

    function handleReady() {
      if (!autoConnect || !isCaller || phase !== "idle" || autoHandledRef.current) return;
      autoHandledRef.current = true;
      void startCall().finally(() => {
        autoHandledRef.current = false;
      });
    }

    socket.on("call:ready", handleReady);
    socket.on("call:offer", handleOffer);
    socket.on("call:answer", handleAnswer);
    socket.on("call:ice-candidate", handleIceCandidate);
    socket.on("call:ended", handleCallEnded);
    socket.on("chat:user_disconnected", handleUserDisconnected);

    return () => {
      socket.off("call:ready", handleReady);
      socket.off("call:offer", handleOffer);
      socket.off("call:answer", handleAnswer);
      socket.off("call:ice-candidate", handleIceCandidate);
      socket.off("call:ended", handleCallEnded);
      socket.off("chat:user_disconnected", handleUserDisconnected);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, matchId, phase, cleanupCall, autoConnect, isCaller]);

  useEffect(() => {
    if (phase !== "idle" && remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, [phase]);

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
                  {onNext && (
                    <button
                      type="button"
                      onClick={onNext}
                      aria-label="Not for me, next"
                      title="Not for me — next"
                      className="inline-flex h-14 items-center justify-center rounded-full bg-white/15 px-5 text-sm font-medium text-white transition-colors hover:bg-white/25"
                    >
                      Next
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
