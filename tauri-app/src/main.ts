import { mount } from "svelte";
import "./styles.css";
import App from "./app/App.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("mount point #app not found");
}
mount(App, { target });
