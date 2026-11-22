// No React here: the root layout (server) inlines this script.
export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "jh-theme";

/** Runs before paint (inlined in <head>) so there is no flash of the wrong theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}")||"system";var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
