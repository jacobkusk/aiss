"use client";

import { createContext, useContext } from "react";
import type maplibregl from "maplibre-gl";

export const MapContext = createContext<maplibregl.Map | null>(null);

export function useMap(): maplibregl.Map | null {
  return useContext(MapContext);
}
