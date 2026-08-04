import type { OrbState } from "../shared/contracts";

export type OrbSpec = {
  readonly label: string;
  readonly description: string;
  readonly a: string;
  readonly b: string;
  readonly amp: number;
  readonly speed: number;
  readonly freq: number;
  readonly scale: number;
  readonly voice: number;
};
/** The visual contract for the orb. Keep this table aligned with the guide. */
export const ORB_STATES: Record<OrbState, OrbSpec> = {
  idle: {
    label: "At rest",
    description: "",
    amp: 0.10,
    speed: 0.40,
    freq: 1.00,
    scale: 1.00,
    voice: 0,
    a: "#a7e5d3",
    b: "#c8b8e0",
  },
  listening: {
    label: "Listening",
    description: "I'm hearing you. Take your time.",
    amp: 0.17,
    speed: 0.85,
    freq: 1.35,
    scale: 1.05,
    voice: 1,
    a: "#a8c8e8",
    b: "#a7e5d3",
  },
  thinking: {
    label: "Thinking",
    description: "Understanding what you need…",
    amp: 0.21,
    speed: 1.05,
    freq: 1.65,
    scale: 1.00,
    voice: 0,
    a: "#c8b8e0",
    b: "#a8c8e8",
  },
  working: {
    label: "Working",
    description: "Gathering and organizing — watch the panel.",
    amp: 0.27,
    speed: 1.65,
    freq: 1.45,
    scale: 1.05,
    voice: 0.6,
    a: "#f4c5a8",
    b: "#c8b8e0",
  },
  waiting: {
    label: "Waiting",
    description: "Your call. Nothing moves without you.",
    amp: 0.06,
    speed: 0.22,
    freq: 1.00,
    scale: 0.97,
    voice: 0,
    a: "#e7e5e4",
    b: "#f0efed",
  },
  speaking: {
    label: "Speaking",
    description: "Here is what I found.",
    amp: 0.19,
    speed: 1.25,
    freq: 1.35,
    scale: 1.02,
    voice: 1,
    a: "#e8b8c4",
    b: "#f4c5a8",
  },
  done: {
    label: "Done",
    description: "Complete — and reviewed by you.",
    amp: 0.12,
    speed: 0.50,
    freq: 1.20,
    scale: 1.12,
    voice: 0,
    a: "#a7e5d3",
    b: "#d8f3e8",
  },
  interrupted: {
    label: "Interrupted",
    description: "Stopped. Nothing was sent or saved.",
    amp: 0.03,
    speed: 0.10,
    freq: 1.00,
    scale: 0.80,
    voice: 0,
    a: "#d6d3d1",
    b: "#e7e5e4",
  },
  recovery: {
    label: "Recovering",
    description: "Picking things back up calmly…",
    amp: 0.16,
    speed: 0.60,
    freq: 1.20,
    scale: 0.92,
    voice: 0,
    a: "#c8b8e0",
    b: "#a7e5d3",
  },
};
