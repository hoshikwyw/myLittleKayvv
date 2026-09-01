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
import { WeatherReadout } from "./weather-readout";
import { PlaceReadout } from "./place-readout";
import { zoneAt } from "@/lib/map/local-time";
import { distanceKm } from "@/lib/map/distance";
import { viewFor, stepForDistance, WORLD_STEP } from "./map-zoom";
import { useStreets } from "@/hooks/use-streets";
import { useModelChoice } from "@/hooks/use-model-choice";

import type { WorldPaths } from "@/lib/map/world";
import type { MemoryOverview } from "@/lib/memory/overview";
import type { ModelSummary } from "@/types";
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
  column: "left" | "centre" | "right";
}

const PANELS: PanelMeta[] = [
  { id: "system", title: "System status", icon: Activity, column: "left" },
  { id: "upcoming", title: "Upcoming", icon: CalendarHeart, column: "left" },
  { id: "chat", title: "Conversation", icon: MessageSquare, column: "right" },
  { id: "people", title: "Memory", icon: Brain, column: "right" },
  { id: "plans", title: "Plans", icon: ListChecks, column: "left" },
  // The centre, not the right column. The map is the only panel that is
  // landscape rather than a list, and the middle is both the widest space and
  // the emptiest — putting it there stops the right column running past the
  // bottom of the window and gives the reactor something to sit above.
  { id: "map", title: "World", icon: Globe2, column: "centre" },
];

/** Open on first load: enough to be useful, not so much it is a wall. */
const INITIAL: Record<PanelId, PanelState | null> = {
  system: "open",
  upcoming: "open",
  chat: "open",
  people: "open",
  plans: null,
  map: "open",
};

export function HudWorkspace({
  assistantName,
  overview,
  status,
  timezone,
  today,
  worldPaths,
  home,
  models,
}: {
  assistantName: string;
  overview: MemoryOverview;
  status: Omit<SubsystemStatus, "voice">;
  timezone: string;
  today: string;
  worldPaths: WorldPaths;
  /** Null when HOME_LOCATION is unset, which is an ordinary state. */
  home: MapPoint | null;
  models: ModelSummary[];
}) {
  // The arrangement lives in localStorage, so the workspace is where you left
  // it — see the hook for why that is not React state.
  const [panels, setPanel] = usePanelLayout<PanelId>(INITIAL);
  const [input, setInput] = useState("");
  /**
   * The map opens on home rather than empty.
   *
   * A blank panel that says "click to select" teaches nothing; one already
   * showing your own time and weather shows what a click is for. Safe for
   * hydration because the readouts render a placeholder first and fill in from
   * an effect, so the server and the first client paint agree.
   */
  /**
   * The selected point, and what it is called when something named it.
   *
   * The name matters more than it looks. A pharmacy 470m away moves the
   * marker by eight thousandths of a pixel and rounds to the same coordinates
   * as home, so without a label the panel looks completely unchanged and the
   * assistant appears to be lying about having found it.
   */
  const [place, setPlace] = useState<(MapPoint & { label?: string }) | null>(
    home,
  );
  const [chosenModel, chooseModel] = useModelChoice();
  const [zoom, setZoom] = useState(WORLD_STEP);

  const view = viewFor(zoom, place);
  const { streets, loading: loadingStreets } = useStreets(place, zoom);

  const sendRef = useRef<(text: string) => void>(() => {});
  const handleFinalTranscript = useCallback((text: string) => {
    sendRef.current(text);
  }, []);

  const voice = useVoice({ onFinalTranscript: handleFinalTranscript });
  const assistant = useAssistant({
    onDelta: voice.pushSpeech,
    onComplete: voice.flushSpeech,
    /**
     * Asked about somewhere, so show it.
     *
     * The panel is opened as well as moved: a marker dropped on a map that is
     * closed or minimised is a thing that happened where nobody was looking.
     */
    onFocus: (next) => {
      setPlace({
        latitude: next.latitude,
        longitude: next.longitude,
        label: next.label,
      });

      /*
       * How far away decides how close to look.
       *
       * A pharmacy 400m away and a city 8,000km away arrive the same way, and
       * one scale cannot show both — at world zoom the pharmacy is invisible,
       * at street zoom the city is a blank field of ocean.
       */
      setZoom(
        stepForDistance(
          home
            ? distanceKm(
                home.latitude,
                home.longitude,
                next.latitude,
                next.longitude,
              )
            : null,
        ),
      );

      setPanel("map", "open");
    },
    /**
     * The selected point travels with every turn, typed or spoken, so "what
     * about here?" resolves without the user having to read coordinates out.
     * A getter, so this is whatever is selected when they ask rather than when
     * the hook was built.
     */
    // Read at send time rather than held, so changing it in the picker
    // applies to the next turn without the hook keeping a copy.
    model: () => chosenModel ?? undefined,
    focus: () =>
      place
        ? {
            latitude: place.latitude,
            longitude: place.longitude,
            zone: zoneAt(place.latitude, place.longitude),
          }
        : null,
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

  /**
   * The one-click version of what the focus context already enables.
   *
   * Without it the connection between the map and the conversation is
   * invisible: nothing on screen tells you that asking "what about here?" will
   * work. Typing your own question is still the general case.
   */
  const askAboutHere = useCallback(() => {
    if (assistant.busy) return;
    setPanel("chat", "open");
    void assistant.send("What's it like here right now?");
  }, [assistant, setPanel]);

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
          /*
           * The map shrinks; the readouts under it do not.
           *
           * `h-full` takes the height the panel body already has, so the SVG
           * scales down to whatever is left rather than keeping its own
           * 2:1 height and pushing half of itself below the fold — which is
           * what it did in a column wide enough to make 2:1 taller than the
           * window.
           */
          <div className="flex h-full flex-col">
            <WorldMap
              paths={worldPaths}
              streets={streets}
              loadingStreets={loadingStreets}
              view={view}
              step={zoom}
              onZoom={setZoom}
              selected={place}
              home={home}
              onSelect={(point) => setPlace(point)}
              // A floor as well as a ceiling: in a short window the read-outs
              // would otherwise squeeze the map down to a sliver of ocean.
              className="min-h-[8rem] flex-1 p-2"
            />
            {place && (
              <div className="@container shrink-0">
                {/*
                  Side by side once there is width for it. Stacked, these two
                  read-outs are five rows deep in a column wide enough for
                  ten — and every row they take is a row the map does not get.

                  A container query, not a screen one. The panel is a third of
                  the window, so asking how wide the *window* is put two
                  columns into a 300px panel on a small laptop and truncated
                  "Asia/Yangon" to "A". What matters is the width of this box.

                  `@container` goes on the parent, not on the grid: an element
                  cannot answer a query about its own size, and putting it here
                  silently left the read-outs stacked at every width.
                */}
                <div className="grid @lg:grid-cols-2">
                  <PlaceReadout
                    point={place}
                    homeZone={timezone}
                    label={place.label}
                    home={home}
                  />
                  <WeatherReadout point={place} className="@lg:border-l" />
                </div>
                <AskAboutHere onAsk={askAboutHere} busy={assistant.busy} />
              </div>
            )}
          </div>
        );
      case "system":
        return (
          <SystemBody
            status={{ ...status, voice: voice.capabilities.listen }}
            counts={overview.counts}
            timezone={timezone}
            models={models}
            chosenModel={chosenModel}
            onChooseModel={chooseModel}
            answeredBy={assistant.answeredBy}
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
        // The name when there is one: coordinates alone cannot show that
        // anything happened when the new point is a few hundred metres away.
        return place?.label ?? (place ? formatCoordinates(place) : undefined);
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
        /*
         * Weights, not heights.
         *
         * Fixed heights are what pushed the right column past the bottom of
         * the window: three panels each insisting on their own size add up to
         * more than there is. Sharing the column instead means the total is
         * always exactly the space available, whatever is open.
         *
         * A minimised panel is only a title bar and must not claim a share.
         */
        className={cn(
          state === "minimised" && "flex-none",
          // Only where the column is bounded. Below `lg` the workspace scrolls,
          // and dividing a scrolling column by weight gives each panel a slice
          // of the *visible* height instead of the height it needs — which
          // squeezed the conversation down to a sliver on a phone.
          state === "open" && "lg:min-h-0",
          // Stacked, a panel must keep its own height and let the column
          // scroll. Flex items shrink by default, so inside a bounded column
          // they squashed instead of overflowing — "Upcoming" came out as a
          // 24px title bar with its body pressed to nothing.
          state === "open" && "shrink-0 lg:shrink",
          // The conversation earns more room than a read-out beside it.
          state === "open" && panel.id === "chat" && "h-[22rem] lg:h-auto lg:flex-[2]",
          state === "open" && panel.id !== "chat" && "lg:flex-1",
          // A stacked panel with nothing in it should not be a tall empty box.
          state === "open" && panel.id !== "chat" && "max-h-[18rem] lg:max-h-none",
        )}
      >
        {body(panel.id)}
      </HudPanel>
    );
  }

  const column = (side: "left" | "centre" | "right") =>
    PANELS.filter(
      (p) => p.column === side && panels[p.id] && panels[p.id] !== "maximised",
    ).map(renderPanel);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/*
        Three columns on a wide screen, one stacked column on a narrow one.

        Each panel is rendered exactly once. Rendering a column a second time
        for small screens and hiding one copy leaves both in the DOM — two
        textareas labelled "Message", two of every button — which is invisible
        to the eye and a mess for anything reading the page aloud.

        Below `lg` this scrolls, deliberately. Six panels forced into a phone
        viewport would be about eighty pixels each, which is not a layout, it
        is a list of title bars. Horizontal overflow is prevented at every
        width; vertical is only prevented where the result is still usable.
      */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-3 lg:grid lg:grid-cols-[21rem_minmax(0,1fr)_21rem] lg:items-stretch lg:overflow-hidden">
        <div className="flex min-h-0 flex-col gap-3">{column("left")}</div>

        {/*
          The reactor, and the world beneath it.

          The orb takes whatever the map does not, so closing the map leaves it
          centred in the whole column exactly as it was before, and opening the
          map slides it up rather than covering it.
        */}
        <div className="flex min-h-0 flex-col gap-3">
          {/*
            The reactor takes only what it needs, so the map gets the rest.
            
            Sharing the column evenly gave the map a strip barely taller than
            its own readouts — and it is the panel with something to show,
            while the orb is the same size whatever happens to it.
          */}
          <div className="grid min-h-0 shrink place-items-center overflow-hidden py-2">
            <div className="flex flex-col items-center gap-4">
              <VoiceOrb
                state={assistant.state}
                onClick={voice.capabilities.listen ? toggleMic : undefined}
              />
              <p className="hud-label text-center">{today}</p>
            </div>
          </div>

          {column("centre")}
        </div>

        <div className="flex min-h-0 flex-col gap-3">{column("right")}</div>
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

/**
 * Sits under the readout while a point is selected.
 *
 * Sends rather than seeding the input, because the label says exactly what it
 * will do — and a box that fills itself with words you did not type is a worse
 * surprise than a button that does what it says.
 */
function AskAboutHere({
  onAsk,
  busy,
}: {
  onAsk: () => void;
  busy: boolean;
}) {
  return (
    <div className="border-border/60 border-t px-3 py-2">
      <button
        type="button"
        onClick={onAsk}
        disabled={busy}
        className="border-accent/50 text-accent flex w-full items-center justify-center gap-1.5 rounded-sm border px-2 py-1.5 text-[11px] tracking-wide uppercase transition-all hover:brightness-125 active:scale-[0.99] disabled:opacity-30"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--accent) 14%, transparent), transparent)",
        }}
      >
        <MessageSquare className="size-3" />
        Ask about here
      </button>
    </div>
  );
}
