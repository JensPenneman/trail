import { useState } from "react";
import { useFormatter } from "../../../../format/useFormatter";
import { localDateOf } from "../../../../time/localDateOf";
import { Button } from "../../../../ui/Button";
import { SegmentedControl } from "../../../../ui/SegmentedControl";
import { Switch } from "../../../../ui/Switch";
import { type PlaybackRate, playbackRates } from "./playbackModel";
import type { PlaybackStatus } from "./playbackReducer";
import "./PlayerBar.css";

const rateLabels: Readonly<Record<PlaybackRate, string>> = {
  1: "1 min/s",
  5: "5 min/s",
  15: "15 min/s",
  60: "1 h/s",
};

interface PlayerBarProps {
  status: Exclude<PlaybackStatus, "off">;
  /** The moment shown, epoch seconds. */
  clock: number;
  /** Where playback started and where the recording ends, epoch seconds (the end may not be known yet). */
  start: number;
  end: number | null;
  rate: PlaybackRate;
  skipStops: boolean;
  onToggle: () => void;
  onPreviousMove: () => void;
  onNextMove: () => void;
  onRate: (rate: PlaybackRate) => void;
  onSkipStops: (on: boolean) => void;
  onSeek: (clock: number) => void;
  onExit: () => void;
}

/**
 * The foot of the map while playing (region "Playback"): the moves, one
 * Play/Pause button, the moment as a readout and a slider in whole minutes,
 * the speed, "Skip stops" and the way out. Presentational: the player's
 * state and what the buttons do are the caller's.
 */
export function PlayerBar({
  status,
  clock,
  start,
  end,
  rate,
  skipStops,
  onToggle,
  onPreviousMove,
  onNextMove,
  onRate,
  onSkipStops,
  onSeek,
  onExit,
}: PlayerBarProps) {
  const format = useFormatter();
  const day = localDateOf(clock * 1000, format.timeZone);
  const playing = status === "playing" || status === "loading";
  // What the slider says when read: the moment of the last input, or of the pause. While the clock
  // runs it would be a new sentence thirty times a second to a screen reader on the slider; the
  // day changes and the end are announced on their own.
  const [spoken, setSpoken] = useState(clock);
  if (!playing && spoken !== clock) setSpoken(clock);
  const spokenDay = localDateOf(spoken * 1000, format.timeZone);
  // The slider counts whole minutes from the epoch; the clock is a second more precise.
  const first = Math.ceil(start / 60);
  const last = Math.max(first, Math.floor((end ?? clock) / 60));
  const minute = Math.min(Math.max(Math.round(clock / 60), first), last);
  return (
    <section className="player-bar" aria-label="Playback" aria-busy={status === "loading"}>
      <div className="player-bar__row">
        <div className="player-bar__transport">
          <Button variant="ghost" icon="skipBack" iconOnly onClick={onPreviousMove}>
            Previous move
          </Button>
          <Button
            variant="primary"
            icon={playing ? "pause" : "play"}
            onClick={onToggle}
            data-player-toggle
          >
            {playing ? "Pause" : "Play"}
          </Button>
          <Button variant="ghost" icon="skipForward" iconOnly onClick={onNextMove}>
            Next move
          </Button>
        </div>
        <output className="player-bar__readout" aria-live="off">
          {format.day(day)} · {format.time(clock * 1000)}
        </output>
        <Button variant="ghost" icon="close" onClick={onExit}>
          Exit playback
        </Button>
      </div>
      <input
        type="range"
        className="player-bar__range"
        aria-label="Position at"
        aria-valuetext={`${format.dayLong(spokenDay)}, ${format.time(spoken * 1000)}`}
        min={first}
        max={last}
        step={1}
        value={minute}
        onChange={(event) => {
          const seconds = Number(event.currentTarget.value) * 60;
          setSpoken(seconds);
          onSeek(seconds);
        }}
      />
      <div className="player-bar__row player-bar__row--settings">
        <SegmentedControl
          label="Speed"
          value={String(rate)}
          options={playbackRates.map((value) => ({
            value: String(value),
            label: rateLabels[value],
          }))}
          onChange={(value) => onRate(Number(value) as PlaybackRate)}
        />
        <Switch label="Skip stops" checked={skipStops} onChange={onSkipStops} />
      </div>
      {/* Mounted all along, so that the words are announced when they arrive. */}
      <p className="visually-hidden" role="status">
        {status === "loading" ? `Loading ${format.dayLong(day)}` : ""}
      </p>
    </section>
  );
}
