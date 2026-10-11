import { mount } from "svelte";
import "./styles.css";
import App from "./app/App.svelte";
import { applyTheme, initialTheme } from "./lib/theme";

// Apply the persisted theme before mount so there is no dark flash on start.
applyTheme(initialTheme());

const target = document.getElementById("app");
if (!target) {
  throw new Error("mount point #app not found");
}
mount(App, { target });
