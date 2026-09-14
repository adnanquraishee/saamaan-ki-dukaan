"use client";
import { create } from "zustand";

export type Mode = "local" | "remote";

export interface UiState {
  hydrated: boolean;
  tabId: string;
  isEngine: boolean;
  mode: Mode;
  llm: "unknown" | "available" | "unavailable";
  relay: boolean;
  lastDiffBytes: number;
}

export const useUi = create<UiState>(() => ({
  hydrated: false,
  tabId: "",
  isEngine: false,
  mode: "local",
  llm: "unknown",
  relay: false,
  lastDiffBytes: 0,
}));
