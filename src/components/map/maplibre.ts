// Loaded only in the browser (dynamic import from BaseMap). MapLibre v6 needs an explicit worker URL under bundlers.
import * as maplibregl from "maplibre-gl";

maplibregl.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

export default maplibregl;
export type MapLibre = typeof maplibregl;
