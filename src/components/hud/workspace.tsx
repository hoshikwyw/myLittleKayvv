"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  Brain,
  CalendarHeart,
  Globe2,
  ListChecks,
  MessageSquare,
  Mic,
  Plus,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useAssistant } from "@/hooks/use-assistant";
import { useVoice } from "@/hooks/use-voice";
import { VoiceOrb } from "@/components/voice-orb";
import { ConversationHistory } from "@/components/conversation-history";
import { HudPanel, type PanelState } from "./panel";
import { usePanelLayout } from "@/hooks/use-panel-layout";
import { ChatPanelBody } from "./chat-panel";
import {
  PeopleBody,
  PlansBody,
  SystemBody,
  UpcomingBody,
  type SubsystemStatus,
} from "./data-panels";
import { WorldMap, formatCoordinates, type MapPoint } from "./world-map";
import type { WorldPaths } from "@/lib/map/world";
import type { MemoryOverview } from "@/lib/memory/overview";
import { cn } from "@/lib/utils";

/**
 * The workspace.
 *
 * Panels, not pages. Everything the assistant knows is on one screen and
 * arranged, rather than reached by navigating away from what you were doing —
 * which for something you glance at all day is the difference between a tool
 * and a website.
 *
 * The reactor holds the centre because state is the thing you look at without
 * reading. Every readout, the conversation included, is a panel around it.
 */

type PanelId = "chat" | "upcoming" | "people" | "plans" | "system" | "map";

interface PanelMeta {
  id: PanelId;
  title: string;
  icon: typeof Brain;
  /** Where it sits when open, on a screen wide enough to place things. */
  column: "left" | "right";
}

const PANELS: PanelMeta[] = [
  { id: "system", title: "System status", icon: Activity, column: "left" },
  { id: "upcoming", title: "Upcoming", icon: CalendarHeart, column: "left" },
  { id: "chat", title: "Conversation", icon: MessageSquare, column: "right" },
  { id: "people", title: "Memory", icon: Brain, column: "right" },
  { id: "plans", title: "Plans", icon: ListChecks, column: "left" },
  { id: "map", title: "World", icon: Globe2, column: "right" },
];

/** Open on first load: enough to be useful, not so much it is a wall. */
const INITIAL: Record<PanelId, PanelState | null> = {
  system: "open",
  upcoming: "open",
  chat: "open",
  people: "open",
  plans: null,
  map: null,
};

export function HudWorkspace({
  assistantName,
  overview,
  status,
  model,
  timezone,
  today,
  worldPaths,
}: {
  assistantName: string;
  overview: MemoryOverview;
  status: Omit<SubsystemStatus, "voice">;
  model: string;
  timezone: string;
  today: string;
  worldPaths: WorldPaths;
}) {
  // The arrangement lives in localStorage, so the workspace is where you left
  // it — see the hook for why that is not React state.
  const [panels, setPanel] = usePanelLayout<PanelId>(INITIAL);
  const [input, setInput] = useState("");
  const [place, setPlace] = useState<MapPoint | null>(null);

  const sendRef = useRef<(text: string) => void>(() => {});
  const handleFinalTranscript = useCallback((text: string) => {
    sendRef.current(text);
  }, []);

  const voice = useVoice({ onFinalTranscript: handleFinalTranscript });
  const assistant = useAssistant({
    onDelta: voice.pushSpeech,
    onComplete: voice.flushSpeech,
  });

  const { send, setListening } = assistant;

  useEffect(() => {
    sendRef.current = (text: string) => void send(text);
  }, [send]);

  useEffect(() => {
    setListening(voice.listening);
  }, [voice.listening, setListening]);

  const submit = useCallback(() => {
    if (assistant.busy) return;
    const text = input;
    setInput("");
    // Talking to it should bring the conversation back if it was dismissed.
    setPanel("chat", "open");
    void assistant.send(text);
  }, [assistant, input, setPanel]);

  /** Reaching for the microphone mid-answer means "stop, listen to me". */
  const toggleMic = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    if (assistant.busy) assistant.stop();
    voice.startListening();
  }, [assistant, voice]);

  const maximised = PANELS.find((p) => panels[p.id] === "maximised");

  useEffect(() => {
    if (!maximised) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel(maximised!.id, "open");
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [maximised, setPanel]);

  function body(id: PanelId) {
    switch (id) {
      case "chat":
        return (
          <ChatPanelBody
            assistant={assistant}
            voice={voice}
            input={input}
            onInputChange={setInput}
            onSubmit={submit}
            onStop={() => {
              assistant.stop();
              voice.cancelSpeech();
            }}
            assistantName={assistantName}
          />
        );
      case "upcoming":
        return <UpcomingBody overview={overview} />;
      case "people":
        return <PeopleBody overview={overview} />;
      case "plans":
        return <PlansBody overview={overview} />;
      case "map":
        return (
          <WorldMap
            paths={worldPaths}
            selected={place}
            onSelect={setPlace}
            className="p-2"
          />
        );
      case "system":
        return (
          <SystemBody
            status={{ ...status, voice: voice.capabilities.listen }}
            counts={overview.counts}
            model={model}
            timezone={timezone}
          />
        );
    }
  }

  function meta(id: PanelId): string | undefined {
    switch (id) {
      case "upcoming":
        return String(overview.upcoming.length).padStart(2, "0");
      case "people":
        return String(overview.counts.people).padStart(2, "0");
      case "plans":
        return String(overview.counts.plans).padStart(2, "0");
      case "map":
        return place ? formatCoordinates(place) : undefined;
      default:
        return undefined;
    }
  }

  function renderPanel(panel: PanelMeta) {
    const state = panels[panel.id];
    if (!state) return null;

    const Icon = panel.icon;

    return (
      <HudPanel
        key={panel.id}
        title={panel.title}
        meta={meta(panel.id)}
        icon={<Icon className="size-3.5" />}
        state={state}
        live={panel.id === "chat" && assistant.busy}
        onStateChange={(next) => setPanel(panel.id, next)}
        onClose={() => setPanel(panel.id, null)}
        className={cn(
          panel.id === "chat" && state === "open" && "h-[22rem]",
          panel.id === "map" && state === "open" && "max-h-[20rem]",
          panel.id !== "chat" &&
            panel.id !== "map" &&
            state === "open" &&
            "max-h-[16rem]",
        )}
      >
        {body(panel.id)}
      </HudPanel>
    );
  }

  const column = (side: "left" | "right") =>
    PANELS.filter(
      (p) => p.column === side && panels[p.id] && panels[p.id] !== "maximised",
    ).map(renderPanel);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* The reactor sits behind everything, centred, as the ground the
          panels are arranged around. */}
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="pointer-events-auto flex flex-col items-center gap-4">
          <VoiceOrb
            state={assistant.state}
            onClick={voice.capabilities.listen ? toggleMic : undefined}
          />
          <p className="hud-label text-center">{today}</p>
        </div>
      </div>

      {/*
        Panels float over the reactor: two columns on a wide screen, one
        stacked column on a narrow one.

        Each panel is rendered exactly once. Rendering the right-hand column a
        second time for small screens and hiding one copy leaves both in the
        DOM — two textareas labelled "Message", two of every button — which is
        invisible to the eye and a mess for anything reading the page aloud.
      */}
      <div className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:grid lg:grid-cols-[22rem_1fr_22rem] lg:items-start lg:overflow-hidden">
        <div className="flex flex-col gap-3">{column("left")}</div>

        {/* Keeps the middle clear so the reactor shows between the columns. */}
        <div className="hidden lg:block" aria-hidden="true" />

        <div className="flex flex-col gap-3">{column("right")}</div>
      </div>

      {/*
        A full-screen panel is rendered into <body>.

        Left in the layout tree it inherits whatever the workspace is doing —
        flex sizing, clipping, stacking — and ends up positioned against a
        containing block rather than the window. A portal removes every one of
        those influences, which is what "full screen" has to mean.
      */}
      {maximised &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* Clicking away is how a full-screen thing is normally dismissed,
                so the backdrop is a real button rather than a bare div. */}
            <button
              type="button"
              onClick={() => setPanel(maximised.id, "open")}
              aria-label="Leave full screen"
              className="fixed inset-0 z-40 cursor-default bg-black/70 backdrop-blur-md"
            />
            {renderPanel(maximised)}
          </>,
          document.body,
        )}

      {/* The dock. Everything the header used to hold lives here. */}
      <div className="glass border-border relative z-20 shrink-0 border-t">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-3 py-2">
          <span className="text-accent mr-2 hidden font-mono text-xs font-semibold tracking-[0.25em] uppercase sm:block">
            {assistantName}
          </span>

          {PANELS.map((panel) => {
            const Icon = panel.icon;
            const open = Boolean(panels[panel.id]);

            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => setPanel(panel.id, open ? null : "open")}
                aria-pressed={open}
                aria-label={panel.title}
                title={panel.title}
                className={cn(
                  "hud-frame relative flex flex-1 flex-col items-center gap-1 rounded-sm border px-2 py-1.5 transition-colors",
                  open
                    ? "border-accent/50 text-accent bg-accent-soft/40"
                    : "border-border text-text-faint hover:text-text-muted",
                )}
              >
                <Icon className="size-4" />
                <span className="hud-label !text-[9px] leading-none">
                  {panel.title.split(" ")[0]}
                </span>
              </button>
            );
          })}

          <span className="bg-border mx-1 h-8 w-px" aria-hidden="true" />

          {voice.capabilities.listen && (
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={voice.listening}
              aria-label={
                voice.listening
                  ? "Stop listening"
                  : assistant.busy
                    ? "Interrupt and talk"
                    : "Talk"
              }
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-sm border transition-all active:scale-95",
                voice.listening
                  ? "border-listening bg-listening/15 text-listening shadow-[0_0_20px_-4px_var(--state-listening)]"
                  : "border-border text-text-muted hover:text-text",
              )}
            >
              <Mic className="size-4" />
            </button>
          )}

          {voice.capabilities.speak && (
            <button
              type="button"
              onClick={() => {
                voice.setSpeechEnabled(!voice.speechEnabled);
                if (voice.speechEnabled) voice.cancelSpeech();
              }}
              aria-pressed={voice.speechEnabled}
              aria-label={voice.speechEnabled ? "Mute the voice" : "Unmute"}
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-sm border transition-colors",
                voice.speechEnabled
                  ? "border-accent/50 text-accent"
                  : "border-border text-text-faint hover:text-text-muted",
              )}
            >
              {voice.speechEnabled ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              assistant.startNew();
              voice.cancelSpeech();
              setPanel("chat", "open");
            }}
            aria-label="New conversation"
            title="New conversation"
            className="border-border text-text-muted hover:text-accent grid size-10 shrink-0 place-items-center rounded-sm border transition-colors"
          >
            <Plus className="size-4" />
          </button>

          <ConversationHistory
            currentId={assistant.conversationId}
            onSelect={(id) => {
              voice.cancelSpeech();
              setPanel("chat", "open");
              if (id) void assistant.switchTo(id);
              else assistant.startNew();
            }}
          />
        </div>
      </div>
    </div>
  );
}
